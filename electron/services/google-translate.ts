const ALLOWED_LANGUAGES = new Set(['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'de', 'es'])

export function buildGoogleTranslateUrl(text: string, targetLanguage: string): string {
  if (!text.trim()) throw new Error('请输入要翻译的内容。')
  if (!ALLOWED_LANGUAGES.has(targetLanguage)) throw new Error('不支持的目标语言。')
  const url = new URL('https://translate.google.com/')
  url.searchParams.set('sl', 'auto')
  url.searchParams.set('tl', targetLanguage)
  url.searchParams.set('text', text)
  url.searchParams.set('op', 'translate')
  return url.toString()
}
