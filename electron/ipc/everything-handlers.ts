import { ipcMain, dialog, type OpenDialogOptions, type BrowserWindow } from 'electron'
import { basename } from 'node:path'
import type { DataStore } from '../services/data-store'
import type { EverythingClient } from '../services/everything-client'
import type { AppSettings } from '../../src/shared/domain'
import type { IpcResult } from '../../src/shared/ipc'

function fail<T>(code: string, message: string): IpcResult<T> { return { ok: false, error: { code, message } } }

export function registerEverythingIpcHandlers(deps: { everything: EverythingClient; dataStore: DataStore; getManagerWindow: () => BrowserWindow | null; isEverythingEnabled?: () => boolean; getSettings?: () => AppSettings }): void {
  ipcMain.handle('everything:detect', () => deps.everything.detect())
  ipcMain.handle('everything:choose-path', async () => {
    const options: OpenDialogOptions = { title: '选择 Everything ES 命令行工具', properties: ['openFile'], filters: [{ name: 'ES 命令行工具', extensions: ['exe'] }] }
    const window = deps.getManagerWindow()
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    const path = result.canceled ? undefined : result.filePaths[0]
    return path && basename(path).toLocaleLowerCase() === 'es.exe' ? path : null
  })
  ipcMain.handle('everything:search', async (_event, query: unknown): Promise<IpcResult<Awaited<ReturnType<EverythingClient['search']>>>> => {
    if (typeof query !== 'string' || !query.trim()) return { ok: true, data: [] }
    if (!(deps.isEverythingEnabled?.() ?? deps.getSettings?.().everythingEnabled ?? deps.dataStore.snapshot().settings.everythingEnabled)) return fail('EVERYTHING_DISABLED', '请先在设置中启用 Everything 搜索。')
    try { return { ok: true, data: await deps.everything.search(query, 20) } } catch (error) { return fail('EVERYTHING_SEARCH_FAILED', error instanceof Error ? error.message : 'Everything 搜索失败。') }
  })
  ipcMain.handle('everything:open', async (_event, id: unknown): Promise<IpcResult<void>> => {
    if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) return fail('INVALID_RESULT', '文件搜索结果无效。')
    try { await deps.everything.open(id); return { ok: true, data: undefined } } catch (error) { return fail('EVERYTHING_OPEN_FAILED', error instanceof Error ? error.message : '无法打开这个搜索结果。') }
  })
}
