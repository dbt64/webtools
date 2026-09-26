import { ipcMain } from 'electron'
import type { WebsiteService } from '../services/website-service'
import type { WebsiteMetadataService } from '../services/website-metadata'
import type { BookmarkService } from '../services/bookmark-service'
import type { IpcResult } from '../../src/shared/ipc'

function fail<T>(code: string, message: string): IpcResult<T> { return { ok: false, error: { code, message } } }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

export function registerWebsiteIpcHandlers(deps: { websiteService: WebsiteService; websiteMetadata: WebsiteMetadataService; bookmarkService: BookmarkService }): void {
  ipcMain.handle('websites:list', (_event, folderId: unknown) => deps.websiteService.list(typeof folderId === 'string' ? folderId : undefined))
  ipcMain.handle('websites:save', async (_event, input: unknown) => {
    if (!isRecord(input) || typeof input.name !== 'string' || typeof input.url !== 'string' || !Array.isArray(input.folderIds) || !input.folderIds.every((value) => typeof value === 'string') || (input.id !== undefined && typeof input.id !== 'string') || (input.description !== undefined && typeof input.description !== 'string') || (input.favicon !== undefined && typeof input.favicon !== 'string')) return fail('INVALID_ENTRY', '网址信息无效。')
    return deps.websiteService.save({ id: input.id as string | undefined, name: input.name, url: input.url, description: input.description as string | undefined, favicon: input.favicon as string | undefined, folderIds: input.folderIds })
  })
  ipcMain.handle('websites:delete', async (_event, id: unknown) => typeof id === 'string' ? deps.websiteService.delete(id) : fail('INVALID_ID', '网址编号无效。'))
  ipcMain.handle('websites:add-to-folders', async (_event, id: unknown, folderIds: unknown) => typeof id === 'string' && Array.isArray(folderIds) && folderIds.every((value) => typeof value === 'string') ? deps.websiteService.addWebsiteToFolders(id, folderIds) : fail('INVALID_FOLDER', '收藏夹编号无效。'))
  ipcMain.handle('websites:fetch-metadata', async (_event, url: unknown) => {
    if (typeof url !== 'string') return fail('INVALID_URL', '网址格式不正确。')
    try { return { ok: true, data: await deps.websiteMetadata.fetch(url) } } catch (error) { return fail('FETCH_METADATA_FAILED', error instanceof Error ? error.message : '无法获取网站信息。') }
  })
  ipcMain.handle('websites:open', async (_event, id: unknown) => typeof id === 'string' ? deps.websiteService.open(id) : fail('INVALID_ID', '网址编号无效。'))
  ipcMain.handle('bookmarks:list-folders', () => deps.bookmarkService.listFolders())
  ipcMain.handle('bookmarks:save-folder', async (_event, input: unknown): Promise<IpcResult<Awaited<ReturnType<BookmarkService['saveFolder']>>>> => {
    if (!isRecord(input) || typeof input.name !== 'string' || input.name.length > 80 || (input.id !== undefined && typeof input.id !== 'string')) return fail('INVALID_FOLDER', '收藏夹信息无效。')
    try { return { ok: true, data: await deps.bookmarkService.saveFolder({ id: input.id as string | undefined, name: input.name }) } } catch (error) { return fail('SAVE_FOLDER_FAILED', error instanceof Error ? error.message : '无法保存收藏夹。') }
  })
  ipcMain.handle('bookmarks:delete-folder', async (_event, folderId: unknown): Promise<IpcResult<void>> => {
    if (typeof folderId !== 'string') return fail('INVALID_FOLDER', '收藏夹编号无效。')
    try { await deps.bookmarkService.deleteFolder(folderId); return { ok: true, data: undefined } } catch (error) { return fail('DELETE_FOLDER_FAILED', error instanceof Error ? error.message : '无法删除收藏夹。') }
  })
}
