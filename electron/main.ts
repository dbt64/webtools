import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray, screen, dialog } from 'electron'
import { join } from 'node:path'
import { DataStore } from './services/data-store'
import { SecretStore } from './services/secret-store'
import { AppCatalogService } from './services/app-catalog'
import { AppLauncher } from './services/app-launcher'
import { openExternalUrl } from './services/external-opener'
import { BookmarkService } from './services/bookmark-service'
import { AiTranslationService } from './services/ai-translation'
import { GlobalHotkeyService } from './services/global-hotkey'
import { WebsiteService } from './services/website-service'
import { WebsiteMetadataService } from './services/website-metadata'
import { EverythingClient } from './services/everything-client'
import { registerWindowIpcHandlers } from './ipc/window-handlers'
import { registerAppIpcHandlers } from './ipc/app-handlers'
import { registerWebsiteIpcHandlers } from './ipc/website-handlers'
import { registerSettingsIpcHandlers } from './ipc/settings-handlers'
import { registerTranslationIpcHandlers } from './ipc/translation-handlers'
import { registerEverythingIpcHandlers } from './ipc/everything-handlers'

const isDevelopment = !app.isPackaged
// Keep the original Nook data directory stable after changing the visible product name.
app.setPath('userData', join(app.getPath('appData'), 'Nook'))
let dataStore: DataStore
let secretStore: SecretStore
let managerWindow: BrowserWindow | null = null
let launcherWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let hotkeyService: GlobalHotkeyService | null = null

function createWindow(): void {
  if (managerWindow && !managerWindow.isDestroyed()) { managerWindow.show(); managerWindow.focus(); return }
  const window = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 840,
    minHeight: 600,
    backgroundColor: '#10151c',
    title: 'WebTools',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  managerWindow = window
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:') && !url.startsWith('http://localhost:')) event.preventDefault()
  })
  window.on('closed', () => { if (managerWindow === window) managerWindow = null })
  window.on('close', (event) => {
    if (!quitting) { event.preventDefault(); window.hide() }
  })

  window.once('ready-to-show', () => window.show())

  if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showManager(): void {
  if (!managerWindow || managerWindow.isDestroyed()) createWindow()
  else { managerWindow.show(); managerWindow.focus() }
}

function createLauncherWindow(): BrowserWindow {
  if (launcherWindow && !launcherWindow.isDestroyed()) return launcherWindow
  const window = new BrowserWindow({
    width: 850,
    height: 88,
    frame: false,
    resizable: false,
    show: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    title: 'WebTools 快速搜索',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  launcherWindow = window
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('file:') && !url.startsWith('http://localhost:')) event.preventDefault() })
  window.on('closed', () => { if (launcherWindow === window) launcherWindow = null })
  if (isDevelopment && process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/launcher.html`)
  else void window.loadFile(join(__dirname, '../renderer/launcher.html'))
  return window
}

function showLauncher(): void {
  const window = createLauncherWindow()
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const bounds = display.workArea
  window.setBounds({ x: Math.round(bounds.x + (bounds.width - 850) / 2), y: Math.round(bounds.y + bounds.height * 0.22), width: 850, height: 88 })
  window.show()
  window.focus()
  if (window.webContents.isLoading()) window.webContents.once('did-finish-load', () => void window.webContents.executeJavaScript("window.dispatchEvent(new Event('webtools-launcher-show'))"))
  else void window.webContents.executeJavaScript("window.dispatchEvent(new Event('webtools-launcher-show'))")
}

function resizeLauncher(expanded: boolean): void {
  if (!launcherWindow || launcherWindow.isDestroyed()) return
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const bounds = display.workArea
  const height 