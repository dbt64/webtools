import type { BookmarkFolder, WebsiteEntry, WebsiteOrderByCollection } from '../../shared/domain.ts'

export interface FavoriteSection {
  id: string
  name: string
  websites: WebsiteEntry[]
}

function applyOrder(websites: WebsiteEntry[], order: unknown): WebsiteEntry[] {
  const byId = new Map(websites.map((website) => [website.id, website]))
  const result: WebsiteEntry[] = []
  const seen = new Set<string>()
  if (Array.isArray(order)) {
    for (const id of order) {
      if (typeof id !== 'string' || seen.has(id)) continue
      const website = byId.get(id)
      if (!website) continue
      result.push(website)
      seen.add(id)
    }
  }
  for (const website of websites) {
    if (seen.has(website.id)) continue
    result.push(website)
  }
  return result
}

export function buildFavoriteSections(
  folders: BookmarkFolder[],
  websites: WebsiteEntry[],
  order?: Partial<WebsiteOrderByCollection> | null,
): FavoriteSection[] {
  const folderIds = new Set(folders.map((folder) => folder.id))
  const sections = folders.map((folder) => ({
    id: folder.id,
    name: folder.name,
    websites: applyOrder(websites.filter((website) => website.folderIds.includes(folder.id)), order?.folders?.[folder.id]),
  }))
  const uncategorized = applyOrder(
    websites.filter((website) => !website.folderIds.some((folderId) => folderIds.has(folderId))),
    order?.unclassified,
  )

  if (uncategorized.length > 0) {
    sections.push({ id: 'uncategorized', name: '未分类', websites: uncategorized })
  }
  return sections
}
