export const AI_PROVIDER_IDS = ['openai', 'anthropic', 'gemini', 'deepseek', 'qwen', 'custom'] as const
export type AIProviderId = typeof AI_PROVIDER_IDS[number]

export const QWEN_REGIONS = ['cn-beijing', 'ap-southeast-1', 'eu-central-1', 'ap-northeast-1', 'cn-hongkong', 'us-east-1'] as const
export type QwenRegion = typeof QWEN_REGIONS[number]

export interface AIProviderConfig {
  model: string
  baseUrl?: string
  region?: QwenRegion
  workspaceId?: string
}

export interface SharedAISettings {
  defaultProviderId: AIProviderId
  providers: Partial<Record<AIProviderId, AIProviderConfig>>
}

export function isAIProviderId(value: unknown): value is AIProviderId {
  return typeof value === 'string' && (AI_PROVIDER_IDS as readonly string[]).includes(value)
}

export function isQwenRegion(value: unknown): value is QwenRegion {
  return typeof value === 'string' && (QWEN_REGIONS as readonly string[]).includes(value)
}

export function createDefaultSharedAISettings(): SharedAISettings {
  return { defaultProviderId: 'openai', providers: {} }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeProviderConfig(providerId: AIProviderId, value: unknown): AIProviderConfig | undefined {
  if (!isRecord(value)) return undefined
  const config: AIProviderConfig = {
    model: typeof value.model === 'string' && value.model.length <= 120 ? value.model : '',
  }
  if (providerId === 'custom' && typeof value.baseUrl === 'string' && value.baseUrl.length <= 500) {
    config.baseUrl = value.baseUrl
  }
  if (providerId === 'qwen') {
    if (isQwenRegion(value.region)) config.region = value.region
    if (typeof value.workspaceId === 'string' && value.workspaceId.length <= 100 && /^[a-zA-Z0-9_-]*$/.test(value.workspaceId)) {
      config.workspaceId = value.workspaceId
    }
  }
  return config
}

export function normalizeSharedAISettings(value: unknown, legacyBaseUrl = '', legacyModel = ''): SharedAISettings {
  const providers: SharedAISettings['providers'] = {}
  if (isRecord(value) && isRecord(value.providers)) {
    for (const providerId of AI_PROVIDER_IDS) {
      const normalized = normalizeProviderConfig(providerId, value.providers[providerId])
      if (normalized) providers[providerId] = normalized
    }
  }

  const hasLegacyConfig = Boolean(legacyBaseUrl.trim() || legacyModel.trim())
  if (!providers.custom && hasLegacyConfig) {
    providers.custom = { model: legacyModel, baseUrl: legacyBaseUrl }
  }
  const requestedDefault = isRecord(value) && isAIProviderId(value.defaultProviderId)
    ? value.defaultProviderId
    : hasLegacyConfig ? 'custom' : 'openai'

  return { defaultProviderId: requestedDefault, providers }
}

export function isValidSharedAISettings(value: unknown): value is SharedAISettings {
  if (!isRecord(value) || !isAIProviderId(value.defaultProviderId) || !isRecord(value.providers)) return false
  if (Object.keys(value).some((key) => !['defaultProviderId', 'providers'].includes(key))) return false
  for (const [providerId, rawConfig] of Object.entries(value.providers)) {
    if (!isAIProviderId(providerId) || !isRecord(rawConfig)) return false
    if (typeof rawConfig.model !== 'string' || rawConfig.model.length > 120) return false
    if (providerId === 'custom') {
      if (Object.keys(rawConfig).some((key) => !['model', 'baseUrl'].includes(key))) return false
      if (rawConfig.baseUrl !== undefined) {
        if (typeof rawConfig.baseUrl !== 'string' || rawConfig.baseUrl.length > 500) return false
        if (rawConfig.baseUrl.trim()) {
          try {
            const url = new URL(rawConfig.baseUrl.trim())
            const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
            if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && localHosts.has(url.hostname)))
              || url.username || url.password || url.search || url.hash) return false
          } catch { return false }
        }
      }
    } else if ('baseUrl' in rawConfig) return false
    if (providerId === 'qwen') {
      if (Object.keys(rawConfig).some((key) => !['model', 'region', 'workspaceId'].includes(key))) return false
      if (rawConfig.region !== undefined && !isQwenRegion(rawConfig.region)) return false
      if (rawConfig.workspaceId !== undefined && (typeof rawConfig.workspaceId !== 'string' || rawConfig.workspaceId.length > 100 || !/^[a-zA-Z0-9_-]*$/.test(rawConfig.workspaceId))) return false
    } else if ('region' in rawConfig || 'workspaceId' in rawConfig) return false
    else if (Object.keys(rawConfig).some((key) => key !== 'model')) return false
  }
  return true
}
