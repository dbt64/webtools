import type { AppSearchMemory, AppSearchMemoryEntry } from './domain.ts'
import { normalizeSearchText } from './search-normalization.ts'

export const MAX_APP_SEARCH_QUERY_LENGTH = 128
export const MAX_APP_SEARCH_MEMORY_ENTRIES = 100

const appIdPattern = /^[a-f\d]{16}$/i

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
