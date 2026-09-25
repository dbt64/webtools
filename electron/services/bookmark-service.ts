import { randomUUID } from 'node:crypto'
import type { BookmarkFolder } from '../../src/shared/domain'
import { DataStore } from './data-store'

export class BookmarkService {
  constructor(private readonly store: DataStore) {}

  listFolders(): BookmarkFolder[] {
    return this.store.snapshot().bookmarkFolders
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

}
