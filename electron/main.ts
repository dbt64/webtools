import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { DataStore } from './services/data-store'
import { SecretStore } from './services/secret-store'

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
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
