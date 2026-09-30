import type { BookmarkFolder, WebsiteCollection, WebsiteEntry, WebsiteOrderByCollection } from '../../src/shared/domain.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}

function normalizeCollectionOrder(savedIds: unknown, members: WebsiteEntry[]): string[] {
  const memberIds = new Set(members.map((website) => website.id))
  const ordered: string[] = []
  const seen = new Set<string>()
  for (const id of readIds(savedIds)) {
    if (memberIds.has(id) && !seen.has(id)) {
      ordered.push(id)
      seen.add(id)
    }
  }
  for (const website of members) {
    if (!seen.has(website.id)) ordered.push(website.id)
  }
  return ordered
}

export function normalizeWebsiteOrderByCollection(
  input: unknown,
  websites: WebsiteEntry[],
  folders: BookmarkFolder[],
): WebsiteOrderByCollection {
  const validFolderIds = new Set(folders.map((folder) => folder.id))
  const folderOrders = isRecord(input) && isRecord(input.folders) ? input.folders : {}
  const unclassifiedWebsites = websites.filter((website) => !website.folderIds.some((folderId) => validFolderIds.has(folderId)))
  const normalizedFolders: Record<string, string[]> = {}

  for (const folder of folders) {
    const members = websites.filter((website) => website.folderIds.includes(folder.id))
    normalizedFolders[folder.id] = normalizeCollectionOrder(folderOrders[folder.id], members)
  }

  return {
    unclassified: normalizeCollectionOrder(isRecord(input) ? input.unclassified : undefined, unclassifiedWebsites),
    folders: normalizedFolders,
  }
}

export function getWebsiteCollectionMembers(
  collection: WebsiteCollection,
  websites: WebsiteEntry[],
  folders: BookmarkFolder[],
): WebsiteEntry[] | null {
  if (collection.kind === 'unclassified') {
    const folderIds = new Set(folders.map((folder) => folder.id))
    return websites.filter((website) => !website.folderIds.some((folderId) => folderIds.has(folderId)))
  }

  if (!folders.some((folder) => folder.id === collection.folderId)) return null
  return websites.filter((website) => website.folderIds.includes(collection.folderId))
}

export function reorderWebsiteCollectionOrder(
  input: unknown,
  collection: WebsiteCollection,
  orderedIds: string[],
  websites: WebsiteEntry[],
  folders: BookmarkFolder[],
): WebsiteOrderByCollection | null {
  const members = getWebsiteCollectionMembers(collection, websites, folders)
  if (!members || orderedIds.length !== members.length) return null

  const memberIds = new Set(members.map((website) => website.id))
  const requestedIds = new Set(orderedIds)
  if (requestedIds.size !== orderedIds.length || orderedIds.some((id) => !memberIds.has(id))) return null

  const normalized = normalizeWebsiteOrderByCollection(input, websites, folders)
  if (collection.kind === 'unclassified') normalized.unclassified = [...orderedIds]
  else normalized.folders[collection.folderId] = [...orderedIds]
  return normalized
}
