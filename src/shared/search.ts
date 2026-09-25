import type { AppEntry } from './domain'
import { normalizeSearchText, type SearchIndex } from './pinyin-index'

export interface AppSearchResult {
  entry: AppEntry
  match: 'name' | 'pinyin' | 'initials'
}

export function searchApps(query: string, entries: AppEntry[], index: SearchIndex): AppSearchResult[] {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) return []

  const matches = entries.flatMap((entry) => {
    const indexed = index.get(entry.id)
    if (!indexed) return []
    let rank: number
    let match: AppSearchResult['match']

    if (indexed.normalizedName === normalizedQuery) {
      rank = 0
      match = 'name'
    } else if (indexed.normalizedName.startsWith(normalizedQuery)) {
      rank = 1
      match = 'name'
    } else if (indexed.normalizedName.includes(normalizedQuery)) {
      rank = 2
      match = 'name'
    } else if (indexed.fullPinyin.startsWith(normalizedQuery)) {
      rank = 3
      match = 'pinyin'
    } else if (indexed.fullPinyin.includes(normalizedQuery)) {
      rank = 4
      match = 'pinyin'
    } else if (indexed.initials.startsWith(normalizedQuery)) {
      rank = 5
      match = 'initials'
    } else if (indexed.initials.includes(normalizedQuery)) {
      rank = 6
      match = 'initials'
    } else {
      return []
    }
    return [{ entry, match, rank }]
  })

  return matches
    .sort((left, right) => left.rank - right.rank || left.entry.name.localeCompare(right.entry.name, 'zh-CN'))
    .map(({ entry, match }) => ({ entry, match }))
}
