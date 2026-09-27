import type { AppSearchMemory, AppSearchMemoryEntry } from './domain'
import { normalizeSearchText } from './search-normalization'

export const MAX_APP_SEARCH_QUERY_LENGTH = 128
export const MAX_APP_SEARCH_MEMORY_ENTRIES = 100

const appIdPattern = /^[a-f\d]{16}$/i

export function normalizeAppSearchQuery(query: string): string {
  if (query.length > MAX_APP_SEARCH_QUERY_LENGTH) return ''
  return normalizeSearchText(query)
}

export function sanitizeAppSearchMemory(value: unknown): AppSearchMemory {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}

  const entries = Object.entries(value as Record<string, unknown>).flatMap(([query, rawEntry]) => {
    if (!query || query.length > MAX_APP_SEARCH_QUERY_LENGTH || normalizeSearchText(query) !== query) return []
    if (typeof rawEntry !== 'object' || rawEntry === null || Array.isArray(rawEntry)) return []
    const entry = rawEntry as Partial<AppSearchMemoryEntry>
    if (typeof entry.appId !== 'string' || !appIdPattern.test(entry.appId)) return []
    if (typeof entry.lastUsedAt !== 'number' || !Number.isFinite(entry.lastUsedAt)) return []
    return [[query, { appId: entry.appId, lastUsedAt: entry.lastUsedAt }] as const]
  })

  return Object.fromEntries(entries
    .sort((left, right) => right[1].lastUsedAt - left[1].lastUsedAt)
    .slice(0, MAX_APP_SEARCH_MEMORY_ENTRIES))
}

export function getRememberedAppId(memory: AppSearchMemory, query: string): string | null {
  const key = normalizeAppSearchQuery(query)
  return key ? memory[key]?.appId ?? null : null
}

export function rememberAppSearchResult(memory: AppSearchMemory, query: string, appId: string, now = Date.now()): AppSearchMemory {
  const key = normalizeAppSearchQuery(query)
  if (!key || !appIdPattern.test(appId)) return memory
  return sanitizeAppSearchMemory({ ...memory, [key]: { appId, lastUsedAt: now } })
}

export function promoteRememberedAppResult<T extends { entry: { id: string; kind: string } }>(results: T[], rememberedAppId: string | null): T[] {
  if (!rememberedAppId) return results
  const index = results.findIndex((result) => result.entry.kind === 'app' && result.entry.id === rememberedAppId)
  if (index <= 0) return results
  return [results[index], ...results.slice(0, index), ...results.slice(index + 1)]
}
