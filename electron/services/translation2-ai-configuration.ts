import { cloneSharedAISettings, isAIProviderId, isValidSharedAISettings, safeAIModel, type AIProviderConfig, type AIProviderId } from '../../src/shared/ai-config.ts'
import type { AppData } from '../../src/shared/domain.ts'
import type { AIProviderCredentialStore } from './ai-credentials.ts'
import type { SharedAIService } from './shared-ai-service.ts'
import { getAIProviderDescriptor } from './ai-provider-registry.ts'

export class Translation2AIConfiguration {
  private pending: Promise<unknown> = Promise.resolve()
  constructor(private readonly deps: {
    store: { snapshot(): AppData; update(mutator: (data: AppData) => AppData): Promise<AppData> }
    credentials: Pick<AIProviderCredentialStore, 'get' | 'set' | 'clear'>
    sharedAI: Pick<SharedAIService, 'getProviderInfo' | 'testConnection'>
  }) {}

  async get(providerId: AIProviderId) {
    if (!isAIProviderId(providerId)) throw new Error('AI 提供方无效。')
    const descriptor = getAIProviderDescriptor(providerId)
    const settings = cloneSharedAISettings(this.deps.store.snapshot().settings.sharedAI)
    const config = settings.providers[providerId] ?? { model: '' }
    const info = await this.deps.sharedAI.getProviderInfo(providerId)
    const credential = await this.deps.credentials.get(providerId)
    return { providerId, name: descriptor.name, defaultModel: descriptor.defaultModel,
      config: { ...config, model: config.model === credential ? '' : safeAIModel(config.model) }, hasApiKey: info.hasApiKey, configured: info.configured }
  }

  save(value: { providerId: AIProviderId; config: AIProviderConfig; secret?: string }) {
    const operation = this.pending.then(async () => {
      if (!value || !isAIProviderId(value.providerId) || Object.keys(value).some(key => !['providerId', 'config', 'secret'].includes(key))) throw new Error('AI 配置无效。')
      const { providerId } = value
      const sharedAI = cloneSharedAISettings(this.deps.store.snapshot().settings.sharedAI)
      sharedAI.providers[providerId] = value.config
      if (!isValidSharedAISettings(sharedAI)) throw new Error('模型 ID 或地址无效；API Key 必须填写在独立的密钥框中。')
      if (value.secret !== undefined && (typeof value.secret !== 'string' || value.secret.length > 4096 || /[\r\n]/.test(value.secret))) throw new Error('API Key 格式无效。')
      const previous = await this.deps.credentials.get(providerId)
      const secret = value.secret?.trim()
      if (value.config.model && (value.config.model === previous || value.config.model === secret)) throw new Error('模型 ID 中不能填写 API Key。')
      if (secret) await this.deps.credentials.set(providerId, secret)
      try {
        await this.deps.store.update(data => ({ ...data, settings: { ...data.settings,
          sharedAI: { ...data.settings.sharedAI, providers: { ...data.settings.sharedAI.providers, [providerId]: { ...value.config } } } } }))
      } catch (error) {
        if (secret) { if (previous === null) await this.deps.credentials.clear(providerId); else await this.deps.credentials.set(providerId, previous) }
        throw error
      }
      return this.get(providerId)
    })
    this.pending = operation.catch(() => undefined)
    return operation
  }

  async test(providerId: AIProviderId): Promise<{ connected: true }> {
    if (!isAIProviderId(providerId)) throw new Error('AI 提供方无效。')
    await this.deps.sharedAI.testConnection(AbortSignal.timeout(30_000), providerId)
    return { connected: true }
  }
}
