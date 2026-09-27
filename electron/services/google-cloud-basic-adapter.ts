import { isTranslationLanguage } from '../../src/shared/translation-contracts.ts'
import { assertNoRedirect, normalizeAITransportError, parseAIResponseJson } from './ai-provider-errors.ts'

export interface GoogleCloudBasicRequest {
  apiKey: string
  text: string
  sourceLanguage: string
  targetLanguage: string
  signal: AbortSignal
}

interface GoogleCloudTranslateResponse {
  data?: { translations?: Array<{ translatedText?: unknown }> }
}

type Fetcher = typeof fetch

function getCloudError(status: number): Error {
  if (status === 400) return new Error('Google Cloud Translation 请求或语言代码无效。')
  if (status === 401 || status === 403) return new Error('Google Cloud API Key 无效，或 Translation API 未启用/未授权。')
  if (status === 404) return new Error('找不到 Google Cloud Translation Basic 接口。')
  if (status === 429) return new Error('Google Cloud Translation 配额已用完或请求过于频繁。')
  if (status >= 500) return new Error('Google Cloud Translation 暂时不可用，请稍后再试。')
  return new Error(`Google Cloud Translation 返回错误（HTTP ${status}）。`)
}

export class GoogleCloudBasicAdapter {
  private readonly fetcher: Fetcher

  constructor(fetcher: Fetcher = fetch) { this.fetcher = fetcher }

  async translate(request: GoogleCloudBasicRequest): Promise<string> {
    if (typeof request.text !== 'string' || !request.text.trim() || request.text.length > 20_000) {
      throw new Error('请输入 1 到 20,000 个字符的待翻译内容。')
    }
    if (!request.apiKey || request.apiKey.length > 4096) throw new Error('Google Cloud API Key 未配置或格式无效。')
    if (request.sourceLanguage !== 'auto' && !isTranslationLanguage(request.sourceLanguage)) throw new Error('来源语言无效。')
    if (!isTranslationLanguage(request.targetLanguage)) throw new Error('目标语言无效。')

    const body = {
      q: request.text,
      ...(request.sourceLanguage === 'auto' ? {} : { source: request.sourceLanguage }),
      target: request.targetLanguage,
      format: 'text',
    }
    let response: Response
    try {
      response = await this.fetcher(new URL('https://translation.googleapis.com/language/translate/v2'), {
        method: 'POST',
        redirect: 'manual',
        signal: request.signal,
        headers: { 'x-goog-api-key': request.apiKey, 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
      })
    } catch (error) {
      throw normalizeAITransportError(error)
    }
    assertNoRedirect(response)
    if (!response.ok) throw getCloudError(response.status)
    const payload = await parseAIResponseJson(response) as GoogleCloudTranslateResponse
    const translatedText = payload.data?.translations?.[0]?.translatedText
    if (typeof translatedText !== 'string' || !translatedText.trim()) throw new Error('Google Cloud Translation 没有返回译文。')
    return translatedText
  }
}
