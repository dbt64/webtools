import { randomUUID } from 'node:crypto'
import type { WebsiteEntry, WebsiteSaveInput } from '../../src/shared/domain'
import type { IpcResult } from '../../src/shared/ipc'
import { openExternalUrl, validateExternalUrl } from './external-opener'
import { DataStore } from './data-store'

function fail<T>(code: string, message: string): IpcResult<T> { return { ok: false, error: { code, message } } }

export class WebsiteService {
  constructor(private readonly store: DataStore) {}

  list(folderId?: string): WebsiteEntry[] {
    const entries = this.store.snapshot().webEntries
    return folderId ? entries.filter((entry) => entry.folderIds.includes(folderId)) : entries
  }

  async save(input: WebsiteSaveInput): Promise<IpcResult<WebsiteEntry>> {
    const name = input.name.trim()
    if (!name || name.length > 120) return fail('INVALID_ENTRY', '请填写 1 到 120 个字符的网址名称。')
    let url: string
    try { url = validateExternalUrl(input.url.trim()).toString() } catch (error) { return fail('INVALID_URL', error instanceof Error ? error.message : '网址格式不正确。') }
    if (input.description !== undefined && (typeof input.description !== 'string' || input.description.length > 1000)) return fail('INVALID_ENTRY', '网址备注不能超过 1000 个字符。')
    if (!Array.isArray(input.folderIds) || input.folderIds.some((folderId) => typeof folderId !== 'string')) return fail('INVALID_FOLDER', '收藏夹编号无效。')
    if (input.favicon !== undefined && (typeof input.favicon !== 'string' || input.favicon.length > 500_000 || !/^data:image\/(?:png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon);base64,/i.test(input.favicon))) return fail('INVALID_METADATA', '网站图标无效。')
    const current = this.store.snapshot().webEntries
    const folderIds = [...new Set(input.folderIds)]
    if (folderIds.some((folderId) => !this.store.snapshot().bookmarkFolders.some((folder) => folder.id === folderId))) return fail('INVALID_FOLDER', '一个或多个收藏夹不存在。')
    const existing = input.id ? current.find((entry) => entry.id === input.id) : current.find((entry) => entry.url === url)
    if (input.id && !existing) return fail('NOT_FOUND', '找不到要编辑的网址。')
    try {
      let website!: WebsiteEntry
      await this.store.update((data) => {
        const current = input.id ? data.webEntries.find((entry) => entry.id === input.id) : data.webEntries.find((entry) => entry.url === url)
        website = {
          id: current?.id ?? input.id ?? randomUUID(), name, url,
          description: input.description === undefined ? current?.description : input.description.trim() || undefined,
          favicon: input.favicon ?? current?.favicon,
          folderIds,
          createdAt: current?.createdAt ?? Date.now(),
        }
        return { ...data, webEntries: current ? data.webEntries.map((entry) => entry.id === website.id ? website : entry) : [...data.webEntries, website] }
      })
      return { ok: true, data: website }
    } catch (error) {
      console.warn('[website:save] persistence failed', error)
      return fail('SAVE_ENTRY_FAILED', '无法保存网址，请检查本机数据文件和磁盘空间。')
    }
  }

  async delete(id: string): Promise<IpcResult<void>> {
    if (!this.store.snapshot().webEntries.some((entry) => entry.id === id)) return fail('NOT_FOUND', '找不到要删除的网址。')
    try { await this.store.update((data) => ({ ...data, webEntries: data.webEntries.filter((entry) => entry.id !== id) })); return { ok: true, data: undefined } }
    catch (error) { return fail('DELETE_ENTRY_FAILED', error instanceof Error ? error.message : '无法删除网址。') }
  }

  async addWebsiteToFolders(id: string, folderIds: string[]): Promise<IpcResult<WebsiteEntry>> {
    const data = this.store.snapshot()
    const entry = data.webEntries.find((item) => item.id === id)
    if (!entry) return fail('NOT_FOUND', '找不到这个网址。')
    const validIds = [...new Set(folderIds)]
    if (validIds.some((folderId) => !data.bookmarkFolders.some((folder) => folder.id === folderId))) return fail('INVALID_FOLDER', '一个或多个收藏夹不存在。')
    const updated = { ...entry, folderIds: validIds }
    try { await this.store.update((current) => ({ ...current, webEntries: current.webEntries.map((item) => item.id === id ? updated : item) })); return { ok: true, data: updated } }
    catch (error) { return fail('SAVE_ENTRY_FAILED', error instanceof Error ? error.message : '无法更新网址收藏夹。') }
  }

  async cacheMetadata(id: string, metadata: { title?: string; favicon?: string }): Promise<IpcResult<WebsiteEntry>> {
    const entry = this.store.snapshot().webEntries.find((item) => item.id === id)
    if (!entry) return fail('NOT_FOUND', '找不到这个网址。')
    if (metadata.title !== undefined && (metadata.title.length > 300 || typeof metadata.title !== 'string')) return fail('INVALID_METADATA', '网站标题无效。')
    if (metadata.favicon !== undefined && (metadata.favicon.length > 500_000 || !/^data:image\/(?:png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon);base64,/i.test(metadata.favicon))) return fail('INVALID_METADATA', '网站图标无效。')
    const updated = { ...entry, favicon: metadata.favicon ?? entry.favicon }
    try { await this.store.update((data) => ({ ...data, webEntries: data.webEntries.map((item) => item.id === id ? updated : item) })); return { ok: true, data: updated } }
    catch (error) { return fail('SAVE_ENTRY_FAILED', error instanceof Error ? error.message : '无法保存网站图标。') }
  }

  async open(id: string): Promise<IpcResult<void>> {
    const entry = this.store.snapshot().webEntries.find((item) => item.id === id)
    if (!entry) return fail('NOT_FOUND', '找不到这个网址。')
    try { await openExternalUrl(entry.url); return { ok: true, data: undefined } }
    catch (error) { return fail('OPEN_URL_FAILED', error instanceof Error ? error.message : '无法打开这个网址。') }
  }
}
