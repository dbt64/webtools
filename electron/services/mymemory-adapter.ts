import { isTranslationLanguage, MYMEMORY_MAX_UTF8_BYTES } from '../../src/shared/translation-contracts.ts'
import { ServiceError } from './service-error.ts'

export interface MyMemoryRequest {
  text: string
  sourceLanguage: string
  targetLanguage: string
  signal: AbortSignal
}

interface MyMemoryResponse {
  responseStatus?: unknown
  quotaFinished?: unknown
  responseData?: { translatedText?: unknown }
}

type Fetcher = typeof fetch

export class MyMemoryAdapter {
  private readonly fetcher: Fetcher

  constructor(fetcher: Fetcher = fetch) { this.fetcher = fetcher }

  async translate(request: MyMemoryRequest): Promise<string> {
    if (typeof request.text !== 'string' || !request.text.trim()) {
      throw new ServiceError('INVALID_TRANSLATION', '请输入要翻译的文字。')
    }
    if (new TextEncoder().encode(request.text).length > MYMEMORY_MAX_UTF8_BYTES) {
      throw new ServiceError('FREE_TRANSLATION_TOO_LONG', '免费翻译单次最多支持 500 UTF-8 字节；请缩短原文，或切换至 AI 翻译。')
    }
    if (request.sourceLanguage !== 'auto' && !isTranslationLanguage(request.sourceLanguage)) {
      throw new ServiceError('INVALID_TRANSLATION', '来源语言无效。')
    }
    if (!isTranslationLanguage(request.targetLanguage)) {
      throw new ServiceError('INVALID_TRANSLATION', '目标语言无效。')
    }

    const url = new URL('https://api.mymemory.translated.net/get')
    url.searchParams.set('q', request.text)
    url.searchParams.set('langpair', `${request.sourceLanguage === 'auto' ? 'autodetect' : request.sourceLanguage}|${request.targetLanguage}`)

    let response: Response
    try {
      response = await this.fetcher(url, { method: 'GET', redirect: 'manual', signal: request.signal, headers: { accept: 'application/json' } })
    } catch (error) {
      if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) throw error
      throw new ServiceError('FREE_TRANSLATION_UNAVAILABLE', '无法连接 MyMemory 免费翻译服务，请稍后重试。')
    }
    if (response.status >= 300 && response.status < 400) {
      throw new ServiceError('FREE_TRANSLATION_UNAVAILABLE', 'MyMemory 免费翻译服务返回了重定向，请稍后重试。')
    }
    if (response.status === 429 || response.status === 403) {
      throw new ServiceError('FREE_TRANSLATION_QUOTA', 'MyMemory 免费翻译额度已用完或请求过于频繁，请稍后再试。')
    }
    if (!response.ok) {
      throw new ServiceError('FREE_TRANSLATION_UNAVAILABLE', 'MyMemory 免费翻译服务暂时不可用，请稍后重试。')
    }

    let payload: MyMemoryResponse
    try { payload = await response.json() as MyMemoryResponse }
    catch { throw new ServiceError('FREE_TRANSLATION_INVALID_RESPONSE', 'MyMemory 返回的数据格式无效。') }
    const translatedText = payload?.responseData?.translatedText
    if (payload?.quotaFinished === true || (typeof translatedText === 'string' && translatedText.toUpperCase().startsWith('MYMEMORY WARNING'))) {
      throw new ServiceError('FREE_TRANSLATION_QUOTA', 'MyMemory 今日免费额度已用完，请稍后再试或切换至 AI 翻译。')
    }
    if (payload?.responseStatus !== 200 || typeof translatedText !== 'string' || !translatedText.trim()) {
      throw new ServiceError('FREE_TRANSLATION_INVALID_RESPONSE', 'MyMemory 没有返回有效译文，请稍后重试。')
    }
    return translatedText
  }
}
