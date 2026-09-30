import { randomUUID } from 'node:crypto'
import type { BookmarkFolder } from '../../src/shared/domain.ts'
import { DataStore } from './data-store.ts'
import { normalizeWebsiteOrderByCollection } from './website-order.ts'

export class BookmarkService {
  private readonly store: DataStore

  constructor(store: DataStore) {
    this.store = store
  }

  listFolders(): BookmarkFolder[] {
    return this.store.snapshot().bookmarkFolders
  }

  async saveFolder(input: { id?: string; name: string }): Promise<BookmarkFolder> {
    const name = input.name.trim()
    if (!name || name.length > 80) throw new Error('收藏夹名称需在 1 到 80 个字符之间。')
    const id = input.id ?? randomUUID()
    let folder!: BookmarkFolder
    let validationError: string | undefined
    await this.store.update((data) => {
      const existing = input.id ? data.bookmarkFolders.find((item) => item.id === input.id) : undefined
      if (input.id && !existing) {
        validationError = '找不到要编辑的收藏夹。'
        return data
      }
      if (data.bookmarkFolders.some((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase() && item.id !== id)) {
        validationError = '已经有同名收藏夹。'
        return data
      }
      folder = { id, name, createdAt: existing?.createdAt ?? Date.now() }
      const bookmarkFolders = existing
        ? data.bookmarkFolders.map((item) => item.id === folder.id ? folder : item)
        : [...data.bookmarkFolders, folder]
      return {
        ...data,
        bookmarkFolders,
        websiteOrderByCollection: normalizeWebsiteOrderByCollection(data.websiteOrderByCollection, data.webEntries, bookmarkFolders),
      }
    })
    if (validationError) throw new Error(validationError)
    return folder
  }

  async deleteFolder(folderId: string): Promise<void> {
    let found = false
    await this.store.update((data) => {
      const bookmarkFolders = data.bookmarkFolders.filter((folder) => folder.id !== folderId)
      found = bookmarkFolders.length !== data.bookmarkFolders.length
      if (!found) return data
      const webEntries = data.webEntries.map((entry) => ({ ...entry, folderIds: entry.folderIds.filter((id) => id !== folderId) }))
      return {
        ...data,
        bookmarkFolders,
        webEntries,
        websiteOrderByCollection: normalizeWebsiteOrderByCollection(data.websiteOrderByCollection, webEntries, bookmarkFolders),
      }
    })
    if (!found) throw new Error('找不到这个收藏夹。')
  }

}
