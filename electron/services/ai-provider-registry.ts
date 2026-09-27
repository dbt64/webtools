import { AI_PROVIDER_IDS, isQwenRegion, type AIProviderConfig, type AIProviderId } from '../../src/shared/ai-config.ts'

export type AIAdapterProtocol = 'openai-compatible' | 'anthropic-messages'

export interface AIProviderDescriptor {
  id: AIProviderId
  name: string
  protocol: AIAdapterProtocol
  defaultModel: string
  documentationUrl: string
  modelHint: string
  requiresQwenWorkspace: boolean
}

const PROVIDERS: readonly AIProviderDescriptor[] = [
  { id: 'openai', name: 'OpenAI', protocol: 'openai-compatible', defaultModel: 'gpt-4.1-mini', documentationUrl: 'https://developers.openai.com/api/docs/models/gpt-4.1-mini', modelHint: '例如 gpt-4.1-mini', requiresQwenWorkspace: false },
  { id: 'anthropic', name: 'Anthropic Claude', protocol: 'anthropic-messages', defaultModel: 'claude-sonnet-5', documentationUrl: 'https://platform.claude.com/docs/en/api/messages/create', modelHint: '例如 claude-sonnet-5', requiresQwenWorkspace: false },
  { id: 'gemini', name: 'Google Gemini', protocol: 'openai-compatible', defaultModel: 'gemini-3.8-flash', documentationUrl: 'https://ai.google.dev/gemini-api/docs/openai', modelHint: '例如 gemini-3.8-flash', requiresQwenWorkspace: false },
  { id: 'deepseek', name: 'DeepSeek', protocol: 'openai-compatible', defaultModel: 'deepseek-flash', documentationUrl: 'https://api-docs.deepseek.com/api/create-chat-completion/', modelHint: '例如 deepseek-flash', requiresQwenWorkspace: false },
  { id: 'qwen', name: 'Qwen', protocol: 'openai-compatible', defaultModel: 'qwen3.8-flash', documentationUrl: 'https://help.aliyun.com/en/model-studio/compatibility-of-openai-with-dashscope', modelHint: '例如 qwen3.8-flash', requiresQwenWorkspace: true },
  { id: 'custom', name: '自定义 / OpenAI 兼容', protocol: 'openai-compatible', defaultModel: '', documentationUrl: 'https://developers.openai.com/api/reference/resources/chat', modelHint: '填写服务支持的模型 ID', requiresQwenWorkspace: false },
]

const QWEN_REGION_LABELS: Record<string, string> = {
  'cn-beijing': '中国（北京）',
  'ap-southeast-1': '新加坡',
  'eu-central-1': '德国（法兰克福）',
  'ap-northeast-1': '日本（东京）',
  'cn-hongkong': '中国香港',
  'us-east-1': '美国（弗吉尼亚）',
}

export function getAIProviderDescriptors(): AIProviderDescriptor[] {
  return PROVIDERS.map((provider) => ({ ...provider }))
}

export function getAIProviderDescriptor(providerId: AIProviderId): AIProviderDescriptor {
  const descriptor = PROVIDERS.find((provider) => provider.id === providerId)
  if (!descriptor) throw new Error('不支持的 AI 服务。')
  return { ...descriptor }
}

export function getQwenRegions(): Array<{ id: string; label: string }> {
  return Object.entries(QWEN_REGION_LABELS).map(([id, label]) => ({ id, label }))
}

function appendChatPath(baseUrl: string): URL {
  let url: URL
  try { url = new URL(baseUrl.trim()) } catch { throw new Error('请填写有效的 AI 服务地址。') }
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHosts.has(url.hostname))) {
    throw new Error('AI 服务地址必须使用 HTTPS；本机回环地址可使用 HTTP。')
  }
  if (url.username || url.password) throw new Error('AI 服务地址不能包含账号或密码。')
  if (url.search || url.hash) throw new Error('AI 服务地址不能包含查询参数或片段。')
  url.pathname = `${url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '')}/chat/completions`
  return url
}

export function resolveAIProviderEndpoint(providerId: AIProviderId, config: Partial<AIProviderConfig> = {}): URL {
  switch (providerId) {
    case 'openai': return new URL('https://api.openai.com/v1/chat/completions')
    case 'gemini': return new URL('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
    case 'deepseek': return new URL('https://api.deepseek.com/chat/completions')
    case 'anthropic': return new URL('https://api.anthropic.com/v1/messages')
    case 'qwen': {
      if (!isQwenRegion(config.region)) throw new Error('请选择有效的 Qwen 服务地区。')
      if (typeof config.workspaceId !== 'string' || !/^[a-zA-Z0-9_-]{3,100}$/.test(config.workspaceId)) throw new Error('请填写有效的 Qwen 工作空间 ID。')
      return new URL(`https://${config.workspaceId}.${config.region}.maas.aliyuncs.com/compatible-mode/v1/chat/completions`)
    }
    case 'custom': {
      if (typeof config.baseUrl !== 'string' || !config.baseUrl.trim()) throw new Error('请填写自定义 AI 服务地址。')
      return appendChatPath(config.baseUrl)
    }
    default: {
      const exhaustive: never = providerId
      throw new Error(`不支持的 AI 服务：${exhaustive}`)
    }
  }
}

export function isKnownAIProvider(value: unknown): value is AIProviderId {
  return typeof value === 'string' && (AI_PROVIDER_IDS as readonly string[]).includes(value)
}
