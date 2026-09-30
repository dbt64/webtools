export function isValidTranslationText(text: unknown): text is string {
  return typeof text === 'string' && text.length > 0 && text.length <= 20_000
}
