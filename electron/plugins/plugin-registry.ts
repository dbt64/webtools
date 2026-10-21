import type { InstalledPluginCapability, PluginStatus } from '../../src/shared/plugin-contracts.ts'
import { PLUGIN_CAPABILITIES } from '../../src/shared/plugin-contracts.ts'
import type { CapabilityV2 } from '../../plugin-sdk/declarative-v1/runtime/manifest-v2.mjs'
import { boundedString, httpsLiteral, parseStrictJson, record, validPluginId, versionParts } from './manifest.ts'
import { ManagedFs, isMissing } from './managed-fs.ts'
import { fail } from './errors.ts'

export interface InstalledVersion { version: string; hash: string }
export interface PluginRecord { id: string; name: string; current: InstalledVersion; versions: InstalledVersion[]; enabled: boolean; requested: InstalledPluginCapability[]; granted: InstalledPluginCapability[]; status: PluginStatus; errorCode?: string; description?: string; author?: { name: string; url?: string }; api?: { apiMajor: number; minHostVersion: string }; source?: 'local-unsigned'; manifestVersion?: 1 | 2 | 3; runtimeKind?: 'web' | 'node' }
export const WEB_CAPABILITIES: readonly CapabilityV2[] = ['plugin.config.read', 'plugin.config.write', 'plugin.storage.read', 'plugin.storage.write', 'external.open', 'clipboard.write', 'clipboard.read', 'sharedAI.complete', 'network.domains']
// Declaration vocabulary is wider than grantability while Gate 4 is uncertified.
export const WEB_GRANTABLE_CAPABILITIES: readonly CapabilityV2[] = WEB_CAPABILITIES.filter(cap => cap !== 'network.domains')
const V3_CAPABILITIES: readonly string[] = WEB_GRANTABLE_CAPABILITIES
export interface RegistryData { registryVersion: 1; plugins: PluginRecord[] }
export function validateIdentity(value: unknown): InstalledVersion {
  const item = record(value, ['version', 'hash']); versionParts(item.version)
  if (typeof item.hash !== 'string' || !/^[a-f0-9]{64}$/.test(item.hash)) fail('INVALID_INPUT')
  return { version: item.version as string, hash: item.hash }
}
const statuses: PluginStatus[] = ['installed-disabled', 'enabled', 'active', 'invoking', 'stopping', 'incompatible', 'invalid', 'needs-permission', 'faulted']
function webMetadataString(value: unknown, maxScalars: number, minScalars = 0): void {
  if (typeof value !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail('INVALID_INPUT')
  let count = 0
  for (const character of value) { const scalar = character.codePointAt(0)!; if (scalar >= 0xd800 && scalar <= 0xdfff) fail('INVALID_INPUT'); count++ }
  if (count < minScalars || count > maxScalars) fail('INVALID_INPUT')
}
export function validateRegistry(value: unknown): RegistryData {
  const data = record(value, ['registryVersion', 'plugins'])
  if (data.registryVersion !== 1 || !Array.isArray(data.plugins) || data.plugins.length > 1000) fail('INVALID_INPUT')
  const seen = new Set<string>()
  const plugins = data.plugins.map(value => {
    const p = record(value, ['id', 'name', 'current', 'versions', 'enabled', 'requested', 'granted', 'status'], ['errorCode', 'description', 'author', 'api', 'source', 'manifestVersion', 'runtimeKind'])
    if (p.manifestVersion !== undefined && p.manifestVersion !== 1 && p.manifestVersion !== 2 && p.manifestVersion !== 3) fail('INVALID_INPUT')
    const allowed: readonly string[] = p.manifestVersion === 2 ? WEB_CAPABILITIES : p.manifestVersion === 3 ? V3_CAPABILITIES : PLUGIN_CAPABILITIES
    if (!validPluginId(p.id) || seen.has(p.id) || typeof p.name !== 'string' || (p.manifestVersion !== 2 && p.manifestVersion !== 3 && p.name.length > 80) || typeof p.enabled !== 'boolean' || !statuses.includes(p.status as PluginStatus) || !Array.isArray(p.versions) || !p.versions.length || p.versions.length > 256 || !Array.isArray(p.granted) || p.granted.some(cap => !allowed.includes(cap)) || new Set(p.granted).size !== p.granted.length) fail('INVALID_INPUT')
    if ((p.manifestVersion === 3 && p.runtimeKind !== 'web' && p.runtimeKind !== 'node') || (p.manifestVersion !== 3 && p.runtimeKind !== undefined)) fail('INVALID_INPUT')
    if (p.manifestVersion === 2 || p.manifestVersion === 3) webMetadataString(p.name, 80, 1)
    seen.add(p.id)
    if (!Array.isArray(p.requested) || p.requested.length > allowed.length || p.requested.some(cap => !allowed.includes(cap)) || new Set(p.requested).size !== p.requested.length || p.granted.some(cap => !(p.requested as unknown[]).includes(cap))) fail('INVALID_INPUT')
    const current = validateIdentity(p.current); const versions = p.versions.map(validateIdentity)
    if (new Set(versions.map(v => `${v.version}/${v.hash}`)).size !== versions.length || !versions.some(v => v.version === current.version && v.hash === current.hash)) fail('INVALID_INPUT')
    if (p.errorCode !== undefined && (typeof p.errorCode !== 'string' || !/^[A-Z_]{1,64}$/.test(p.errorCode))) fail('INVALID_INPUT')
    if (p.description !== undefined) { if (p.manifestVersion === 2 || p.manifestVersion === 3) webMetadataString(p.description, 512); else boundedString(p.description, 512, 0) }
    if (p.author !== undefined) { const author = record(p.author, ['name'], ['url']); if (p.manifestVersion === 2 || p.manifestVersion === 3) webMetadataString(author.name, 128, 1); else boundedString(author.name, 128); if (author.url !== undefined) httpsLiteral(author.url) }
    if (p.api !== undefined) { const api = record(p.api, ['apiMajor', 'minHostVersion']); if (api.apiMajor !== 1) fail('INVALID_INPUT'); versionParts(api.minHostVersion) }
    if (p.source !== undefined && p.source !== 'local-unsigned') fail('INVALID_INPUT')
    const granted = p.manifestVersion === 2 ? p.granted.filter(cap => cap !== 'network.domains') : p.granted
    return { ...p, granted, current, versions } as unknown as PluginRecord
  })
  return { registryVersion: 1, plugins }
}
export class PluginRegistry {
  readonly fs: ManagedFs
  constructor(fs: ManagedFs) { this.fs = fs }
  async load(): Promise<RegistryData | null> {
    try { return validateRegistry(parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(await this.fs.read('registry.json', 1024 * 1024)))) }
    catch (error) {
      if (isMissing(error)) return null
      if (error instanceof Error && 'code' in error && error.code === 'UNSAFE_PATH') throw error
      return null
    }
  }
  async save(data: RegistryData, mayCommit?: () => boolean): Promise<void> {
    const validated = validateRegistry(data)
    if (Buffer.byteLength(JSON.stringify(validated)) > 1024 * 1024) fail('STORAGE_LIMIT')
    await this.fs.atomicJson('registry.json', validated, mayCommit)
  }
}
