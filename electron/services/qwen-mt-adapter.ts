import { isTranslationLanguage, TRANSLATION_LANGUAGES } from '../../src/shared/translation-contracts.ts'
import { assertNoRedirect, getAIProviderHttpError, normalizeAITransportError, parseAIResponseJson } from './ai-provider-errors.ts'
import { extractOpenAICompatibleText } from './openai-compatible-adapter.ts'

export interface QwenMtRequest {
  endpoint: URL
  apiKey: string
  model: string
  text: string
  sourceLanguage: string
  targetLanguage: string
  signal: AbortSignal
}

type Fetcher = typeof fetch

const QWEN_MT_MODELS = new Set(['qwen-mt-plus', 'qwen-mt-flash', 'qwen-mt-lite', 'qwen-mt-turbo'])

function qwenLanguageName(languageCode: string, isSource: boolean): string {
  if (languageCode === 'auto' && isSource) return 'auto'
  if (!isTranslationLanguage(languageCode)) throw new Error(isSource ? '来源语言无效。' : '目标语言无效。')
  return TRANSLATION_LANGUAGES.find((language) => language.code === languageCode)!.qwen
}

export class QwenMtAdapter {
  private readonly fetcher: Fetcher

  constructor(fetcher: Fetcher = fetch) { this.fetcher = fetcher }

  async translate(request: QwenMtRequest): Promise<string> {
    if (typeof request.text !== 'string' || !request.text.trim() || request.text.length > 20_000) {
      throw new Error('请输入 1 到 20,000 个字符的待翻译内容。')
    }
    if (!request.apiKey || request.apiKey.length > 4096) throw new Error('Qwen API Key 未配置或格式无效。')
    if (!QWEN_MT_MODELS.has(request.model)) throw new Error('Qwen-MT 模型无效。')
    const sourceLanguage = qwenLanguageName(request.sourceLanguage, true)
    const targetLanguage = qwenLanguageName(request.targetLanguage, false)

    let response: Response
    try {
      response = await this.fetcher(request.endpoint, {
        method: 'POST',
        redirect: 'manual',
        signal: request.signal,
        headers: { authorization: `Bearer ${request.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          messages: [{ role: 'user', content: request.text }],
          translation_options: { source_lang: sourceLanguage, target_lang: targetLanguage },
          stream: false,
        }),
      })
    } catch (error) {
      throw normalizeAITransportError(error)
    }
    assertNoRedirect(response)
    if (!response.ok) throw getAIProviderHttpError(response.status)
    const text = extractOpenAICompatibleText(await parseAIResponseJson(response))
    if (!text) throw new Error('Qwen-MT 没有返回译文。')
    return text
  }
}
