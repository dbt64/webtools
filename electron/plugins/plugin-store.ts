import type { PluginJson, PluginSettingValue } from '../../src/shared/plugin-contracts.ts'
import { LIMITS, opaqueKey, parseStrictJson, record, validPluginId, validateSettingValue, type ValidatedManifest } from './manifest.ts'
import { ManagedFs, SerialQueue, isMissing } from './managed-fs.ts'
import { fail } from './errors.ts'

export class PluginStore {
  private readonly writes = new SerialQueue()
  readonly fs: ManagedFs
  constructor(fs: ManagedFs) { this.fs = fs }
  private validateDocument(values: Record<string, PluginJson>): void {
    const json = JSON.stringify(values)
    if (Object.keys(values).length > LIMITS.keys || Buffer.byteLength(json) > LIMITS.data) fail('STORAGE_LIMIT')
    // The on-disk envelope counts towards the reader's depth budget.
    try { parseStrictJson(json) } catch { fail('STORAGE_LIMIT') }
  }
  private logical(scope: 'data' | 'config', id: string): string { if (!validPluginId(id)) fail('INVALID_INPUT'); return `${scope}/${id}.json` }
  private async readValues(scope: 'data' | 'config', id: string): Promise<Record<string, PluginJson>> {
    try {
      const bytes = await this.fs.read(this.logical(scope, id), LIMITS.data)
      const data = parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      if (!data || typeof data !== 'object' || Array.isArray(data)) fail('STORAGE_INVALID')
      const values = data as Record<string, PluginJson>
      if (Object.keys(values).length > LIMITS.keys) fail('STORAGE_INVALID')
      for (const [key, value] of Object.entries(values)) { opaqueKey(key); this.validateJson(value) }
      return values
    } catch (error) { if (isMissing(error)) return {}; fail('STORAGE_INVALID') }
  }
  validateJson(value: unknown): PluginJson {
    let json: string
    try { json = JSON.stringify(value); if (typeof json !== 'string' || Buffer.byteLength(json) > LIMITS.value) fail('STORAGE_LIMIT') } catch { fail('STORAGE_LIMIT') }
    // Round trip excludes non-JSON values, cycles/prototypes and excessive nesting.
    const result = parseStrictJson(json)
    const check = (input: unknown): void => {
      if (input === null || typeof input === 'string' || typeof input === 'boolean') return
      if (typeof input === 'number' && Number.isFinite(input)) return
      if (Array.isArray(input)) { for (const item of input) check(item); return }
      if (input && typeof input === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(input))) { for (const item of Object.values(input)) check(item); return }
      fail('INVALID_INPUT')
    }
    check(value); return result
  }
  async readConfig(manifest: ValidatedManifest): Promise<Record<string, PluginSettingValue>> {
    const saved = await this.readValues('config', manifest.id); const settings = manifest.settings
    try {
      record(saved, [], settings.map(setting => setting.key))
      const result: Record<string, PluginSettingValue> = {}
      for (const setting of settings) result[setting.key] = validateSettingValue(setting, Object.hasOwn(saved, setting.key) ? saved[setting.key] : setting.default)
      return result
    } catch { fail('CONFIG_INCOMPATIBLE') }
  }
  async writeConfig(manifest: ValidatedManifest, key: string, value: unknown, mayCommit: () => boolean): Promise<void> {
    return this.writes.run(async () => {
      const setting = manifest.settings.find(item => item.key === key); if (!setting) fail('INVALID_INPUT')
      const parsed = validateSettingValue(setting, value); await this.readConfig(manifest)
      const saved = await this.readValues('config', manifest.id); saved[key] = parsed
      this.validateDocument(saved)
      await this.fs.atomicJson(this.logical('config', manifest.id), saved, mayCommit)
    })
  }
  async readData(id: string, key: string): Promise<PluginJson> { opaqueKey(key); const data = await this.readValues('data', id); return data[key] ?? null }
  async writeData(id: string, key: string, value: unknown, mayCommit: () => boolean): Promise<void> {
    opaqueKey(key); const parsed = this.validateJson(value)
    return this.writes.run(async () => {
      const data = await this.readValues('data', id); data[key] = parsed
      this.validateDocument(data)
      await this.fs.atomicJson(this.logical('data', id), data, mayCommit)
    })
  }
  async deletePrivateData(id: string): Promise<void> {
    await this.writes.run(async () => { for (const scope of ['config', 'data'] as const) await this.fs.remove(await this.fs.path(this.logical(scope, id))) })
  }
  async flush(): Promise<void> { await this.writes.run(async () => undefined) }
}
