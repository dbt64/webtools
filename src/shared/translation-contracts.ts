export const TRANSLATION_ENGINES = ['mymemory', 'ai', 'qwen-mt'] as const
export type TranslationEngineId = typeof TRANSLATION_ENGINES[number]
export const MYMEMORY_MAX_UTF8_BYTES = 500

export const TRANSLATION_LANGUAGES = [
  { code: 'zh-CN', label: '简体中文', qwen: 'Chinese' },
  { code: 'zh-TW', label: '繁體中文', qwen: 'Traditional Chinese' },
  { code: 'en', label: '英语', qwen: 'English' },
  { code: 'ja', label: '日语', qwen: 'Japanese' },
  { code: 'ko', label: '韩语', qwen: 'Korean' },
  { code: 'fr', label: '法语', qwen: 'French' },
  { code: 'de', label: '德语', qwen: 'German' },
  { code: 'es', label: '西班牙语', qwen: 'Spanish' },
  { code: 'it', label: '意大利语', qwen: 'Italian' },
  { code: 'pt', label: '葡萄牙语', qwen: 'Portuguese' },
  { code: 'ru', label: '俄语', qwen: 'Russian' },
  { code: 'ar', label: '阿拉伯语', qwen: 'Arabic' },
  { code: 'hi', label: '印地语', qwen: 'Hindi' },
  { code: 'th', label: '泰语', qwen: 'Thai' },
  { code: 'vi', label: '越南语', qwen: 'Vietnamese' },
  { code: 'id', label: '印尼语', qwen: 'Indonesian' },
  { code: 'ms', label: '马来语', qwen: 'Malay' },
  { code: 'tr', label: '土耳其语', qwen: 'Turkish' },
  { code: 'nl', label: '荷兰语', qwen: 'Dutch' },
  { code: 'pl', label: '波兰语', qwen: 'Polish' },
  { code: 'uk', label: '乌克兰语', qwen: 'Ukrainian' },
  { code: 'he', label: '希伯来语', qwen: 'Hebrew' },
  { code: 'sv', label: '瑞典语', qwen: 'Swedish' },
  { code: 'da', label: '丹麦语', qwen: 'Danish' },
  { code: 'fi', label: '芬兰语', qwen: 'Finnish' },
  { code: 'no', label: '挪威语', qwen: 'Norwegian' },
  { code: 'cs', label: '捷克语', qwen: 'Czech' },
  { code: 'el', label: '希腊语', qwen: 'Greek' },
  { code: 'ro', label: '罗马尼亚语', qwen: 'Romanian' },
  { code: 'hu', label: '匈牙利语', qwen: 'Hungarian' },
] as const

export type TranslationLanguageCode = typeof TRANSLATION_LANGUAGES[number]['code']
export type TranslationSourceLanguage = 'auto' | TranslationLanguageCode

export interface TranslationSettings {
  engine: TranslationEngineId
  sourceLanguage: TranslationSourceLanguage
  targetLanguage: TranslationLanguageCode
  qwenMtModel: string
}

export interface TranslationRequest {
  requestId: string
  text: string
  sourceLanguage: TranslationSourceLanguage
  targetLanguage: TranslationLanguageCode
}

export interface TranslationProviderInfo {
  engine: TranslationEngineId
  providerName: string
  providerId?: string
  model?: string
  configured: boolean
}

export interface TranslationResult {
  translation: string
  provider: TranslationProviderInfo
}

export function createDefaultTranslationSettings(): TranslationSettings {
  return { engine: 'mymemory', sourceLanguage: 'auto', targetLanguage: 'zh-CN', qwenMtModel: 'qwen-mt-flash' }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isTranslationLanguage(value: unknown): value is TranslationLanguageCode {
  return typeof value === 'string' && TRANSLATION_LANGUAGES.some((language) => language.code === value)
}

export function normalizeTranslationSettings(value: unknown): TranslationSettings {
  const defaults = createDefaultTranslationSettings()
  if (!isRecord(value)) return defaults
  const engine = value.engine === 'google-cloud-basic'
    ? 'mymemory'
    : (TRANSLATION_ENGINES as readonly unknown[]).includes(value.engine)
      ? value.engine as TranslationEngineId
      : defaults.engine
  const sourceLanguage = value.sourceLanguage === 'auto' || isTranslationLanguage(value.sourceLanguage)
    ? value.sourceLanguage
    : defaults.sourceLanguage
  const targetLanguage = isTranslationLanguage(value.targetLanguage) ? value.targetLanguage : defaults.targetLanguage
  const qwenMtModel = typeof value.qwenMtModel === 'string' && /^[A-Za-z0-9._-]{1,120}$/.test(value.qwenMtModel)
    ? value.qwenMtModel
    : defaults.qwenMtModel
  return { engine, sourceLanguage, targetLanguage, qwenMtModel }
}

export function isValidTranslationSettings(value: unknown): value is TranslationSettings {
  if (!isRecord(value)) return false
  if (Object.keys(value).some((key) => !['engine', 'sourceLanguage', 'targetLanguage', 'qwenMtModel'].includes(key))) return false
  return (TRANSLATION_ENGINES as readonly unknown[]).includes(value.engine)
    && (value.sourceLanguage === 'auto' || isTranslationLanguage(value.sourceLanguage))
    && isTranslationLanguage(value.targetLanguage)
    && typeof value.qwenMtModel === 'string' && /^[A-Za-z0-9._-]{1,120}$/.test(value.qwenMtModel)
}
