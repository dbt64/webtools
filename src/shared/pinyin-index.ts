import { pinyin } from 'pinyin-pro'

export interface PinyinEntry {
  normalizedName: string
  fullPinyin: string
  initials: string
}

export type SearchIndex = Map<string, PinyinEntry>

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

export function buildSearchIndex<T extends { id: string; name: string }>(entries: T[]): SearchIndex {
  return new Map(entries.map((entry) => {
    const syllables = pinyin(entry.name, { toneType: 'none', type: 'array' })
    return [entry.id, {
      normalizedName: normalizeSearchText(entry.name),
      fullPinyin: normalizeSearchText(syllables.join('')),
      initials: normalizeSearchText(syllables.map((syllable) => [...syllable][0] ?? '').join('')),
    }]
  }))
}
