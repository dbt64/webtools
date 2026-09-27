import { pinyin } from 'pinyin-pro'
import { normalizeSearchText } from './search-normalization.ts'

export { normalizeSearchText } from './search-normalization.ts'

export interface PinyinEntry {
  normalizedName: string
  normalizedText: string
  normalizedAliases: string[]
  nameTokens: string[]
  tokenInitials: string
  fullPinyin: string
  initials: string
}

export type SearchIndex = Map<string, PinyinEntry>

export function buildSearchIndex<T extends { id: string; name: string; searchText?: string; aliases?: string[] }>(entries: T[]): SearchIndex {
  return new Map(entries.map((entry) => {
    const syllables = pinyin(entry.name, { toneType: 'none', type: 'array' })
    const nameTokens = entry.name.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
    return [entry.id, {
      normalizedName: normalizeSearchText(entry.name),
      normalizedText: normalizeSearchText(`${entry.name} ${(entry.aliases ?? []).join(' ')} ${entry.searchText ?? ''}`),
      normalizedAliases: (entry.aliases ?? []).map(normalizeSearchText),
      nameTokens,
      tokenInitials: nameTokens.map((token) => [...token][0] ?? '').join(''),
      fullPinyin: normalizeSearchText(syllables.join('')),
      initials: normalizeSearchText(syllables.map((syllable) => [...syllable][0] ?? '').join('')),
    }]
  }))
}
