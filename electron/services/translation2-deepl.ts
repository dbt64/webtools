import type { TranslationLanguageCode, TranslationSourceLanguage } from '../../src/shared/translation-contracts.ts'
import { readBoundedText } from './translation2-imported-api.ts'
import { getAIProviderHttpError, normalizeAITransportError } from './ai-provider-errors.ts'

export class Translation2DeepLAdapter {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  async translate(input: { apiPlan: 'free' | 'pro'; secret: string | null; text: string; sourceLanguage: TranslationSourceLanguage; targetLanguage: TranslationLanguageCode; signal: AbortSignal }): Promise<string> {
    if (typeof input.secret !== 'string' || !input.secret || input.secret.length > 4096 || /[\r\n]/.test(input.secret)) throw new Error('请填写 DeepL API Key。')
    if (!['free', 'pro'].includes(input.apiPlan)) throw new Error('DeepL API 类型无效。')
    const source = input.sourceLanguage.startsWith('zh') ? 'ZH' : input.sourceLanguage.toUpperCase()
    const target = input.targetLanguage === 'zh-CN' ? 'ZH-HANS' : input.targetLanguage === 'zh-TW' ? 'ZH-HANT' : input.targetLanguage === 'en' ? 'EN-US' : input.targetLanguage.toUpperCase()
    const endpoint = input.apiPlan === 'free' ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate'
    let response: Response
    try {
      response = await this.fetcher(endpoint, { method: 'POST', redirect: 'manual',
        headers: { Authorization: `DeepL-Auth-Key ${input.secret}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.any([input.signal, AbortSignal.timeout(30_000)]),
        body: JSON.stringify({ text: [input.text], target_lang: target, ...(source === 'AUTO' ? {} : { source_lang: source }) }),
      })
    } catch (error) { throw normalizeAITransportError(error) }
    if (response.status >= 300 && response.status < 400) throw new Error('DeepL API 重定向已被阻止。')
    if (!response.ok) throw getAIProviderHttpError(response.status)
    let result: unknown
    try { result = JSON.parse(await readBoundedText(response)) } catch { throw new Error('DeepL 返回的数据无效或过大。') }
    const translated = (result as { translations?: { text?: unknown }[] })?.translations?.[0]?.text
    if (typeof translated !== 'string' || !translated.trim()) throw new Error('DeepL 未返回译文。')
    return translated
  }
}
