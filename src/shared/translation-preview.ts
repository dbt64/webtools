/** A bounded English-oriented preview heuristic, not a language detector or Feature matcher. */
export function isTranslationPreviewCandidate(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 3000
    && /[A-Za-z]/.test(value) && /^[A-Za-z0-9 \t\r\n.,?!:;'"()_\-\u2018\u2019\u201c\u201d\u2013\u2014]+$/.test(value)
}
