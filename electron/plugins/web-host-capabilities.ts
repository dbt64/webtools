import { BridgeWireError, measureUtf8, type JsonValue } from '../../plugin-sdk/declarative-v1/web/protocol.mjs'
import { validateCapabilityRequest, validateCapabilityResult, type CapabilityRequest } from '../../plugin-sdk/declarative-v1/web/capability-methods.mjs'
import type { CapabilityV2 } from '../../plugin-sdk/declarative-v1/runtime/manifest-v2.mjs'
import type { PluginConsent } from './permission-broker.ts'
import type { PluginStore } from './plugin-store.ts'
import { isWebFeatureAuthority, type WebFeatureAuthority } from './web-feature-authority.ts'
import { isValidatedPluginPackageSnapshotV3 } from './validated-plugin-package-snapshot.ts'
import type { SharedAIService } from '../services/shared-ai-service.ts'
import { validateInvocationContext, acceptsInvocationContext, type InvocationContext } from '../../plugin-sdk/declarative-v1/web/invocation-context.mjs'

export type InvocationTextContext = InvocationContext & { readonly ageMs: number }
export interface WebCapabilityEffects {
  confirm(request: PluginConsent, signal?: AbortSignal): Promise<boolean>
  hasForegroundGesture(): boolean
  isAIConfigured(): Promise<boolean>
  completeAI(prompt: string, signal: AbortSignal): Promise<{ text: string; outputTokens?: number | null }>
  clipboardWrite(text: string): void
  externalOpen?(url: string): Promise<void>
}
interface Dependencies {
  authority: WebFeatureAuthority; store: PluginStore; effects: WebCapabilityEffects
  isRuntimeCurrent(): boolean; context?: InvocationTextContext; now?: () => number
}
/** Reuse SharedAIService; retain only output usage internally and strip provider metadata. */
export async function completeSharedAIForWeb(service: Pick<SharedAIService, 'complete'>, prompt: string, signal: AbortSignal) {
  let outputTokens: number | null = null
  const result = await service.complete([{ role: 'user', content: prompt }], signal, 1024, tokens => { outputTokens = tokens })
  return { text: result.text, outputTokens }
}
const fail = (code: ConstructorParameters<typeof BridgeWireError>[0]): never => { throw new BridgeWireError(code) }
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new BridgeWireError('CANCELLED'))
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new BridgeWireError('CANCELLED')) }
    signal.addEventListener('abort', abort, { once: true })
    work.then(value => { signal.removeEventListener('abort', abort); resolve(value) }, error => { signal.removeEventListener('abort', abort); reject(error) })
  })
}

/** One active runtime; registry authority, namespaces, credentials and effects stay Main-owned. */
export class WebHostCapabilities {
  private readonly deps: Dependencies
  private readonly now: () => number
  private readonly controller = new AbortController()
  private readonly rates = new Map<string, number[]>()
  private context: InvocationContext | null = null
  private contextCreatedAt = 0
  private contextDelivered = false
  private contextExpired = false
  private contextTimer?: ReturnType<typeof setTimeout>
  private aiBusy = false
  private removeRevoke: () => void = () => {}
  constructor(deps: Dependencies) {
    if (!isWebFeatureAuthority(deps.authority) || !deps.authority.isCurrent()) fail('UNAUTHORIZED')
    this.deps = { authority: deps.authority, store: deps.store, effects: deps.effects, isRuntimeCurrent: deps.isRuntimeCurrent }
    this.now = deps.now ?? (() => performance.now())
    this.setContext(deps.context)
    this.removeRevoke = deps.authority.onRevoke(() => this.dispose())
  }
  setContext(input?: InvocationTextContext): void {
    this.context = null; this.contextDelivered = false; this.contextExpired = false; clearTimeout(this.contextTimer)
    const feature = this.deps.authority.snapshot.manifest.features.find(f => f.id === this.deps.authority.featureId)!
    if (input) {
      const { ageMs, ...payload } = input
      const context = validateInvocationContext(payload)
      if (!context || !acceptsInvocationContext(feature.acceptedContexts, context)) return
      if (input.source === 'clipboard' && !this.deps.authority.isCurrent('clipboard.read')) fail('PERMISSION_DENIED')
      if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs >= 30000) fail('CONTEXT_EXPIRED')
      this.context = context
      this.contextCreatedAt = this.now() - ageMs; this.armContextExpiry(30000)
    }
  }
  dispose(): void {
    this.controller.abort(); this.context = null; clearTimeout(this.contextTimer); this.rates.clear(); this.removeRevoke()
  }
  private armContextExpiry(ttl: number): void {
    clearTimeout(this.contextTimer)
    this.contextTimer = setTimeout(() => {
      this.context = null
      this.contextExpired = true
      this.deps.authority.revoke()
    }, Math.max(0, this.contextCreatedAt + ttl - this.now()))
    this.contextTimer.unref?.()
  }
  private check(signal: AbortSignal, capability?: CapabilityV2): void {
    if (!this.deps.authority.isCurrent() || !this.deps.isRuntimeCurrent()) fail('STALE_RUNTIME')
    if (signal.aborted || this.controller.signal.aborted) fail('CANCELLED')
    if (capability && !this.deps.authority.isCurrent(capability)) fail('PERMISSION_DENIED')
  }
  private rate(name: string, limit: number): void {
    const now = this.now(); const times = (this.rates.get(name) ?? []).filter(time => now - time < 60000)
    if (times.length >= limit) fail('LIMIT_EXCEEDED')
    times.push(now); this.rates.set(name, times)
  }
  private async consent(kind: 'ai' | 'clipboard', text: string, signal: AbortSignal, capability: CapabilityV2): Promise<void> {
    this.check(signal, capability)
    if (!this.deps.effects.hasForegroundGesture()) fail('USER_CANCELLED')
    const manifest = this.deps.authority.snapshot.manifest
    const preview = text.length > 4096 ? `${text.slice(0, 4096)}\n…（预览已缩略，共 ${measureUtf8(text)} UTF-8 字节）` : text
    const accepted = await abortable(this.deps.effects.confirm({ kind, pluginId: manifest.id, name: manifest.name,
      version: manifest.version, manifestVersion: manifest.manifestVersion,
      ...(manifest.manifestVersion === 3 ? { runtimeKind: manifest.runtime.kind } : {}), preview }, signal), signal)
    this.check(signal, capability)
    if (!accepted) fail('USER_CANCELLED')
  }
  async dispatch(value: CapabilityRequest, inputSignal: AbortSignal): Promise<JsonValue> {
    const request = validateCapabilityRequest(value.method, value.payload)
    const signal = AbortSignal.any([inputSignal, this.controller.signal])
    this.check(signal)
    try {
      switch (request.method) {
        case 'context.current': {
          if (this.contextExpired || this.context && this.now() >= this.contextCreatedAt + (this.contextDelivered ? 600000 : 30000)) {
            this.context = null; this.contextExpired = true; clearTimeout(this.contextTimer); this.deps.authority.revoke(); fail('CONTEXT_EXPIRED')
          }
          if (!this.context) return null
          const result = this.context.type === 'text' ? { ...this.context } : { ...this.context, items: this.context.items.map(item => ({ ...item })) }
          this.contextDelivered = true; this.armContextExpiry(600000)
          if (result.source === 'clipboard') { this.context = null; clearTimeout(this.contextTimer) }
          return result
        }
        case 'storage.get': case 'storage.set': case 'storage.delete': {
          const cap = request.method === 'storage.get' ? 'plugin.storage.read' : 'plugin.storage.write'
          this.check(signal, cap); this.rate('storage', 60)
          const id = this.deps.authority.snapshot.manifest.id
          let result: JsonValue = null
          const mayCommit = () => !signal.aborted && this.deps.isRuntimeCurrent() && this.deps.authority.isCurrent(cap)
          if (request.method === 'storage.get') result = await abortable(this.deps.store.readData(id, request.payload.key), signal)
          else if (request.method === 'storage.set') await abortable(this.deps.store.writeData(id, request.payload.key, request.payload.value, mayCommit), signal)
          else await abortable(this.deps.store.deleteData(id, request.payload.key, mayCommit), signal)
          this.check(signal, cap); validateCapabilityResult(request.method, result); return result
        }
        case 'config.get': case 'config.set': {
          const cap = request.method === 'config.get' ? 'plugin.config.read' : 'plugin.config.write'
          this.check(signal, cap); this.rate('config', 60)
          const snapshot = this.deps.authority.snapshot
          if (!isValidatedPluginPackageSnapshotV3(snapshot)) return fail('CONFIGURATION_NOT_DECLARED')
          const manifest = snapshot.manifest
          if (!manifest.configuration) return fail('CONFIGURATION_NOT_DECLARED')
          const mayCommit = () => !signal.aborted && this.deps.isRuntimeCurrent() && this.deps.authority.isCurrent(cap)
          let result: JsonValue = null
          if (request.method === 'config.get') result = await abortable(this.deps.store.configuration.get(manifest), signal)
          else await abortable(this.deps.store.configuration.set(manifest, request.payload.key, request.payload.value, mayCommit), signal)
          this.check(signal, cap); validateCapabilityResult(request.method, result); return result
        }
        case 'ai.complete': {
          this.check(signal, 'sharedAI.complete')
          if (this.aiBusy) fail('LIMIT_EXCEEDED')
          this.rate('ai', 5); this.aiBusy = true
          try {
            if (!await abortable(this.deps.effects.isAIConfigured(), signal)) fail('NOT_AVAILABLE')
            this.check(signal, 'sharedAI.complete')
            await this.consent('ai', request.payload.prompt, signal, 'sharedAI.complete')
            this.check(signal, 'sharedAI.complete')
            const response = await abortable(this.deps.effects.completeAI(request.payload.prompt, signal), signal)
            this.check(signal, 'sharedAI.complete')
            if (typeof response.outputTokens !== 'number' || !Number.isSafeInteger(response.outputTokens) || response.outputTokens < 0) return fail('NOT_AVAILABLE')
            if (response.outputTokens > 1024) fail('LIMIT_EXCEEDED')
            const result = { text: response.text }; validateCapabilityResult(request.method, result); return result
          } finally { this.aiBusy = false }
        }
        case 'external.open':
          this.check(signal, 'external.open')
          if (!this.deps.effects.externalOpen) return fail('NOT_AVAILABLE')
          if (!this.deps.effects.hasForegroundGesture()) return fail('USER_CANCELLED')
          this.check(signal, 'external.open')
          await this.deps.effects.externalOpen(request.payload.url)
          this.check(signal, 'external.open')
          return null
        case 'clipboard.write':
          this.check(signal, 'clipboard.write'); this.rate('clipboard', 5)
          await this.consent('clipboard', request.payload.text, signal, 'clipboard.write')
          this.check(signal, 'clipboard.write'); this.deps.effects.clipboardWrite(request.payload.text); return null
      }
      return fail('NOT_AVAILABLE')
    } catch (error) {
      if (error instanceof BridgeWireError) throw error
      this.check(signal)
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
      if (code === 'CONFIGURATION_NOT_DECLARED' || code === 'CONFIGURATION_KEY_NOT_FOUND' || code === 'CONFIG_INCOMPATIBLE') return fail(code)
      return fail(code === 'STORAGE_LIMIT' ? 'LIMIT_EXCEEDED' : code === 'INVALID_INPUT' ? 'INVALID_REQUEST' : 'INTERNAL_ERROR')
    }
  }
}
