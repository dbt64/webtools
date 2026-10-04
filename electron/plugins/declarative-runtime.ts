import type { PluginActionResult, PluginJson, PluginPageDTO, PluginSettingValue } from '../../src/shared/plugin-contracts.ts'
import type { AIMessage } from '../services/openai-compatible-adapter.ts'
import type { ValidatedManifest } from './manifest.ts'
import { PluginError, fail } from './errors.ts'
import { PermissionBroker, providerIdentity, validateActionInput, type PluginProviderInfo } from './permission-broker.ts'
import { PluginStore } from './plugin-store.ts'

/** Closed runtime: no module path, source string, process, worker or loader. */
export interface PluginRuntime {
  readonly kind: 'declarative-manager'
  stop(): void
  pages(): PluginPageDTO
}
export class DeclarativeRuntime implements PluginRuntime {
  readonly kind = 'declarative-manager' as const
  readonly manifest: ValidatedManifest
  readonly hash: string
  private readonly iconDataUrlValue?: string
  private readonly operations = new Set<AbortController>()
  private stopped = false
  constructor(manifest: ValidatedManifest, hash: string, assets: Map<string, Buffer>) {
    this.manifest = manifest; this.hash = hash
    const icon = manifest.entry.icon ? assets.get(manifest.entry.icon) : undefined
    this.iconDataUrlValue = icon ? `data:image/png;base64,${icon.toString('base64')}` : undefined
  }
  get invoking(): boolean { return this.operations.size > 0 }
  get iconDataUrl(): string | undefined { return this.stopped ? undefined : this.iconDataUrlValue }
  stop(): void { this.stopped = true; for (const op of this.operations) op.abort(); this.operations.clear() }
  pages(config?: Record<string, PluginSettingValue>): PluginPageDTO {
    if (this.stopped) fail('PLUGIN_DISABLED')
    const m = this.manifest
    return structuredClone({ pluginId: m.id, version: m.version, hash: this.hash, entry: { pageId: m.entry.pageId, label: m.entry.label, ...(this.iconDataUrlValue ? { iconDataUrl: this.iconDataUrlValue } : {}) }, pages: m.pages, settings: m.settings, ...(config ? { config } : {}), actions: m.actions.map(action => ({ id: action.id, type: action.type, ...('key' in action ? { key: action.key } : {}) })) })
  }
  async invoke(actionId: string, input: unknown, broker: PermissionBroker, store: PluginStore, isCurrent: () => boolean, reviewedProvider?: PluginProviderInfo): Promise<PluginActionResult> {
    const action = this.manifest.actions.find(item => item.id === actionId); if (!action) fail('ACTION_NOT_DECLARED')
    const parsed = validateActionInput(action, input)
    const controller = new AbortController(); const signal = controller.signal
    const valid = () => !this.stopped && !signal.aborted && isCurrent()
    if (!valid()) fail('SESSION_EXPIRED')
    this.operations.add(controller)
    let timeout: ReturnType<typeof setTimeout> | undefined
    let removeAbort: () => void = () => undefined
    let reservation: ReturnType<PermissionBroker['reserveAI']> | undefined
    let providerPending = false
    let rejectDeadline: (error: PluginError) => void = () => undefined
    const deadline = new Promise<PluginActionResult>((_, reject) => { rejectDeadline = reject })
    const abortResult = new Promise<PluginActionResult>(resolve => {
      const onAbort = () => resolve({ status: 'cancelled' }); signal.addEventListener('abort', onAbort, { once: true }); removeAbort = () => signal.removeEventListener('abort', onAbort)
    })
    const consent = async (kind: 'external' | 'clipboard' | 'ai', preview: string): Promise<boolean> => {
      if (!valid()) return false
      const accepted = await broker.host.confirm({ kind, pluginId: this.manifest.id, name: this.manifest.name, version: this.manifest.version, preview })
      return accepted && valid()
    }
    const work = async (): Promise<PluginActionResult> => {
      let value: PluginJson = null
      switch (action.type) {
        case 'plugin.config.read': value = (await store.readConfig(this.manifest))[action.key]; break
        case 'plugin.config.write': await store.writeConfig(this.manifest, action.key, parsed, valid); break
        case 'plugin.storage.read': value = await store.readData(this.manifest.id, action.key); break
        case 'plugin.storage.write': await store.writeData(this.manifest.id, action.key, parsed, valid); break
        case 'external.open': if (!await consent('external', action.url)) return { status: 'cancelled' }; await broker.host.externalOpen(action.url); break
        case 'clipboard.write': if (!await consent('clipboard', parsed as string)) return { status: 'cancelled' }; broker.host.clipboardWrite(parsed as string); break
        case 'sharedAI.complete': {
          reservation = broker.reserveAI(this.manifest.id)
          const info = await broker.host.ai.getDefaultProviderInfo()
          const messages = parsed as AIMessage[]
          if (reviewedProvider && providerIdentity(info) !== providerIdentity(reviewedProvider)) fail('USER_CONFIRMATION_REQUIRED')
          const preview = `将以下内容发送至当前共享 AI 提供方 ${info.providerName} (${info.model})。\n${messages.map(m => `[${m.role}]\n${m.content}`).join('\n\n')}`
          if (!reviewedProvider && !await consent('ai', preview)) return { status: 'cancelled' }
          const currentProvider = await broker.host.ai.getDefaultProviderInfo()
          if (currentProvider.providerName !== info.providerName || currentProvider.model !== info.model || currentProvider.identity !== info.identity) fail('USER_CONFIRMATION_REQUIRED')
          if (!valid()) return { status: 'cancelled' }
          reservation.dispatched(); providerPending = true
          timeout = setTimeout(() => { rejectDeadline(new PluginError('AI_TIMEOUT')); controller.abort() }, 60_000)
          const completion = broker.host.ai.complete(messages, signal, 2048)
          // Keep the slot until a noncooperative provider settles, avoiding request stacking.
          completion.finally(() => { providerPending = false; reservation?.release() }).catch(() => undefined)
          const result = await completion; if (!valid()) return { status: 'cancelled' }
          if (typeof result.text !== 'string' || result.text.length > 512 * 1024) fail('ACTION_FAILED')
          value = { text: result.text }; break
        }
        default: { const exhaustive: never = action; return exhaustive }
      }
      return valid() ? { status: 'success', value } : { status: 'cancelled' }
    }
    try {
      return await Promise.race([work(), abortResult, deadline])
    } catch (error) {
      if (!valid() && !(error instanceof PluginError && error.code === 'AI_TIMEOUT')) return { status: 'cancelled' }
      if (error instanceof PluginError) throw error
      return fail('ACTION_FAILED')
    } finally { if (timeout) clearTimeout(timeout); removeAbort(); this.operations.delete(controller); if (!providerPending) reservation?.release() }
  }
}
