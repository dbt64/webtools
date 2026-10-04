import type { PluginCapability, PluginStatus } from '../../src/shared/plugin-contracts.ts'
import { PLUGIN_CAPABILITIES } from '../../src/shared/plugin-contracts.ts'
import { boundedString, httpsLiteral, parseStrictJson, record, validPluginId, versionParts } from './manifest.ts'
import { ManagedFs, isMissing } from './managed-fs.ts'
import { fail } from './errors.ts'

export interface InstalledVersion { version: string; hash: string }
export interface PluginRecord { id: string; name: string; current: InstalledVersion; versions: InstalledVersion[]; enabled: boolean; requested: PluginCapability[]; granted: PluginCapability[]; status: PluginStatus; errorCode?: string; description?: string; author?: { name: string; url?: string }; api?: { apiMajor: number; minHostVersion: string }; source?: 'local-unsigned' }
export interface RegistryData { registryVersion: 1; plugins: PluginRecord[] }
export function validateIdentity(value: unknown): InstalledVersion {
  const item = record(value, ['version', 'hash']); versionParts(item.version)
  if (typeof item.hash !== 'string' || !/^[a-f0-9]{64}$/.test(item.hash)) fail('INVALID_INPUT')
  return { version: item.version as string, hash: item.hash }
}
const statuses: PluginStatus[] = ['installed-disabled', 'enabled', 'active', 'invoking', 'stopping', 'incompatible', 'invalid', 'needs-permission', 'faulted']
export function validateRegistry(value: unknown): RegistryData {
  const data = record(value, ['registryVersion', 'plugins'])
  if (data.registryVersion !== 1 || !Array.isArray(data.plugins) || data.plugins.length > 1000) fail('INVALID_INPUT')
  const seen = new Set<string>()
  const plugins = data.plugins.map(value => {
    const p = record(value, ['id', 'name', 'current', 'versions', 'enabled', 'requested', 'granted', 'status'], ['errorCode', 'description', 'author', 'api', 'source'])
    if (!validPluginId(p.id) || seen.has(p.id) || typeof p.name !== 'string' || p.name.length > 80 || typeof p.enabled !== 'boolean' || !statuses.includes(p.status as PluginStatus) || !Array.isArray(p.versions) || !p.versions.length || p.versions.length > 256 || !Array.isArray(p.granted) || p.granted.some(cap => !PLUGIN_CAPABILITIES.includes(cap)) || new Set(p.granted).size !== p.granted.length) fail('INVALID_INPUT')
    seen.add(p.id)
    if (!Array.isArray(p.requested) || p.requested.length > PLUGIN_CAPABILITIES.length || p.requested.some(cap => !PLUGIN_CAPABILITIES.includes(cap)) || new Set(p.requested).size !== p.requested.length || p.granted.some(cap => !(p.requested as unknown[]).includes(cap))) fail('INVALID_INPUT')
    const current = validateIdentity(p.current); const versions = p.versions.map(validateIdentity)
    if (new Set(versions.map(v => `${v.version}/${v.hash}`)).size !== versions.length || !versions.some(v => v.version === current.version && v.hash === current.hash)) fail('INVALID_INPUT')
    if (p.errorCode !== undefined && (typeof p.errorCode !== 'string' || !/^[A-Z_]{1,64}$/.test(p.errorCode))) fail('INVALID_INPUT')
    if (p.description !== undefined) boundedString(p.description, 512, 0)
    if (p.author !== undefined) { const author = record(p.author, ['name'], ['url']); boundedString(author.name, 128); if (author.url !== undefined) httpsLiteral(author.url) }
    if (p.api !== undefined) { const api = record(p.api, ['apiMajor', 'minHostVersion']); if (api.apiMajor !== 1) fail('INVALID_INPUT'); versionParts(api.minHostVersion) }
    if (p.source !== undefined && p.source !== 'local-unsigned') fail('INVALID_INPUT')
    return { ...p, current, versions } as unknown as PluginRecord
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
