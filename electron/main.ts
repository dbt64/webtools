import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { DataStore } from './services/data-store'
import { SecretStore } from './services/secret-store'
import { AppCatalogService } from './services/app-catalog'
import { AppLauncher } from './services/app-launcher'
import type { IpcResult } from '../src/shared/ipc'

const isDevelopment = !app.isPackaged

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 840,
    minHeight: 600,
    backgroundColor: '#10151c',
    title: 'Nook',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.once('ready-to-show', () => window.show())

  if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('app:get-version', () => app.getVersion())

app.whenReady().then(async () => {
  const dataStore = new DataStore(join(app.getPath('userData'), 'nook-data.json'))
  const secretStore = new SecretStore(join(app.getPath('userData'), 'secrets.json'))
  await dataStore.load()
  void secretStore
  const appCatalog = new AppCatalogService()
  const appLauncher = new AppLauncher(appCatalog)
  await appCatalog.refresh()
  ipcMain.handle('apps:list', () => appCatalog.list())
  ipcMain.handle('apps:refresh', () => appCatalog.refresh())
  ipcMain.handle('apps:launch', async (_event, id: unknown): Promise<IpcResult<void>> => {
    if (typeof id !== 'string' || !/^[a-f0-9]{16}$/.test(id)) {
      return { ok: false, error: { code: 'INVALID_APP_ID', message: '应用信息无效，请刷新后重试。' } }
    }
    try {
      await appLauncher.launchApp(id)
      return { ok: true, data: undefined }
    } catch (error) {
      return { ok: false, error: { code: 'APP_LAUNCH_FAILED', message: error instanceof Error ? error.message : '应用启动失败。' } }
    }
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
