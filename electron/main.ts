import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray, screen, dialog, type WebContents } from 'electron'
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
if (isDevelopment) app.setName('webtools-desktop-dev')
// Keep installed user data stable while isolating the development profile.
app.setPath('userData', join(app.getPath('appData'), isDevelopment ? 'WebTools-Dev' : 'Nook'))
let dataStore: DataStore
let secretStore: SecretStore
let managerWindow: BrowserWindow | null = null
let launcherWindow: BrowserWindow | null = null
let launcherPositioned = false
interface LauncherReadiness { ready: boolean; promise: Promise<void>; resolve: () => void }
const launcherReadiness = new WeakMap<BrowserWindow, LauncherReadiness>()
interface LauncherToggleRequest { shouldShow: boolean }
let launcherToggleRequest: LauncherToggleRequest | null = null
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

function createLauncherReadiness(): LauncherReadiness {
  let resolve!: () => void
  const promise = new Promise<void>((complete) => { resolve = complete })
  return { ready: false, promise, resolve }
}

function resetLauncherReadiness(window: BrowserWindow): void {
  launcherReadiness.get(window)?.resolve()
  launcherReadiness.set(window, createLauncherReadiness())
}

async function waitForLauncherRenderer(window: BrowserWindow): Promise<boolean> {
  while (!window.isDestroyed() && launcherWindow === window) {
    const readiness = launcherReadiness.get(window)
    if (!readiness || readiness.ready) return true
    await readiness.promise
  }
  return false
}

function createLauncherWindow(): BrowserWindow {
  if (launcherWindow && !launcherWindow.isDestroyed()) return launcherWindow
  const window = new BrowserWindow({
    width: 850,
    height: 128,
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
  launcherReadiness.set(window, createLauncherReadiness())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('file:') && !url.startsWith('http://localhost:')) event.preventDefault() })
  window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace && launcherReadiness.get(window)?.ready) resetLauncherReadiness(window)
  })
  window.on('closed', () => {
    launcherReadiness.get(window)?.resolve()
    if (launcherWindow === window) {
      launcherWindow = null
      launcherPositioned = false
    }
  })
  window.on('blur', () => {
    if (window.isVisible()) window.hide()
  })
  if (isDevelopment && process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/launcher.html`)
  else void window.loadFile(join(__dirname, '../renderer/launcher.html'))
  return window
}

function markLauncherRendererReady(sender: WebContents): void {
  if (!launcherWindow || launcherWindow.isDestroyed() || sender !== launcherWindow.webContents) return
  const readiness = launcherReadiness.get(launcherWindow)
  if (!readiness || readiness.ready) return
  readiness.ready = true
  readiness.resolve()
}

async function showLauncher(toggleRequest?: LauncherToggleRequest): Promise<void> {
  const window = createLauncherWindow()
  const { launcherDisplayMode, theme } = dataStore.snapshot().settings
  if (!launcherPositioned) {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const bounds = display.workArea
    window.setBounds({ x: Math.round(bounds.x + (bounds.width - 850) / 2), y: Math.round(bounds.y + bounds.height * 0.18), width: 850, height: 128 })
    launcherPositioned = true
  }
  resizeLauncher(launcherDisplayMode === 'expanded')
  if (!await waitForLauncherRenderer(window)) return
  if (toggleRequest && !toggleRequest.shouldShow) return
  const detail = JSON.stringify({ launcherDisplayMode, theme })
  await window.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('webtools-launcher-show', { detail: ${detail} }))`).catch(() => undefined)
  if (window.isDestroyed() || launcherWindow !== window || (toggleRequest && !toggleRequest.shouldShow)) return
  window.show()
  window.focus()
}

function resizeLauncher(expanded: boolean, expandedSections = 0, hasSearchResults = false): void {
  if (!launcherWindow || launcherWindow.isDestroyed()) return
  const current = launcherWindow.getBounds()
  const display = screen.getDisplayMatching(current)
  const bounds = display.workArea
  const height = !expanded ? 128 : hasSearchResults ? 466 : 326 + Math.min(2, expandedSections) * 120
  const x = Math.max(bounds.x, Math.min(current.x, bounds.x + bounds.width - current.width))
  const y = Math.max(bounds.y, Math.min(current.y, bounds.y + bounds.height - height))
  launcherWindow.setBounds({ x, y, width: current.width, height })
}

function moveLauncherBy(sender: WebContents, deltaX: number, deltaY: number): void {
  if (!launcherWindow || launcherWindow.isDestroyed() || !launcherWindow.isVisible() || sender !== launcherWindow.webContents) return
  const current = launcherWindow.getBounds()
  const workArea = screen.getDisplayMatching(current).workArea
  const x = Math.max(workArea.x, Math.min(current.x + Math.round(deltaX), workArea.x + workArea.width - current.width))
  const y = Math.max(workArea.y, Math.min(current.y + Math.round(deltaY), workArea.y + workArea.height - current.height))
  launcherWindow.setPosition(x, y)
}

function toggleLauncher(): void {
  if (launcherWindow && !launcherWindow.isDestroyed() && launcherWindow.isVisible()) {
    if (launcherToggleRequest) launcherToggleRequest.shouldShow = false
    launcherWindow.hide()
    return
  }
  if (launcherToggleRequest) {
    launcherToggleRequest.shouldShow = !launcherToggleRequest.shouldShow
    return
  }
  const request: LauncherToggleRequest = { shouldShow: true }
  launcherToggleRequest = request
  void showLauncher(request).finally(() => {
    if (launcherToggleRequest === request) launcherToggleRequest = null
  })
}

function createTray(): void {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect x="1" y="1" width="30" height="30" rx="8" fill="#9fdfc3"/><path d="M11 10h10M11 16h10M11 22h10" stroke="#15261f" stroke-width="2" stroke-linecap="round"/></svg>'
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
  tray = new Tray(image)
  tray.setToolTip('WebTools')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 WebTools', click: showManager },
    { label: '退出', click: () => { quitting = true; hotkeyService?.dispose(); app.quit() } },
  ]))
  tray.on('double-click', showManager)
}

ipcMain.handle('app:get-version', () => app.getVersion())

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()
else app.on('second-instance', () => showManager())

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  app.setAppUserModelId('dev.nook.launcher')
  dataStore = new DataStore(join(app.getPath('userData'), 'nook-data.json'))
  secretStore = new SecretStore(join(app.getPath('userData'), 'secrets.json'))
  try { await dataStore.load() } catch (error) {
    dialog.showErrorBox('WebTools 本地数据无法读取', error instanceof Error ? error.message : '请检查本机数据文件和权限。')
    app.quit()
    return
  }
  const recoveryMessage = dataStore.getRecoveryMessage()
  if (recoveryMessage) await dialog.showMessageBox({ type: 'info', title: 'WebTools 本地数据', message: '本机数据已完成升级或恢复。', detail: recoveryMessage, buttons: ['确定'] })
  const aiTranslationService = new AiTranslationService(dataStore, secretStore)
  const appCatalog = new AppCatalogService()
  const appLauncher = new AppLauncher(appCatalog)
  const bookmarkService = new BookmarkService(dataStore)
  const websiteService = new WebsiteService(dataStore)
  const websiteMetadata = new WebsiteMetadataService()
  const everything = new EverythingClient(() => dataStore.snapshot().settings.everythingEsPath)
  await appCatalog.refresh()
  hotkeyService = new GlobalHotkeyService()
  const shortcutResult = hotkeyService.register(dataStore.snapshot().settings.quickSearchShortcut, toggleLauncher)
  if (!shortcutResult.ok) console.warn(shortcutResult.error.message)
  app.setLoginItemSettings({ openAtLogin: dataStore.snapshot().settings.launchOnStartup })
  createTray()
  registerWindowIpcHandlers({ showLauncher, hideLauncher: () => launcherWindow?.hide(), setLauncherExpanded: resizeLauncher, moveLauncherBy, markLauncherRendererReady, showManager })
  registerAppIpcHandlers({ appCatalog, appLauncher })
  registerWebsiteIpcHandlers({ websiteService, websiteMetadata, bookmarkService })
  registerSettingsIpcHandlers({ dataStore, hotkeyService, setOpenAtLogin: (enabled) => app.setLoginItemSettings({ openAtLogin: enabled }), openExternal: openExternalUrl })
  registerTranslationIpcHandlers({ aiTranslationService, secretStore, openExternal: openExternalUrl })
  registerEverythingIpcHandlers({ everything, dataStore, getManagerWindow: () => managerWindow })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // The app remains resident in the Windows tray.
})

app.on('before-quit', () => {
  quitting = true
  hotkeyService?.dispose()
  tray?.destroy()
  tray = null
})
