import { ipcMain } from 'electron'
import type { AppCatalogService } from '../services/app-catalog'
import type { AppLauncher } from '../services/app-launcher'
import type { IpcResult } from '../../src/shared/ipc'

export function registerAppIpcHandlers(deps: { appCatalog: AppCatalogService; appLauncher: AppLauncher }): void {
  ipcMain.handle('apps:list', () => deps.appCatalog.list())
  ipcMain.handle('apps:refresh', () => deps.appCatalog.refresh())
  ipcMain.handle('apps:launch', async (_event, id: unknown): Promise<IpcResult<void>> => {
    if (typeof id !== 'string' || !/^[a-f0-9]{16}$/.test(id)) return { ok: false, error: { code: 'INVALID_APP_ID', message: '应用信息无效，请刷新后重试。' } }
    try { await deps.appLauncher.launchApp(id); return { ok: true, data: undefined } }
    catch (error) { return { ok: false, error: { code: 'APP_LAUNCH_FAILED', message: error instanceof Error ? error.message : '应用启动失败。' } } }
  })
}
