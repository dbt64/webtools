import type { AIProviderId, SharedAISettings } from '../../src/shared/ai-config.ts'
import { isTranslationLanguage, type TranslationProviderInfo, type TranslationRequest, type TranslationResult, type TranslationSettings } from '../../src/shared/translation-contracts.ts'
import { resolveAIProviderEndpoint } from './ai-provider-registry.ts'
import type { AIProviderCredentialStore } from './ai-credentials.ts'
import type { MyMemoryAdapter } from './mymemory-adapter.ts'
import type { QwenMtAdapter } from './qwen-mt-adapter.ts'
import type { SharedAICompletion, SharedAIService } from './shared-ai-service.ts'
import { buildTranslationMessages } from './translation-prompt.ts'
import { ServiceError } from './service-error.ts'

const MAX_TRANSLATION_LENGTH = 20_000
const MAX_TRANSLATION_OUTPUT_LENGTH = 100_000
const DEFAULT_TIMEOUT_MS = 45_000

interface TranslationDataStore {
  snapshot(): { settings: { sharedAI: SharedAISettings; translation: TranslationSettings } }
}

interface SharedAITranslationPort {
  complete(messages: Parameters<SharedAIService['complete']>[0], signal: AbortSignal, maxOutputTokens?: number): Promise<SharedAICompletion>
  getDefaultProviderInfo(): ReturnType<SharedAIService['getDefaultProviderInfo']>
}

export function validateTranslationRequest(value: unknown): value is TranslationRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  if (Object.keys(input).some((key) => !['requestId', 'text', 'sourceLanguage', 'targetLanguage'].includes(key))) return false
  return typeof input.requestId === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(input.requestId)
    && typeof input.text === 'string' && input.text.trim().length > 0 && input.text.length <= MAX_TRANSLATION_LENGTH
    && (input.sourceLanguage === 'auto' || isTranslationLanguage(input.sourceLanguage))
    && isTranslationLanguage(input.targetLanguage)
}

interface ActiveRequest {
  controller: AbortController
  timeout: ReturnType<typeof setTimeout>
}

export class TranslationService {
  private readonly dataStore: TranslationDataStore
  private readonly sharedAI: SharedAITranslationPort
  private readonly aiCredentials: Pick<AIProviderCredentialStore, 'get'>
  private readonly myMemoryAdapter: Pick<MyMemoryAdapter, 'translate'>
  private readonly qwenMtAdapter: Pick<QwenMtAdapter, 'translate'>
  private readonly timeoutMs: number
  private readonly active = new Map<string, ActiveRequest>()

  constructor(deps: {
    dataStore: TranslationDataStore
    sharedAI: SharedAITranslationPort
    aiCredentials: Pick<AIProviderCredentialStore, 'get'>
    myMemoryAdapter: Pick<MyMemoryAdapter, 'translate'>
    qwenMtAdapter: Pick<QwenMtAdapter, 'translate'>
    timeoutMs?: number
  }) {
    this.dataStore = deps.dataStore
    this.sharedAI = deps.sharedAI
    this.aiCredentials = deps.aiCredentials
    this.myMemoryAdapter = deps.myMemoryAdapter
    this.qwenMtAdapter = deps.qwenMtAdapter
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    if (!validateTranslationRequest(request)) throw new ServiceError('INVALID_TRANSLATION', '翻译输入无效。')
    const active = this.beginRequest(request.requestId)
    try {
      const result = await this.runTranslation(request, active.controller.signal)
      if (active.controller.signal.aborted) throw active.controller.signal.reason
      if (result.translation.length > MAX_TRANSLATION_OUTPUT_LENGTH) throw new ServiceError('TRANSLATION_OUTPUT_TOO_LONG', '翻译结果超出允许长度，请缩短原文后重试。')
      return result
    } catch (error) {
      if (active.controller.signal.aborted) {
        if ((active.controller.signal.reason as Error | undefined)?.name === 'TimeoutError') throw new ServiceError('TRANSLATION_TIMEOUT', '翻译请求超时，请稍后重试。')
        throw new ServiceError('TRANSLATION_CANCELLED', '翻译已取消。')
      }
      if (error instanceof ServiceError) throw error
      throw new ServiceError('TRANSLATION_FAILED', error instanceof Error ? error.message : '翻译失败，请稍后重试。')
    } finally {
      this.finishRequest(request.requestId, active)
    }
  }

  cancel(requestId: string): boolean {
    const active = this.active.get(requestId)
    if (!active) return false
    active.controller.abort(new DOMException('Translation cancelled.', 'AbortError'))
    return true
  }

  cancelAll(): number {
    const requests = [...this.active.keys()]
    for (const requestId of requests) this.cancel(requestId)
    return requests.length
  }

  private beginRequest(requestId: string): ActiveRequest {
    this.cancel(requestId)
    const controller = new AbortController()
    const active: ActiveRequest = {
      controller,
      timeout: setTimeout(() => controller.abort(new DOMException('Provider request timed out.', 'TimeoutError')), this.timeoutMs),
    }
    this.active.set(requestId, active)
    return active
  }

  private finishRequest(requestId: string, active: ActiveRequest): void {
    clearTimeout(active.timeout)
    if (this.active.get(requestId) === active) this.active.delete(requestId)
  }

  async getProviderInfo(): Promise<TranslationProviderInfo> {
    const { settings } = this.dataStore.snapshot()
    switch (settings.translation.engine) {
      case 'ai': {
        const info = await this.sharedAI.getDefaultProviderInfo()
        return { engine: 'ai', providerId: info.providerId, providerName: info.providerName, model: info.model, configured: info.configured }
      }
      case 'mymemory':
        return { engine: 'mymemory', providerName: 'MyMemory 免费翻译', configured: true }
      case 'qwen-mt': {
        const qwen = settings.sharedAI.providers.qwen
        let endpointConfigured = false
        try { resolveAIProviderEndpoint('qwen', qwen); endpointConfigured = true } catch { /* Config remains editable in Settings. */ }
        const configured = endpointConfigured && Boolean(await this.aiCredentials.get('qwen'))
        return { engine: 'qwen-mt', providerId: 'qwen', providerName: 'Qwen-MT', model: settings.translation.qwenMtModel, configured }
      }
      default: {
        const exhaustive: never = settings.translation.engine
        throw new ServiceError('TRANSLATION_ENGINE_INVALID', `不支持的翻译引擎：${exhaustive}`)
      }
    }
  }

  private async runTranslation(request: TranslationRequest, signal: AbortSignal): Promise<TranslationResult> {
    const { settings } = this.dataStore.snapshot()
    const { translation, sharedAI } = settings
    switch (translation.engine) {
      case 'ai': {
        const messages = buildTranslationMessages(request.text, request.sourceLanguage, request.targetLanguage)
        const result = await this.sharedAI.complete(messages, signal, 4096)
        return { translation: result.text, provider: this.aiResultInfo(result) }
      }
      case 'mymemory': {
        const text = await this.myMemoryAdapter.translate({ text: request.text, sourceLanguage: request.sourceLanguage, targetLanguage: request.targetLanguage, signal })
        return { translation: text, provider: { engine: 'mymemory', providerName: 'MyMemory 免费翻译', configured: true } }
      }
      case 'qwen-mt': {
        const apiKey = await this.aiCredentials.get('qwen')
        if (!apiKey) throw new ServiceError('TRANSLATION_NOT_CONFIGURED', '请在设置的 AI 区域保存 Qwen API Key。')
        const qwenConfig = sharedAI.providers.qwen
        let endpoint: URL
        try { endpoint = resolveAIProviderEndpoint('qwen', qwenConfig) }
        catch (error) { throw new ServiceError('TRANSLATION_NOT_CONFIGURED', error instanceof Error ? error.message : '请补充 Qwen 地区和工作空间配置。') }
        const text = await this.qwenMtAdapter.translate({ endpoint, apiKey, model: translation.qwenMtModel, text: request.text, sourceLanguage: request.sourceLanguage, targetLanguage: request.targetLanguage, signal })
        return { translation: text, provider: { engine: 'qwen-mt', providerId: 'qwen', providerName: 'Qwen-MT', model: translation.qwenMtModel, configured: true } }
      }
      default: {
        const exhaustive: never = translation.engine
        throw new ServiceError('TRANSLATION_ENGINE_INVALID', `不支持的翻译引擎：${exhaustive}`)
      }
    }
  }

  private aiResultInfo(result: SharedAICompletion): TranslationProviderInfo {
    return { engine: 'ai', providerId: result.providerId, providerName: result.providerName, model: result.model, configured: true }
  }
}
