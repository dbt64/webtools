import type { AICompletionRequest } from './openai-compatible-adapter.ts'
import { assertNoRedirect, getAIProviderHttpError, normalizeAITransportError, parseAIResponseJson } from './ai-provider-errors.ts'

interface AnthropicResponse {
  content?: Array<{ type?: unknown; text?: unknown }>
}

type Fetcher = typeof fetch

function extractText(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('content' in value)) return null
  const content = (value as AnthropicResponse).content
  if (!Array.isArray(content)) return null
  const text = content.flatMap((block) => block.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('')
  return text.trim() || null
}

export class AnthropicMessagesAdapter {
  private readonly fetcher: Fetcher

  constructor(fetcher: Fetcher = fetch) { this.fetcher = fetcher }

  async complete(request: AICompletionRequest): Promise<string> {
    if (!request.apiKey || request.apiKey.length > 4096) throw new Error('AI API Key 未配置或格式无效。')
    if (!request.model.trim() || request.model.length > 120) throw new Error('AI 模型名称无效。')
    if (!request.messages.some((message) => message.role === 'user')) throw new Error('AI 请求至少需要一条用户消息。')
    if (request.messages.length > 100) throw new Error('AI 请求消息数量无效。')

    const system = request.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n')
    const messages = request.messages.filter((message) => message.role !== 'system')
    const maxTokens = request.maxOutputTokens ?? 2048
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8192) throw new Error('AI 输出长度设置无效。')

    let response: Response
    try {
      response = await this.fetcher(request.endpoint, {
        method: 'POST',
        redirect: 'manual',
        signal: request.signal,
        headers: {
          'x-api-key': request.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: request.model,
          max_tokens: maxTokens,
          ...(system ? { system } : {}),
          messages,
        }),
      })
    } catch (error) {
      throw normalizeAITransportError(error)
    }
    assertNoRedirect(response)
    if (!response.ok) throw getAIProviderHttpError(response.status)
    const text = extractText(await parseAIResponseJson(response))
    if (!text) throw new Error('AI 服务没有返回文本内容。')
    return text
  }
}
