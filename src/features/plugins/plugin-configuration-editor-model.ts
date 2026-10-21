import type { PluginApi, PluginConfigurationDTO, PluginConfigurationIdentity, PluginSettingValue } from '../../shared/plugin-contracts.ts'
import { validateSettingValue } from '../../../plugin-sdk/declarative-v1/runtime/manifest-v1.mjs'

type ConfigurationApi = Pick<PluginApi, 'getConfiguration' | 'updateConfiguration' | 'resetConfiguration'>
function message(code: string): string {
  const messages: Record<string, string> = {
    CONFIG_STALE: '设置已被其他操作修改。请重新加载后再保存。',
    CONFIG_INCOMPATIBLE: '保存的设置与当前插件版本不兼容，原文件仍已保留。',
    USER_CONFIRMATION_REQUIRED: '已取消恢复默认设置。',
    INTEGRITY_FAILED: '插件版本已变化，请重新打开当前插件详情。',
    SESSION_EXPIRED: '管理会话已结束，请重新打开插件管理。',
    INTENT_SUPERSEDED: '插件正在更改状态，请重新读取设置。',
    CONFIGURATION_NOT_DECLARED: '此插件没有声明可用配置。',
    STORAGE_LIMIT: '插件设置超过保存限制，请减少内容后再保存。',
  }
  return messages[code] ?? '插件设置操作未完成，请重新读取后重试。'
}

/** Transient Manager draft only; Host owns descriptors, identity, revision and effects. */
export class PluginConfigurationEditorModel {
  state: PluginConfigurationDTO | null = null
  draft: Record<string, PluginSettingValue> = {}
  loading = false
  busy = false
  message = ''
  messageKind: 'status' | 'error' = 'status'
  private generation = 0
  constructor(private readonly api: ConfigurationApi) {}
  get settings() { return this.state && this.state.status !== 'unavailable' ? this.state.settings : [] }
  get dirty(): boolean { return this.state?.status === 'ready' && this.settings.some(setting => this.draft[setting.key] !== (this.state?.status === 'ready' ? this.state.values[setting.key] : undefined)) }
  get errors(): Record<string, string> {
    const errors: Record<string, string> = {}
    for (const setting of this.settings) {
      try { validateSettingValue(setting, this.draft[setting.key]) }
      catch { errors[setting.key] = setting.type === 'number' ? `请输入 ${setting.min} 至 ${setting.max} 的有效数字。` : '内容不符合此配置项的类型或范围。' }
    }
    return errors
  }
  private adopt(state: PluginConfigurationDTO): void { this.state = state; this.draft = state.status === 'unavailable' ? {} : { ...state.values } }
  async select(identity: PluginConfigurationIdentity): Promise<void> {
    const generation = ++this.generation
    this.state = null; this.draft = {}; this.loading = true; this.busy = false; this.message = ''
    try {
      const result = await this.api.getConfiguration({ ...identity })
      if (generation !== this.generation) return
      if (result.ok) this.adopt(result.data)
      else { this.message = message(result.error.code); this.messageKind = 'error' }
    } catch { if (generation === this.generation) { this.message = '无法读取插件设置，请重试。'; this.messageKind = 'error' } }
    finally { if (generation === this.generation) this.loading = false }
  }
  cancel(): void { if (this.state) this.adopt(this.state); this.message = '' }
  async save(): Promise<void> {
    if (this.busy || this.loading || this.state?.status !== 'ready') return
    if (Object.keys(this.errors).length) { this.message = '请先修正配置内容。'; this.messageKind = 'error'; return }
    const state = this.state
    await this.operate(() => this.api.updateConfiguration({ ...state.identity, revision: state.revision, values: { ...this.draft } }), '设置已保存。')
  }
  async reset(): Promise<void> {
    if (this.busy || this.loading || !this.state || this.state.status === 'unavailable') return
    const state = this.state
    await this.operate(() => this.api.resetConfiguration({ ...state.identity, revision: state.revision }), '默认设置已恢复；之前的设置已保存为备份。')
  }
  private async operate(action: () => Promise<import('../../shared/ipc.ts').IpcResult<PluginConfigurationDTO>>, success: string): Promise<void> {
    const generation = this.generation; this.busy = true; this.message = ''
    try {
      const result = await action()
      if (generation !== this.generation) return
      if (result.ok) { this.adopt(result.data); this.message = success; this.messageKind = 'status' }
      else { this.message = message(result.error.code); this.messageKind = result.error.code === 'USER_CONFIRMATION_REQUIRED' ? 'status' : 'error' }
    } catch { if (generation === this.generation) { this.message = '插件设置操作未完成，请重试。'; this.messageKind = 'error' } }
    finally { if (generation === this.generation) this.busy = false }
  }
  dispose(): void { this.generation++; this.loading = false; this.busy = false }
}
