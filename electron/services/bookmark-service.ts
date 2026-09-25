import { randomUUID } from 'node:crypto'
import type { Bookmark, BookmarkFolder, WebsiteEntry } from '../../src/shared/domain'
import { DataStore } from './data-store'
import { fetchFavicon } from './favicon-fetcher'
import { validateExternalUrl } from './external-opener'

export class BookmarkService {
  constructor(private readonly store: DataStore) {}

  listFolders(): BookmarkFolder[] {
    return this.store.snapshot().bookmarkFolders
  }

  listBookmarks(folderId: string): Bookmark[] {
    return this.store.snapshot().webEntries.filter((entry) => entry.folderIds.includes(folderId)).map((entry) => ({ id: entry.id, folderId, title: entry.name, url: entry.url, favicon: entry.favicon, createdAt: entry.createdAt }))
  }

  async saveFolder(input: { id?: string; name: string }): Promise<BookmarkFolder> {
    const name = input.name.trim()
    if (!name || name.length > 80) throw new Error('收藏夹名称需在 1 到 80 个字符之间。')
    const current = this.store.snapshot().bookmarkFolders
    const existing = input.id ? current.find((folder) => folder.id === input.id) : undefined
    if (input.id && !existing) throw new Error('找不到要编辑的收藏夹。')
    if (current.some((folder) => folder.name.toLocaleLowerCase() === name.toLocaleLowerCase() && folder.id !== input.id)) throw new Error('已经有同名收藏夹。')
    const folder = { id: input.id ?? randomUUID(), name, createdAt: existing?.createdAt ?? Date.now() }
    await this.store.update((data) => ({
      ...data,
      bookmarkFolders: existing
        ? data.bookmarkFolders.map((item) => item.id === folder.id ? folder : item)
        : [...data.bookmarkFolders, folder],
    }))
    return folder
  }

  async deleteFolder(folderId: string): Promise<void> {
    const current = this.store.snapshot()
    if (!current.bookmarkFolders.some((folder) => folder.id === folderId)) throw new Error('找不到这个收藏夹。')
    await this.store.update((data) => ({
      ...data,
      bookmarkFolders: data.bookmarkFolders.filter((folder) => folder.id !== folderId),
      webEntries: data.webEntries.map((entry) => ({ ...entry, folderIds: entry.folderIds.filter((id) => id !== folderId) })),
    }))
  }

  async addBookmark(input: { folderId: string; title?: string; url: string }): Promise<Bookmark> {
    const current = this.store.snapshot()
    if (!current.bookmarkFolders.some((folder) => folder.id === input.folderId)) throw new Error('请选择一个收藏夹。')
    const url = validateExternalUrl(input.url).toString()
    const parsedUrl = new URL(url)
    const title = input.title?.trim().slice(0, 160) || parsedUrl.hostname
    let favicon: string | undefined
    try {
      const result = await fetchFavicon(parsedUrl)
      favicon = result.dataUrl
    } catch {
      // Preserve the bookmark even if a malformed or unreachable site has no icon.
    }
    const existing = current.webEntries.find((entry) => entry.url === url)
    const website: WebsiteEntry = existing
      ? { ...existing, folderIds: [...new Set([...existing.folderIds, input.folderId])], favicon: existing.favicon || favicon }
      : { id: randomUUID(), name: title, url, favicon, folderIds: [input.folderId], createdAt: Date.now() }
    await this.store.update((data) => ({ ...data, webEntries: existing ? data.webEntries.map((entry) => entry.id === website.id ? website : entry) : [...data.webEntries, website] }))
    return { id: website.id, folderId: input.folderId, title: website.name, url: website.url, favicon: website.favicon, createdAt: website.createdAt }
  }

  async deleteBookmark(bookmarkId: string): Promise<void> {
    const current = this.store.snapshot()
    const entry = current.webEntries.find((item) => item.id === bookmarkId)
    if (!entry) throw new Error('找不到这个收藏。')
    await this.store.update((data) => ({ ...data, webEntries: data.webEntries.map((item) => item.id === bookmarkId ? { ...item, folderIds: [] } : item) }))
  }

  async moveBookmark(bookmarkId: string, folderId: string): Promise<void> {
    const current = this.store.snapshot()
    const entry = current.webEntries.find((item) => item.id === bookmarkId)
    if (!entry) throw new Error('找不到这个收藏。')
    if (!current.bookmarkFolders.some((folder) => folder.id === folderId)) throw new Error('请选择一个有效的收藏夹。')
    await this.store.update((data) => ({
      ...data,
      webEntries: data.webEntries.map((item) => item.id === bookmarkId ? { ...item, folderIds: [...new Set([...item.folderIds, folderId])] } : item),
    }))
  }
}
