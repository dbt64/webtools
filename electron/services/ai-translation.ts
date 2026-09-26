import type { AppSettings } from '../../src/shared/domain'
import { DataStore } from './data-store'
import { SecretStore } from './secret-store'

const REQUEST_TIMEOUT_MS = 45_000
const MAX_TRANSLATION_LENGTH = 20_000

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>
  model?: string
}

function resolveChatEndpoint(baseUrl: string): URL {
  let url: URL
  try { url = new URL(baseUrl.trim()) } catch { throw new Error('请填写有效的 AI 服务地址。') }
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHosts.has(url.hostname))) {
    throw new Error('AI 服务地址必须使用 HTTPS；本机回环地址可使用 HTTP。')
  }
  if (url.username || url.password || url.search || url.hash) throw new Error('AI 服务地址不能包含账号、密码、查询参数或片段。')
  const cleanPath = url.pathname.replace(/\/+$/, '')
  url.pathname = cleanPath.endsWith('/chat/completions') ? cleanPath : `${cleanPath}/chat/completions`
  return url
}

function getMessageContent(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('choices' in value) || !Array.isArray(value.choices)) return null
  const content = (value as ChatCompletionResponse).choices?.[0]?.message?.content
  return typeof content === 'string' && content.trim() ? content.trim() : null
}

function providerError(status: number): string {
  if (status === 401 || status === 403) return 'API Key 无效或没有调用权限。'
  if (status === 404) return '找不到接口或模型，请检查服务地址和模型名称。'
  if (status === 429) return '服务请求过于频繁，请稍后再试。'
  if (status >= 500) return 'AI 服务暂时不可用，请稍后再试。'
  return `AI 服务返回错误（HTTP ${status}）。`
}

export class AiTranslationService {
  constructor(private readonly dataStore: DataStore, private readonly secretStore: SecretStore) {}

  async translate(text: string, targetLanguage: string): Promise<string> {
    if (!text.trim() || text.length > MAX_TRANSLATION_LENGTH) throw new Error('请输入 1 到 20,000 个字符的待翻译内容。')
    if (!targetLanguage.trim() || targetLanguage.length > 64) throw new Error('请选择有效的目标语言。')
    const response = await this.request([
      { role: 'system', content: `You are a translation assistant. Translate the user's text into ${targetLanguage}. Preserve meaning and formatting. Return only the translation, with no explanation.` },
      { role: 'user', content: text },
    ])
    const translation = getMessageContent(response)
    if (!translation) throw new Error('AI 服务没有返回翻译内容。')
    return translation
  }

  async testConnection(): Promise<string> {
    const response = await this.request([
      { role: 'system', content: 'Reply with the exact text READY.' },
      { role: 'user', content: 'Reply READY now.' },
    ])
    if (!getMessageContent(response)) throw new Error('AI 服务已响应，但返回内容无法识别。')
    const value = response as ChatCompletionResponse
    return value.model ?? this.dataStore.snapshot().settings.aiModel
  }

  private async request(messages: Array<{ role: 'system' | 'user'; content: string }>): Promise<ChatCompletionResponse> {
    const settings: AppSettings = this.dataStore.snapshot().settings
    if (!settings.aiBaseUrl.trim() || !settings.aiModel.trim()) throw new Error('请先在设置中填写 AI 服务地址和模型名称。')
    const apiKey = await this.secretStore.getSecret('ai-api-key')
    if (!apiKey) throw new Error('请先在设置中保存 API Key。')

    const endpoint = resolveChatEndpoint(settings.aiBaseUrl)
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: settings.aiModel, messages, stream: false, temperature: 0.2 }),
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') throw new Error('连接 AI 服务超时，请稍后再试。')
      throw new Error('无法连接 AI 服务，请检查网络和服务地址。')
    }
    if (response.status >= 300 && response.status < 400) throw new Error('AI 服务重定向已被阻止，请直接填写最终服务地址。')
    if (!response.ok) throw new Error(providerError(response.status))
    try { return await response.json() as ChatCompletionResponse } catch {
      throw new Error('AI 服务返回的数据格式无效。')
    }
  }
}
