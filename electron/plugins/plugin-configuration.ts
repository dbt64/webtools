import { createHash } from 'node:crypto'
import type { ManifestV3 } from '../../plugin-sdk/runtime-v3/manifest-v3.mjs'
import { CONFIGURATION_LIMITS, resolveConfigurationValues, type ConfigurationValue, type PluginConfiguration } from '../../plugin-sdk/declarative-v1/runtime-v3/configuration.mjs'
import { record, parseStrictJson, validPluginId, validateSettingValue } from './manifest.ts'
import { ManagedFs, SerialQueue, isMissing } from './managed-fs.ts'
import { fail } from './errors.ts'

const FILE_BYTES = CONFIGURATION_LIMITS.valuesBytes + 8192
export type ConfigurationState = { status: 'ready' | 'incompatible'; schemaVersion: number; revision: string; values: Record<string, ConfigurationValue>; errorCode?: 'CONFIG_INCOMPATIBLE' }
export function runtimeConfigPaths(id: string): readonly string[] {
  if (!validPluginId(id)) fail('INVALID_INPUT')
  return [`config/v3/${id}.json`, `config/v3/${id}.backup.json`]
}
function descriptor(manifest: ManifestV3): PluginConfiguration {
  if (!manifest.configuration) fail('CONFIGURATION_NOT_DECLARED')
  return manifest.configuration
}
function values(configuration: PluginConfiguration, input: unknown): Record<string, ConfigurationValue> {
  try { return resolveConfigurationValues(configuration, input) }
  catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'STORAGE_LIMIT') fail('STORAGE_LIMIT'); fail('INVALID_INPUT') }
}

/** One Host seam, shared by Manager management and separately authorized runtimes. */
export class PluginConfigurationStore {
  constructor(private readonly fs: ManagedFs, private readonly writes: SerialQueue) {}
  private async raw(manifest: ManifestV3): Promise<{ bytes?: Buffer; revision: string }> {
    try {
      const bytes = await this.fs.read(runtimeConfigPaths(manifest.id)[0], FILE_BYTES)
      return { bytes, revision: createHash('sha256').update(bytes).digest('hex') }
    } catch (error) { if (isMissing(error)) return { revision: 'missing' }; throw error }
  }
  private decode(manifest: ManifestV3, raw: { bytes?: Buffer; revision: string }): ConfigurationState {
    const configuration = descriptor(manifest)
    const defaults = values(configuration, {})
    if (!raw.bytes) return { status: 'ready', schemaVersion: configuration.schemaVersion, revision: raw.revision, values: defaults }
    try {
      const stored = record(parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(raw.bytes)), ['storageVersion', 'schemaVersion', 'values'])
      if (stored.storageVersion !== 1 || stored.schemaVersion !== configuration.schemaVersion) fail('CONFIG_INCOMPATIBLE')
      return { status: 'ready', schemaVersion: configuration.schemaVersion, revision: raw.revision, values: values(configuration, stored.values) }
    } catch { return { status: 'incompatible', schemaVersion: configuration.schemaVersion, revision: raw.revision, values: defaults, errorCode: 'CONFIG_INCOMPATIBLE' } }
  }
  async inspect(manifest: ManifestV3): Promise<ConfigurationState> { descriptor(manifest); return this.decode(manifest, await this.raw(manifest)) }
  async get(manifest: ManifestV3): Promise<Record<string, ConfigurationValue>> {
    const state = await this.inspect(manifest)
    if (state.status !== 'ready') fail('CONFIG_INCOMPATIBLE')
    return state.values
  }
  private async commit(manifest: ManifestV3, next: Record<string, ConfigurationValue>, mayCommit: () => boolean): Promise<ConfigurationState> {
    const configuration = descriptor(manifest); const parsed = values(configuration, next)
    await this.fs.mkdir('config/v3')
    await this.fs.atomicJson(runtimeConfigPaths(manifest.id)[0], { storageVersion: 1, schemaVersion: configuration.schemaVersion, values: parsed }, mayCommit)
    return this.inspect(manifest)
  }
  set(manifest: ManifestV3, key: string, value: unknown, mayCommit: () => boolean): Promise<ConfigurationState> {
    return this.writes.run(async () => {
      const setting = descriptor(manifest).settings.find(setting => setting.key === key)
      if (!setting) fail('CONFIGURATION_KEY_NOT_FOUND')
      const parsed = validateSettingValue(setting, value)
      const current = await this.get(manifest)
      return this.commit(manifest, { ...current, [key]: parsed }, mayCommit)
    })
  }
  update(manifest: ManifestV3, input: unknown, revision: string, mayCommit: () => boolean): Promise<ConfigurationState> {
    return this.writes.run(async () => {
      const configuration = descriptor(manifest)
      record(input, configuration.settings.map(setting => setting.key))
      const next = values(configuration, input); const current = await this.inspect(manifest)
      if (current.revision !== revision) fail('CONFIG_STALE')
      if (current.status !== 'ready') fail('CONFIG_INCOMPATIBLE')
      return this.commit(manifest, next, mayCommit)
    })
  }
  reset(manifest: ManifestV3, revision: string, mayCommit: () => boolean): Promise<ConfigurationState> {
    return this.writes.run(async () => {
      const configuration = descriptor(manifest); const raw = await this.raw(manifest)
      if (raw.revision !== revision) fail('CONFIG_STALE')
      if (raw.bytes) {
        await this.fs.mkdir('config/v3')
        await this.fs.atomicJson(runtimeConfigPaths(manifest.id)[1], { backupVersion: 1, originalBase64: raw.bytes.toString('base64') }, mayCommit)
      }
      return this.commit(manifest, values(configuration, {}), mayCommit)
    })
  }
}
