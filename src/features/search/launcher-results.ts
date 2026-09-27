import type { ParsedSearchCommand } from '@/shared/search-command'

export type SearchMatch = 'name' | 'alias' | 'pinyin' | 'initials'

export type TranslationAction = {
  kind: 'translation'
  text: string
  name: '翻译'
  subtitle: string
}

export function isTranslationCandidate(value: string): boolean {
  const text = value.trim()
  return Boolean(text)
    && /\p{Letter}/u.test(text)
    && /^[\p{Script=Latin}\s'’‘\u02BC\-\u2010-\u2015]+$/u.test(text)
}

export function appendTranslationAction<T>(
  rows: T[],
  rawQuery: string,
  mode: ParsedSearchCommand['mode'],
): Array<T | TranslationAction> {
  if (mode !== 'local' || !isTranslationCandidate(rawQuery)) return rows
  return [
    ...rows,
    {
      kind: 'translation',
      text: rawQuery,
      name: '翻译',
      subtitle: `翻译“${rawQuery.trim()}”`,
    },
  ]
}
