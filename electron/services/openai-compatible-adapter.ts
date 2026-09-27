export type AIMessageRole = 'system' | 'user' | 'assistant'

export interface AIMessage {
  role: AIMessageRole
  content: string
}

export interface AICompletionRequest {
  endpoint: URL
  apiKey: string
  model: string
  messages: AIMessage[]
  signal: AbortSignal
  maxOutputTokens?: number
}

import { assertNoRedirect, getAIProviderHttpError, normalizeAITransportError, parseAIResponseJson } from './ai-provider-errors.ts'

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>
}

type Fetcher = typeof fetch

export function extractOpenAICompatibleText(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('choices' in value)) return null
  const choices = (value as ChatCompletionResponse).choices
  if (!Array.isArray(choices)) return null
  const content = choices[0]?.message?.content
  if (typeof content === 'string') return content.trim() || null
  if (!Array.isArray(content)) return null
  const text = content.flatMap((part) => {
    if (typeof part !== 'object' || part === null || !('type' in part) || !('text' in part)) return []
    const block = part as { type: unknown; text: unknown }
    return block.type === 'text' && typeof block.text === 'string' ? [block.text] : []
  }).join('')
  return text.trim() || null
}

export class OpenAICompatibleAdapter {
  private readonly fetcher: Fetcher

  constructor(fetcher: Fetcher = fetch) { this.fetcher = fetcher }

  async complete(request: AICompletionRequest): Promise<string> {
    if (!request.apiKey || request.apiKey.length > 4096) throw new Error('AI API Key 未配置或格式无效。')
    if (!request.model.trim() || request.model.length > 120) throw new Error('AI 模型名称无效。')
    if (!request.messages.length || request.messages.length > 100) throw new Error('AI 请求消息数量无效。')
    let response: Response
    try {
      response = await this.fetcher(request.endpoint, {
        method: 'POST',
        redirect: 'manual',
        signal: request.signal,
        headers: { authorization: `Bearer ${request.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          stream: false,
          ...(request.maxOutputTokens ? { max_tokens: request.maxOutputTokens } : {}),
        }),
      })
    } catch (error) {
      throw normalizeAITransportError(error)
    }
    assertNoRedirect(response)
    if (!response.ok) throw getAIProviderHttpError(response.status)
    const payload = await parseAIResponseJson(response)
    const text = extractOpenAICompatibleText(payload)
    if (!text) throw new Error('AI 服务没有返回文本内容。')
    return text
  }
}
