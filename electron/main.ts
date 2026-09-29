import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray, screen, dialog, type Rectangle, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { IPC_CHANNELS, type IpcResult } from '../src/shared/ipc'
import { DataStore } from './services/data-store'
import { SecretStore } from './services/secret-store'
import { AIProviderCredentialStore } from './services/ai-credentials'
import { OpenAICompatibleAdapter } from './services/openai-compatible-adapter'
import { AnthropicMessagesAdapter } from './services/anthropic-messages-adapter'
import { MyMemoryAdapter } from './services/mymemory-adapter'
import { QwenMtAdapter } from './services/qwen-mt-adapter'
import { SharedAIService } from './services/shared-ai-service'
import { TranslationService } from './services/translation-service'
import { AppCatalogService } from './services/app-catalog'
import { LauncherDataService } from './services/launcher-data'
import { AppLauncher } from './services/app-launcher'
import { openExternalUrl } from './services/external-opener'
import { BookmarkService } from './services/bookmark-service'
import { GlobalHotkeyService } from './services/global-hotkey'
import { WebsiteService } from './services/website-service'
import { WebsiteMetadataService } from './services/website-metadata'
import { EverythingClient } from './services/everything-client'
import { isValidTranslationText, TranslationPrefillQueue } from './services/translation-prefill'
import { registerWindowIpcHandlers } from './ipc/window-handlers'
import { registerAppIpcHandlers } from './ipc/app-handlers'
import { registerWebsiteIpcHandlers } from './ipc/website-handlers'
import { registerSettingsIpcHandlers } from './ipc/settings-handlers'
import { registerTranslationIpcHandlers } from './ipc/translation-handlers'
import { registerEverythingIpcHandlers } from './ipc/everything-handlers'
import { registerLauncherDataIpcHandlers } from './ipc/launcher-data-handlers'
import { isCurrentAppMainFrame, isCurrentWindowMainFrame } from './ipc/window-security'
import { LauncherVisibilitySequence, type LauncherVisibilityEvent } from '../src/shared/launcher-visibility'
import { isNativeManagerOnly } from './services/native-manager-mode'
import { NativeManagerClient, parseNativeLauncherState, type NativeLauncherSettingsUpdate, type NativeLauncherState } from './services/native-manager-client'
import { NativeManagerRequestError, type NativeManagerEnvelope } from './services/native-manager-protocol'
import { parseNativeManagerCommand } from './services/native-manager-commands'
import { overlayNativeLauncherSettings, projectWebsitesForNative } from './services/native-launcher-settings'

const isDevelopment = !app.isPackaged
const managerOnly = isNativeManagerOnly(process.argv, process.env)
const nativePipeName = process.env.WEBTOOLS_NATIVE_PIPE ?? 'WebTools.NativeHost.Manager.v1'
if (isDevelopment) app.setName('webtools-desktop-dev')
// Keep installed user data stable while isolating the development profile.
app.setPath('userData', join(app.getPath('appData'), isDevelopment ? 'WebTools-Dev' : 'Nook'))
let dataStore: DataStore
let secretStore: SecretStore
let managerWindow: BrowserWindow | null = null
let translationService: TranslationService | null = null
let cancelAIConnectionTests: () => void = () => undefined
const translationPrefillQueue = new TranslationPrefillQueue()
let launcherWindow: BrowserWindow | null = null
let launcherPositioned = false
let launcherShown = false
let launcherLastBounds: Rectangle | null = null
// Windows fades transparent windows on show/hide, so keep this one visible off-screen.
const parkedLauncherPosition = { x: -32000, y: -32000 }
interface LauncherReadiness { ready: boolean; promise: Promise<void>; resolve: () => void }
const launcherReadiness = new WeakMap<BrowserWindow, LauncherReadiness>()
interface LauncherToggleRequest { shouldShow: boolean }
let launcherToggleRequest: LauncherToggleRequest | null = null
const launcherVisibilitySequence = new LauncherVisibilitySequence()
let tray: Tray | null = null
let quitting = false
let hotkeyService: GlobalHotkeyService | null = null
let nativeManagerClient: NativeManagerClient | null = null
let nativeLauncherState: NativeLauncherState | null = null
let managerRendererReady = false
interface PendingNativeIntent {
  requestId: string
  intent: { kind: 'open-page'; section: 'search' | 'entries' | 'settings' | 'translate' } | { kind: 'translation-prefill'; text: string }
  resolve: () => void
  reject: (error: Error) => void
}
let pendingNativeIntent: PendingNativeIntent | null = null
let removeNativeCommandHandler: (() => void) | null = null

function cancelActiveAIRequests(): void {
  translationService?.cancelAll()
  cancelAIConnectionTests()
}

function currentSettings() {
  const stored = dataStore.snapshot().settings
  return nativeLauncherState ? overlayNativeLauncherSettings(stored, nativeLauncherState) : stored
}

async function syncNativeWebsiteProjection(): Promise<void> {
  if (!managerOnly) return
  if (!nativeManagerClient?.isConnected) throw new Error('Native Host is not connected; website changes were not synchronized.')
  await nativeManagerClient.request('websites-update', projectWebsitesForNative(dataStore.snapshot().webEntries))
}

async function updateNativeLauncherSettings(update: NativeLauncherSettingsUpdate) {
  if (!nativeManagerClient?.isConnected) throw new Error('Native Host is not connected; Launcher settings were not saved.')
  const result = await nativeManagerClient.request<unknown>('launcher-settings-update', update)
  nativeLauncherState = parseNativeLauncherState(result)
  return currentSettings()
}

function deliverPendingNativeIntent(): void {
  const pending = pendingNativeIntent
  const window = managerWindow
  if (!pending || !managerRendererReady || !window || window.isDestroyed() || window.webContents.isDestroyed()) return
  window.show()
  window.focus()
  window.webContents.send(IPC_CHANNELS.nativeManagerIntent, { requestId: pending.requestId, ...pending.intent })
}

function waitForNativeIntentAcknowledgement(
  requestId: string,
  intent: PendingNativeIntent['intent'],
): Promise<void> {
  if (pendingNativeIntent) pendingNativeIntent.reject(new NativeManagerRequestError('INTENT_SUPERSEDED', 'A newer Manager request replaced this one.'))
  return new Promise<void>((resolve, reject) => {
    pendingNativeIntent = { requestId, intent, resolve, reject }
    deliverPendingNativeIntent()
  })
}

async function handleNativeManagerCommand(message: NativeManagerEnvelope): Promise<void | (() => void)> {
  const command = parseNativeManagerCommand(message)
  if (command.kind === 'shutdown-manager') {
    return () => {
      quitting = true
      app.quit()
    }
  }
  if (command.kind === 'open-page') {
    showManager()
    await waitForNativeIntentAcknowledgement(command.requestId, { kind: 'open-page', section: command.section })
    return
  }
  if (!isValidTranslationText(command.text)) throw new NativeManagerRequestError('INVALID_TRANSLATION_TEXT', '翻译内容为空或超过 20,000 个字符。')
  showManager()
  await waitForNativeIntentAcknowledgement(command.requestId, { kind: 'translation-prefill', text: command.text })
}

function acknowledgeNativeManagerIntent(context: { sender: object; senderFrame: object | null }, requestId: unknown): void {
  if (!isCurrentWindowMainFrame(context, managerWindow) || typeof requestId !== 'string') return
  const pending = pendingNativeIntent
  if (!pending || pending.requestId !== requestId) return
  pendingNativeIntent = null
  pending.resolve()
}

function brandResourcePath(fileName: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'brand-assets', fileName)
    : join(__dirname, '../../resources', fileName)
}

function createWindow(): void {
  if (managerWindow && !managerWindow.isDestroyed()) { managerWindow.show(); managerWindow.focus(); return }
  translationPrefillQueue.resetReadiness()
  const window = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 840,
    minHeight: 600,
    backgroundColor: '#10151c',
    title: 'WebTools',
    icon: brandResourcePath('app.ico'),
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
  window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) {
      managerRendererReady = false
      translationPrefillQueue.resetReadiness()
      cancelActiveAIRequests()
      if (managerOnly && nativeManagerClient?.isConnected) {
        void nativeManagerClient.request('manager-renderer-not-ready', {}).catch((error) => console.error('[native-manager] renderer-not-ready failed', error))
      }
    }
  })
  window.on('closed', () => {
    if (managerWindow === window) {
      translationPrefillQueue.resetReadiness()
      cancelActiveAIRequests()
      managerWindow = null
      managerRendererReady = false
      if (pendingNativeIntent) {
        pendingNativeIntent.reject(new Error('Manager window closed before acknowledging the current request.'))
        pendingNativeIntent = null
      }
      if (managerOnly && !quitting) {
        quitting = true
        app.quit()
      }
    }
  })
  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      window.destroy()
    }
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

function deliverTranslationPrefill(): void {
  const window = managerWindow
  const request = translationPrefillQueue.getReadyRequest()
  if (!window || window.isDestroyed() || window.webContents.isDestroyed() || !request) return
  window.webContents.send(IPC_CHANNELS.translationPrefill, request)
}

function markManagerRendererReady(sender: WebContents): void {
  const window = managerWindow
  if (!window || window.isDestroyed() || window.webContents.isDestroyed() || sender !== window.webContents) return
  managerRendererReady = true
  if (managerOnly && nativeManagerClient?.isConnected) {
    void nativeManagerClient.request('manager-renderer-ready', {}).then(() => deliverPendingNativeIntent()).catch((error) => {
      console.error('[native-manager] renderer-ready acknowledgement failed', error)
      app.quit()
    })
    return
  }
  const request = translationPrefillQueue.markReady()
  if (request) window.webContents.send(IPC_CHANNELS.translationPrefill, request)
}

function acknowledgeTranslationPrefill(sender: WebContents, id: unknown): void {
  const window = managerWindow
  if (!window || window.isDestroyed() || window.webContents.isDestroyed() || sender !== window.webContents || typeof id !== 'string') return
  translationPrefillQueue.acknowledge(id)
}

function openTranslation(context: { sender: object; senderFrame: object | null }, text: unknown): IpcResult<void> {
  if (!isCurrentWindowMainFrame(context, launcherWindow)) {
    return { ok: false, error: { code: 'INVALID_SENDER', message: '无法从当前窗口发起翻译。' } }
  }
  if (!isValidTranslationText(text)) {
    return { ok: false, error: { code: 'INVALID_TRANSLATION_TEXT', message: '翻译内容不能为空且不能超过 20,000 个字符。' } }
  }

  const request = { id: randomUUID(), text }
  translationPrefillQueue.enqueue(request)
  try {
    showManager()
    deliverTranslationPrefill()
    return { ok: true, data: undefined }
  } catch {
    translationPrefillQueue.discard(request.id)
    return { ok: false, error: { code: 'MANAGER_UNAVAILABLE', message: '无法打开 WebTools 翻译窗口。' } }
  }
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
    ...parkedLauncherPosition,
    width: 850,
    height: 128,
    frame: false,
    thickFrame: false,
    type: 'toolbar',
    resizable: false,
    show: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    title: 'WebTools 快速搜索',
    icon: brandResourcePath('app.ico'),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
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
      launcherVisibilitySequence.next()
      launcherWindow = null
      launcherPositioned = false
      launcherShown = false
      launcherLastBounds = null
    }
  })
  window.on('blur', () => {
    if (launcherShown) hideLauncher()
  })
  if (isDevelopment && process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/launcher.html`)
  else void window.loadFile(join(__dirname, '../renderer/launcher.html'))
  window.setPosition(parkedLauncherPosition.x, parkedLauncherPosition.y)
  window.showInactive()
  return window
}

function hideLauncher(): void {
  if (!launcherWindow || launcherWindow.isDestroyed() || !launcherShown) return
  launcherShown = false
  launcherLastBounds = launcherWindow.getBounds()
  launcherWindow.setPosition(parkedLauncherPosition.x, parkedLauncherPosition.y)
  launcherWindow.blur()
  sendLauncherVisibility(launcherWindow, { kind: 'hidden', generation: launcherVisibilitySequence.next() })
}

function sendLauncherVisibility(window: BrowserWindow, event: LauncherVisibilityEvent): void {
  if (!window.isDestroyed() && launcherWindow === window && launcherReadiness.get(window)?.ready) {
    window.webContents.send(IPC_CHANNELS.launcherVisibility, event)
  }
}

async function dispatchLauncherShown(window: BrowserWindow): Promise<void> {
  const generation = launcherVisibilitySequence.next()
  const { launcherDisplayMode, theme } = dataStore.snapshot().settings
  const event: LauncherVisibilityEvent = { kind: 'shown', generation, launcherDisplayMode, theme }
  if (!await waitForLauncherRenderer(window) || !launcherShown || !launcherVisibilitySequence.isCurrent(generation)) return
  const acknowledged = launcherVisibilitySequence.waitForAcknowledgement(generation)
  sendLauncherVisibility(window, event)
  await acknowledged
  if (launcherWindow === window && !window.isDestroyed() && launcherShown && launcherVisibilitySequence.isCurrent(generation)) window.focus()
}

function acknowledgeLauncherVisibility(sender: WebContents, generation: unknown): void {
  if (!launcherWindow || sender !== launcherWindow.webContents || typeof generation !== 'number' || !Number.isSafeInteger(generation)) return
  launcherVisibilitySequence.acknowledge(generation)
}

function markLauncherRendererReady(sender: WebContents): void {
  if (!launcherWindow || launcherWindow.isDestroyed() || sender !== launcherWindow.webContents) return
  const readiness = launcherReadiness.get(launcherWindow)
  if (!readiness || readiness.ready) return
  readiness.ready = true
  readiness.resolve()
  if (launcherShown) void dispatchLauncherShown(launcherWindow)
}

async function showLauncher(): Promise<void> {
  const window = createLauncherWindow()
  const { launcherDisplayMode } = dataStore.snapshot().settings
  if (!launcherPositioned) {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const bounds = display.workArea
    window.setBounds({ x: Math.round(bounds.x + (bounds.width - 850) / 2), y: Math.round(bounds.y + bounds.height * 0.18), width: 850, height: 128 })
    launcherPositioned = true
  } else if (launcherLastBounds) window.setBounds(launcherLastBounds)
  launcherShown = true
  resizeLauncher(launcherDisplayMode === 'expanded')
  await dispatchLauncherShown(window)
}

function resizeLauncher(expanded: boolean, expandedSectionExtraHeight = 0, hasSearchResults = false): void {
  if (!launcherWindow || launcherWindow.isDestroyed()) return
  const current = launcherShown ? launcherWindow.getBounds() : launcherLastBounds
  if (!current) return
  const display = screen.getDisplayMatching(current)
  const bounds = display.workArea
  const height = !expanded ? 128 : hasSearchResults ? 466 : 326 + Math.min(300, expandedSectionExtraHeight)
  const x = Math.max(bounds.x, Math.min(current.x, bounds.x + bounds.width - current.width))
  const y = Math.max(bounds.y, Math.min(current.y, bounds.y + bounds.height - height))
  const nextBounds = { x, y, width: current.width, height }
  if (launcherShown) launcherWindow.setBounds(nextBounds)
  else launcherLastBounds = nextBounds
}

function moveLauncherBy(sender: WebContents, deltaX: number, deltaY: number): void {
  if (!launcherWindow || launcherWindow.isDestroyed() || !launcherShown || sender !== launcherWindow.webContents) return
  const current = launcherWindow.getBounds()
  const workArea = screen.getDisplayMatching(current).workArea
  const x = Math.max(workArea.x, Math.min(current.x + Math.round(deltaX), workArea.x + workArea.width - current.width))
  const y = Math.max(workArea.y, Math.min(current.y + Math.round(deltaY), workArea.y + workArea.height - current.height))
  launcherWindow.setPosition(x, y)
}

function toggleLauncher(): void {
  if (launcherToggleRequest) {
    launcherToggleRequest.shouldShow = !launcherToggleRequest.shouldShow
    if (launcherToggleRequest.shouldShow) {
      const window = launcherWindow
      if (!window || window.isDestroyed()) return
      if (launcherLastBounds) window.setBounds(launcherLastBounds)
      launcherShown = true
      void dispatchLauncherShown(window)
    } else {
      hideLauncher()
    }
    return
  }
  if (launcherShown) {
    hideLauncher()
    return
  }
  const request: LauncherToggleRequest = { shouldShow: true }
  launcherToggleRequest = request
  void showLauncher().finally(() => {
    if (launcherToggleRequest === request) launcherToggleRequest = null
  })
}

function createTray(): void {
  const image = nativeImage.createFromPath(brandResourcePath('tray-32.png'))
  tray = new Tray(image)
  tray.setToolTip('WebTools')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 WebTools', click: showManager },
    { label: '退出', click: () => { quitting = true; hotkeyService?.dispose(); app.quit() } },
  ]))
  tray.on('double-click', showManager)
}

function setOpenAtLogin(enabled: boolean): void {
  // Windows does not expose wasOpenedAtLogin, so tag the startup shortcut and
  // use that argument to distinguish silent login launches from manual starts.
  app.setLoginItemSettings({ openAtLogin: enabled, args: enabled ? ['--hidden'] : [] })
}

const startedHidden = process.argv.includes('--hidden')

ipcMain.handle('app:get-version', () => app.getVersion())

const hasSingleInstanceLock = managerOnly || app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()
else if (!managerOnly) app.on('second-instance', (_event, commandLine) => {
  if (!commandLine.includes('--hidden')) showManager()
})

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
  if (managerOnly) {
    nativeManagerClient = new NativeManagerClient(nativePipeName)
    nativeManagerClient.onCommand(handleNativeManagerCommand)
    nativeManagerClient.onDisconnect((error) => {
      console.error('[native-manager] Native Host disconnected; exiting Manager', error?.message ?? '')
      if (!quitting) app.quit()
    })
    try {
      nativeLauncherState = parseNativeLauncherState(await nativeManagerClient.connect())
      await syncNativeWebsiteProjection()
    } catch (error) {
      dialog.showErrorBox('WebTools Native Host 连接失败', error instanceof Error ? error.message : '无法连接常驻启动器。')
      app.quit()
      return
    }
  }
  const aiCredentials = new AIProviderCredentialStore(secretStore)
  const sharedAIService = new SharedAIService({
    dataStore,
    credentials: aiCredentials,
    openAICompatibleAdapter: new OpenAICompatibleAdapter(),
    anthropicAdapter: new AnthropicMessagesAdapter(),
  })
  translationService = new TranslationService({
    dataStore,
    sharedAI: sharedAIService,
    aiCredentials,
    myMemoryAdapter: new MyMemoryAdapter(),
    qwenMtAdapter: new QwenMtAdapter(),
  })
  const appCatalog = new AppCatalogService()
  const appLauncher = new AppLauncher(appCatalog)
  const bookmarkService = new BookmarkService(dataStore)
  const websiteService = new WebsiteService(dataStore)
  const websiteMetadata = new WebsiteMetadataService()
  const everything = new EverythingClient(() => currentSettings().everythingEsPath)
  const launcherData = new LauncherDataService(appCatalog, websiteService)
  if (managerOnly) {
    void appCatalog.refresh().then(() => {
      launcherData.markAppsChanged()
      managerWindow?.webContents.send(IPC_CHANNELS.appsCatalogUpdated)
    }).catch((error) => console.error('[manager] application catalog refresh failed', error))
  } else await appCatalog.refresh()
  if (!managerOnly) {
    hotkeyService = new GlobalHotkeyService()
    const shortcutResult = hotkeyService.register(dataStore.snapshot().settings.quickSearchShortcut, toggleLauncher)
    if (!shortcutResult.ok) console.warn(shortcutResult.error.message)
    setOpenAtLogin(dataStore.snapshot().settings.launchOnStartup)
    createTray()
  }
  registerWindowIpcHandlers({
    showLauncher: () => { if (!managerOnly) void showLauncher() },
    hideLauncher: () => { if (!managerOnly) hideLauncher() },
    acknowledgeLauncherVisibility,
    setLauncherExpanded: (sender, expanded, extraHeight, hasResults, generation) => {
    if (launcherWindow && sender === launcherWindow.webContents && launcherShown && launcherVisibilitySequence.isCurrent(generation)) {
      resizeLauncher(expanded, extraHeight, hasResults)
    }
    },
    moveLauncherBy: (sender, deltaX, deltaY) => { if (!managerOnly) moveLauncherBy(sender, deltaX, deltaY) },
    markLauncherRendererReady,
    showManager,
    openTranslation,
    markManagerRendererReady,
    acknowledgeTranslationPrefill,
    acknowledgeNativeManagerIntent,
  })
  registerAppIpcHandlers({
    appCatalog,
    appLauncher,
    dataStore,
    launcherData,
    getRememberedSearchAppId: managerOnly ? async (query) => {
      if (!nativeManagerClient?.isConnected) return null
      const result = await nativeManagerClient.request<{ appId: string | null }>('app-memory-get', { query })
      return typeof result?.appId === 'string' ? result.appId : null
    } : undefined,
    rememberSearchResult: managerOnly ? async (query, appId) => {
      if (!nativeManagerClient?.isConnected) throw new Error('Native Host is not connected.')
      await nativeManagerClient.request('app-memory-remember', { query, appId })
    } : undefined,
    onAppsChanged: () => managerWindow?.webContents.send(IPC_CHANNELS.appsCatalogUpdated),
  })
  registerWebsiteIpcHandlers({ websiteService, websiteMetadata, bookmarkService, onWebsitesChanged: async () => {
    launcherData.markWebsitesChanged()
    await syncNativeWebsiteProjection()
  } })
  registerLauncherDataIpcHandlers({ launcherData, isLauncherMainFrame: (event) => isCurrentWindowMainFrame(event, launcherWindow) })
  registerSettingsIpcHandlers({
    dataStore,
    hotkeyService,
    setOpenAtLogin,
    openExternal: openExternalUrl,
    isManagerMainFrame: (context) => isCurrentWindowMainFrame(context, managerWindow),
    isAppMainFrame: (context) => isCurrentAppMainFrame(context, [managerWindow, launcherWindow]),
    cancelTranslations: cancelActiveAIRequests,
    getSettings: currentSettings,
    updateNativeLauncherSettings: managerOnly ? updateNativeLauncherSettings : undefined,
  })
  cancelAIConnectionTests = registerTranslationIpcHandlers({
    translationService,
    sharedAIService,
    aiCredentials,
    openExternal: openExternalUrl,
    isManagerMainFrame: (context) => isCurrentWindowMainFrame(context, managerWindow),
  })
  registerEverythingIpcHandlers({ everything, dataStore, getManagerWindow: () => managerWindow, getSettings: currentSettings })
  if (!managerOnly) createLauncherWindow()
  if (managerOnly || !startedHidden) createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (managerOnly) app.quit()
      else createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (managerOnly) app.quit()
  // Fallback mode remains resident in the Windows tray.
})

app.on('before-quit', () => {
  quitting = true
  hotkeyService?.dispose()
  tray?.destroy()
  tray = null
  cancelActiveAIRequests()
  nativeManagerClient?.close()
  nativeManagerClient = null
})
