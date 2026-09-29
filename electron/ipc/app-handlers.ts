import { ipcMain } from 'electron'
import type { AppCatalogService } from '../services/app-catalog'
import type { AppLauncher } from '../services/app-launcher'
import type { DataStore } from '../services/data-store'
import type { LauncherDataService } from '../services/launcher-data'
import type { IpcResult } from '../../src/shared/ipc'
import { getRememberedAppId, MAX_APP_SEARCH_QUERY_LENGTH, normalizeAppSearchQuery, rememberAppSearchResult } from '../../src/shared/app-search-memory'

function fail<T>(code: string, message: string): IpcResult<T> { return { ok: false, error: { code, message } } }

export function registerAppIpcHandlers(deps: {
  appCatalog: AppCatalogService
  appLauncher: AppLauncher
  dataStore: DataStore
  launcherData: LauncherDataService
  getRememberedSearchAppId?: (query: string) => Promise<string | null>
  rememberSearchResult?: (query: string, appId: string) => Promise<void>
  onAppsChanged?: () => void
}): void {
  ipcMain.handle('apps:list', () => deps.appCatalog.list())
  ipcMain.handle('apps:refresh', async () => {
    const entries = await deps.appCatalog.refresh()
    deps.launcherData.markAppsChanged()
    deps.onAppsChanged?.()
    return entries
  })
  ipcMain.handle('apps:get-icon', async (_event, id: unknown): Promise<IpcResult<{ dataUrl: string | null }>> => {
    if (typeof id !== 'string' || !/^[a-f0-9]{16}$/.test(id)) return { ok: false, error: { code: 'INVALID_APP_ID', message: '应用信息无效，请刷新后重试。' } }
    return { ok: true, data: { dataUrl: await deps.appCatalog.getIcon(id) } }
  })
  ipcMain.handle('apps:launch', async (_event, id: unknown): Promise<IpcResult<void>> => {
    if (typeof id !== 'string' || !/^[a-f0-9]{16}$/.test(id)) return { ok: false, error: { code: 'INVALID_APP_ID', message: '应用信息无效，请刷新后重试。' } }
    try { await deps.appLauncher.launchApp(id); return { ok: true, data: undefined } }
    catch (error) { return { ok: false, error: { code: 'APP_LAUNCH_FAILED', message: error instanceof Error ? error.message : '应用启动失败。' } } }
  })
  ipcMain.handle('apps:get-remembered-search-result', async (_event, query: unknown): Promise<string | null> => {
    if (typeof query !== 'string' || query.length > MAX_APP_SEARCH_QUERY_LENGTH) return null
    if (deps.getRememberedSearchAppId) return deps.getRememberedSearchAppId(query)
    return getRememberedAppId(deps.dataStore.snapshot().appSearchMemory, query)
  })
  ipcMain.handle('apps:remember-search-result', async (_event, query: unknown, appId: unknown): Promise<IpcResult<void>> => {
    if (typeof query !== 'string' || !normalizeAppSearchQuery(query)) return fail('INVALID_SEARCH_QUERY', '搜索内容无效，无法记住应用选择。')
    if (typeof appId !== 'string' || !/^[a-f\d]{16}$/i.test(appId) || !deps.appCatalog.list().some((app) => app.id === appId)) {
      return fail('INVALID_APP_ID', '应用信息无效，无法记住此次选择。')
    }
    try {
      if (deps.rememberSearchResult) await deps.rememberSearchResult(query, appId)
      else await deps.dataStore.update((data) => ({ ...data, appSearchMemory: rememberAppSearchResult(data.appSearchMemory, query, appId) }))
      return { ok: true, data: undefined }
    } catch (error) {
      return fail('SAVE_SEARCH_MEMORY_FAILED', error instanceof Error ? error.message : '无法保存应用搜索记忆。')
    }
  })
}
