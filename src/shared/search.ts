import type { SearchIndex } from './pinyin-index.ts'
import { normalizeSearchText } from './search-normalization.ts'

export interface SearchableEntry {
  id: string
  name: string
  aliases?: string[]
  folderIds?: string[]
  kind: 'app' | 'website' | 'tool'
  subtitle: string
}

export interface SearchResult<T extends SearchableEntry = SearchableEntry> {
  entry: T
  rank: number
  match: 'name' | 'alias' | 'pinyin' | 'initials'
}

export interface SearchHighlightPart { text: string; highlighted: boolean }

function matchesWordInitials(queryTokens: string[], nameTokens: string[], queryIndex = 0, nameIndex = 0): boolean {
  if (queryIndex === queryTokens.length) return true
  if (nameIndex >= nameTokens.length) return false
  const queryToken = queryTokens[queryIndex]
  if (nameTokens[nameIndex].startsWith(queryToken) && matchesWordInitials(queryTokens, nameTokens, queryIndex + 1, nameIndex + 1)) return true
  let initials = ''
  for (let end = nameIndex; end < nameTokens.length && initials.length < queryToken.length; end++) {
    initials += [...nameTokens[end]][0] ?? ''
    if (initials === queryToken && matchesWordInitials(queryTokens, nameTokens, queryIndex + 1, end + 1)) return true
  }
  return false
}

export function getSearchHighlightParts(name: string, query: string): SearchHighlightPart[] {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) return [{ text: name, highlighted: false }]
  const nameMatches = [...name.matchAll(/[\p{L}\p{N}]+/gu)]
  const initials = nameMatches.flatMap((token) => {
    const first = [...(token?.[0] ?? '')][0] ?? ''
    if (!token || !first || !/[\p{Script=Latin}\p{N}]/u.test(first)) return []
    const start = token.index ?? 0
    const normalized = normalizeSearchText(first)
    return normalized.length === 1 ? [{ normalized, start, end: start + first.length }] : []
  })
  const acronym = initials.map((initial) => initial.normalized).join('')
  const matchedStart = acronym.indexOf(normalizedQuery)
  if (matchedStart < 0) return [{ text: name, highlighted: false }]

  const matchedInitials = initials.slice(matchedStart, matchedStart + normalizedQuery.length)
  const parts: SearchHighlightPart[] = []
  let position = 0
  for (const initial of matchedInitials) {
    if (initial.start > position) parts.push({ text: name.slice(position, initial.start), highlighted: false })
    parts.push({ text: name.slice(initial.start, initial.end), highlighted: true })
    position = initial.end
  }
  if (position < name.length) parts.push({ text: name.slice(position), highlighted: false })
  return parts
}

export function searchEntries<T extends SearchableEntry>(query: string, entries: T[], index: SearchIndex): SearchResult<T>[] {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) return []
  const queryTokens = query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []

  const matches = entries.flatMap((entry) => {
    const indexed = index.get(entry.id)
    if (!indexed) return []
    let rank: number
    let match: SearchResult<T>['match']

    if (indexed.normalizedName === normalizedQuery) {
      rank = 0
      match = 'name'
    } else if (indexed.normalizedName.startsWith(normalizedQuery)) {
      rank = 1
      match = 'name'
    } else if (indexed.normalizedName.includes(normalizedQuery)) {
      rank = 2
      match = 'name'
    } else if (indexed.normalizedAliases.includes(normalizedQuery)) {
      rank = 3
      match = 'alias'
    } else if (indexed.normalizedAliases.some((alias) => alias.startsWith(normalizedQuery))) {
      rank = 4
      match = 'alias'
    } else if (matchesWordInitials(queryTokens, indexed.nameTokens)) {
      rank = 5
      match = 'initials'
    } else if (indexed.fullPinyin.startsWith(normalizedQuery)) {
      rank = 6
      match = 'pinyin'
    } else if (indexed.fullPinyin.includes(normalizedQuery)) {
      rank = 7
      match = 'pinyin'
    } else if (indexed.initials.startsWith(normalizedQuery)) {
      rank = 8
      match = 'initials'
    } else if (indexed.initials.includes(normalizedQuery)) {
      rank = 9
      match = 'initials'
    } else if (indexed.normalizedText.includes(normalizedQuery)) {
      rank = 10
      match = indexed.normalizedAliases.some((alias) => alias.includes(normalizedQuery)) ? 'alias' : 'name'
    } else {
      return []
    }
    return [{ entry, match, rank }]
  })

  return matches
    .sort((left, right) => left.rank - right.rank || left.entry.name.localeCompare(right.entry.name, 'zh-CN'))
    .map(({ entry, match, rank }) => ({ entry, match, rank }))
}
