import { promoteRememberedAppResult } from '../../shared/app-search-memory.ts'
import type { AppSearchEntry, EverythingResult, WebsiteSearchEntry } from '../../shared/domain.ts'
import type { SearchIndex } from '../../shared/pinyin-index.ts'
import type { ParsedSearchCommand } from '../../shared/search-command.ts'
import { searchEntries, type SearchableEntry, type SearchResult } from '../../shared/search.ts'

export interface LauncherEntry extends Omit<SearchableEntry, 'kind'> {
  kind: 'app' | 'website'
  url?: string
  searchText?: string
}

export type SearchMatch = SearchResult<LauncherEntry>['match']

export type TranslationAction = {
  kind: 'translation'
  text: string
  name: '翻译'
  subtitle: string
}

export type LauncherAction =
  | { kind: 'application'; id: string; name: string; subtitle: string; match: SearchMatch }
  | { kind: 'website'; id: string; name: string; subtitle: string; url: string; folderIds: string[]; match: SearchMatch }
  | { kind: 'file'; id: string; name: string; locationLabel: string; fileKind: EverythingResult['kind'] }
  | TranslationAction

export type SearchAction = Exclude<LauncherAction, { kind: 'file' }>
export type WebsiteAction = Extract<LauncherAction, { kind: 'website' }>

export function toLauncherAppEntry(app: AppSearchEntry): LauncherEntry {
  return { id: app.id, name: app.name, aliases: app.aliases, kind: 'app', subtitle: '本地应用' }
}

export function toLauncherWebsiteEntry(site: WebsiteSearchEntry): LauncherEntry {
  return {
    id: site.id,
    name: site.name,
    aliases: [site.url],
    kind: 'website',
    subtitle: site.url,
    url: site.url,
    folderIds: site.folderIds,
    searchText: site.description ?? '',
  }
}

export function searchLauncherEntries<T extends LauncherEntry>(
  query: string,
  mode: ParsedSearchCommand['mode'],
  appEntries: T[],
  websiteEntries: T[],
  index: SearchIndex,
  rememberedAppId: string | null,
): SearchResult<T>[] {
  if (mode === 'web' || mode === 'files') return []

  const candidates = mode === 'saved-websites' ? websiteEntries : [...appEntries, ...websiteEntries]
  const matches = searchEntries(query, candidates, index)
  const ranked = mode === 'local' ? promoteRememberedAppResult(matches, rememberedAppId) : matches
  return ranked.slice(0, 8)
}

/** Defer the UI's search-index dependency until a local query needs it. */
export function searchLauncherEntriesLazy<T extends LauncherEntry>(
  query: string,
  mode: ParsedSearchCommand['mode'],
  appEntries: T[],
  websiteEntries: T[],
  getIndex: () => SearchIndex,
  rememberedAppId: string | null,
): SearchResult<T>[] {
  if (!query || mode === 'web' || mode === 'files') return []
  return searchLauncherEntries(query, mode, appEntries, websiteEntries, getIndex(), rememberedAppId)
}

export function toLauncherAction(result: SearchResult<LauncherEntry>): Exclude<LauncherAction, { kind: 'file' | 'translation' }> {
  const { entry, match } = result
  switch (entry.kind) {
    case 'app': return { kind: 'application', id: entry.id, name: entry.name, subtitle: entry.subtitle, match }
    case 'website': return {
      kind: 'website', id: entry.id, name: entry.name, subtitle: entry.subtitle,
      url: entry.url ?? '', folderIds: entry.folderIds ?? [], match,
    }
    default: return assertNever(entry.kind)
  }
}

export function toLauncherFileAction(file: EverythingResult): Extract<LauncherAction, { kind: 'file' }> {
  return { kind: 'file', id: file.id, name: file.name, locationLabel: file.locationLabel, fileKind: file.kind }
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

function assertNever(value: never): never { throw new Error(`Unsupported launcher action: ${String(value)}`) }
