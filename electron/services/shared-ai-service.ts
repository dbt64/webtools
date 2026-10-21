import { isCredentialLikeAIValue, type AIProviderConfig, type AIProviderId, type SharedAISettings } from '../../src/shared/ai-config.ts'
import { getAIProviderDescriptor, getAIProviderDescriptors, getQwenRegions, resolveAIProviderEndpoint } from './ai-provider-registry.ts'
import type { AICompletionRequest, AIMessage, OpenAICompatibleAdapter } from './openai-compatible-adapter.ts'
import type { AnthropicMessagesAdapter } from './anthropic-messages-adapter.ts'
import type { AIProviderCredentialStore } from './ai-credentials.ts'
import { ServiceError } from './service-error.ts'

interface SharedAISettingsStore {
  snapshot(): { settings: { sharedAI: SharedAISettings } }
}

type CompletionAdapter = Pick<OpenAICompatibleAdapter | AnthropicMessagesAdapter, 'complete'>

export interface AIProviderInfo {
  providerId: AIProviderId
  providerName: string
  model: string
  hasApiKey: boolean
  configured: boolean
  documentationUrl: string
  requiresQwenWorkspace: boolean
}

export interface SharedAICompletion {
  text: string
  providerId: AIProviderId
  providerName: string
  model: string
}

export class SharedAIService {
  private readonly dataStore: SharedAISettingsStore
  private readonly credentials: Pick<AIProviderCredentialStore, 'get'>
  private readonly openAICompatibleAdapter: CompletionAdapter
  private readonly anthropicAdapter: CompletionAdapter

  constructor(deps: {
    dataStore: SharedAISettingsStore
    credentials: Pick<AIProviderCredentialStore, 'get'>
    openAICompatibleAdapter: CompletionAdapter
    anthropicAdapter: CompletionAdapter
  }) {
    this.dataStore = deps.dataStore
    this.credentials = deps.credentials
    this.openAICompatibleAdapter = deps.openAICompatibleAdapter
    this.anthropicAdapter = deps.anthropicAdapter
  }

  getProviderDescriptors() { return getAIProviderDescriptors() }
  getQwenRegions() { return getQwenRegions() }

  async getDefaultProviderInfo(): Promise<AIProviderInfo> {
    return this.getProviderInfo(this.dataStore.snapshot().settings.sharedAI.defaultProviderId)
  }

  async getProviderInfo(providerId: AIProviderId): Promise<AIProviderInfo> {
    const settings = this.dataStore.snapshot().settings.sharedAI
    const descriptor = getAIProviderDescriptor(providerId)
    const config = settings.providers[providerId]
    const resolvedModel = this.resolveModel(providerId, descriptor.defaultModel, config)
    const apiKey = await this.credentials.get(providerId)
    const model = isCredentialLikeAIValue(resolvedModel) || resolvedModel === apiKey ? '' : resolvedModel
    let endpointValid = false
    try { resolveAIProviderEndpoint(providerId, config) ; endpointValid = true } catch { /* Setup screen reports incomplete provider config. */ }
    return {
      providerId,
      providerName: descriptor.name,
      model,
      hasApiKey: apiKey !== null,
      configured: Boolean(apiKey && model && endpointValid),
      documentationUrl: descriptor.documentationUrl,
      requiresQwenWorkspace: descriptor.requiresQwenWorkspace,
    }
  }

  async complete(messages: AIMessage[], signal: AbortSignal, maxOutputTokens = 2048,
    onOutputTokens?: (tokens: number | null) => void): Promise<SharedAICompletion> {
    const settings = this.dataStore.snapshot().settings.sharedAI
    return this.completeWithProvider(settings.defaultProviderId, messages, signal, maxOutputTokens, onOutputTokens)
  }

  async testConnection(signal: AbortSignal, providerId?: AIProviderId): Promise<SharedAICompletion> {
    // Manager may test another saved provider without changing the platform default.
    // Plugin complete() continues to use only the Host-owned global default.
    const selected = providerId ?? this.dataStore.snapshot().settings.sharedAI.defaultProviderId
    const result = await this.completeWithProvider(selected, [
      { role: 'system', content: 'Reply with the exact text READY.' },
      { role: 'user', content: 'Reply READY now.' },
    ], signal, 16)
    return result
  }

  async completeWithProvider(providerId: AIProviderId, messages: AIMessage[], signal: AbortSignal, maxOutputTokens: number,
    onOutputTokens?: (tokens: number | null) => void): Promise<SharedAICompletion> {
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 100
      || messages.some((message) => !message || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || message.content.length > 50_000)) {
      throw new ServiceError('INVALID_AI_REQUEST', 'AI 请求内容无效。')
    }
    const descriptor = getAIProviderDescriptor(providerId)
    const config = this.dataStore.snapshot().settings.sharedAI.providers[providerId]
    const model = this.resolveModel(providerId, descriptor.defaultModel, config)
    if (!model) throw new ServiceError('AI_NOT_CONFIGURED', '请在设置的 AI 区域填写模型名称。')
    const apiKey = await this.credentials.get(providerId)
    if (!apiKey) throw new ServiceError('AI_NOT_CONFIGURED', `请在设置中保存 ${descriptor.name} API Key。`)
    if (isCredentialLikeAIValue(model) || model === apiKey) throw new ServiceError('AI_CONFIGURATION_INVALID', '模型 ID 中不能填写 API Key，请重新配置模型和凭据。')

    let endpoint: URL
    try { endpoint = resolveAIProviderEndpoint(providerId, config) }
    catch (error) { throw new ServiceError('AI_CONFIGURATION_INVALID', error instanceof Error ? error.message : 'AI 服务配置无效。') }

    const request: AICompletionRequest = { endpoint, apiKey, model, messages, signal, maxOutputTokens, ...(onOutputTokens ? { onOutputTokens } : {}) }
    const adapter = descriptor.protocol === 'anthropic-messages' ? this.anthropicAdapter : this.openAICompatibleAdapter
    const text = await adapter.complete(request)
    return { text, providerId, providerName: descriptor.name, model }
  }

  private resolveModel(providerId: AIProviderId, defaultModel: string, config: AIProviderConfig | undefined): string {
    if (providerId === 'custom') return config?.model.trim() ?? ''
    return config?.model.trim() || defaultModel
  }
}
