import { app, BrowserWindow, dialog, ipcMain, type WebContents } from 'electron'
import { basename, dirname, join } from 'node:path'
import { IPC_CHANNELS } from '../src/shared/ipc'
import { DataStore } from './services/data-store'
import { SecretStore } from './services/secret-store'
import { AIProviderCredentialStore } from './services/ai-credentials'
import { OpenAICompatibleAdapter } from './services/openai-compatible-adapter'
import { AnthropicMessagesAdapter } from './services/anthropic-messages-adapter'
import { MyMemoryAdapter } from './services/mymemory-adapter'
import { QwenMtAdapter } from './services/qwen-mt-adapter'
import { SharedAIService } from './services/shared-ai-service'
import { TranslationService } from './services/translation-service'
import { openExternalUrl } from './services/external-opener'
import { BookmarkService } from './services/bookmark-service'
import { WebsiteService } from './services/website-service'
import { WebsiteMetadataService } from './services/website-metadata'
import { EverythingClient } from './services/everything-client'
import { isValidTranslationText } from './services/translation-prefill'
import { registerWindowIpcHandlers } from './ipc/window-handlers'
import { registerWebsiteIpcHandlers } from './ipc/website-handlers'
import { registerSettingsIpcHandlers } from './ipc/settings-handlers'
import { registerTranslationIpcHandlers } from './ipc/translation-handlers'
import { registerEverythingIpcHandlers } from './ipc/everything-handlers'
import { isCurrentWindowMainFrame } from './ipc/window-security'
import { isNativeManagerOnly } from './services/native-manager-mode'
import { NativeManagerClient, parseNativeLauncherState, type NativeLauncherSettingsUpdate, type NativeLauncherState } from './services/native-manager-client'
import { NativeManagerRequestError, type NativeManagerEnvelope } from './services/native-manager-protocol'
import { parseNativeManagerCommand } from './services/native-manager-commands'
import { overlayNativeLauncherSettings, projectWebsitesForNative } from './services/native-launcher-settings'
import { resolveManagerTestProfile } from './services/manager-test-options'
import { createElectronPluginHost } from './plugins/electron-plugin-host'
import { registerPluginIpcHandlers } from './ipc/plugin-handlers'
import type { PluginManager } from './plugins/plugin-manager'

const isDevelopment = !app.isPackaged
const nativeManaged = app.isPackaged || isNativeManagerOnly(process.argv, process.env)
const nativePipeName = process.env.WEBTOOLS_NATIVE_PIPE ?? 'WebTools.NativeHost.Manager.v1'
const managerDirectory = dirname(process.execPath)
const managerTestInstallRoot = app.isPackaged
  ? basename(managerDirectory).toLowerCase() === 'manager' ? dirname(managerDirectory) : managerDirectory
  : undefined
if (isDevelopment) app.setName('webtools-desktop-dev')

// Keep the established profile path: the Native Host migration and Manager share it.
const appDataPath = app.getPath('appData')
app.setPath('userData', resolveManagerTestProfile(process.argv, process.env, {
  userProfilePath: join(appDataPath, 'Nook'),
  installRoot: managerTestInstallRoot,
}) ?? join(appDataPath, isDevelopment ? 'WebTools-Dev' : 'Nook'))

let dataStore: DataStore
let secretStore: SecretStore
let managerWindow: BrowserWindow | null = null
let translationService: TranslationService | null = null
let cancelAIConnectionTests: () => void = () => undefined
let nativeManagerClient: NativeManagerClient | null = null
let nativeLauncherState: NativeLauncherState | null = null
let managerRendererReady = false
let quitting = false
let pluginManager: PluginManager | null = null
let disposePluginHandlers: () => void = () => undefined

interface PendingNativeIntent {
  requestId: string
  intent: { kind: 'open-page'; section: 'favorites' | 'entries' | 'settings' | 'translate' } | { kind: 'translation-prefill'; text: string }
  resolve: () => void
  reject: (error: Error) => void
}

let pendingNativeIntent: PendingNativeIntent | null = null

function cancelActiveAIRequests(): void {
  translationService?.cancelAll()
  cancelAIConnectionTests()
}

function currentSettings() {
  const stored = dataStore.snapshot().settings
  return nativeLauncherState ? overlayNativeLauncherSettings(stored, nativeLauncherState) : stored
}

async function syncNativeWebsiteProjection(): Promise<void> {
  if (!nativeManaged) return
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
  if (managerWindow && !managerWindow.isDestroyed()) {
    managerWindow.show()
    managerWindow.focus()
    return
  }

  managerRendererReady = false
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
    if (!isMainFrame || isInPlace) return
    managerRendererReady = false
    cancelActiveAIRequests()
    pluginManager?.beginSession()
    void pluginManager?.restoreSession()
    if (nativeManaged && nativeManagerClient?.isConnected) {
      void nativeManagerClient.request('manager-renderer-not-ready', {}).catch((error) => console.error('[native-manager] renderer-not-ready failed', error))
    }
  })
  window.on('closed', () => {
    if (managerWindow !== window) return
    cancelActiveAIRequests()
    pluginManager?.close()
    managerWindow = null
    managerRendererReady = false
    if (pendingNativeIntent) {
      pendingNativeIntent.reject(new Error('Manager window closed before acknowledging the current request.'))
      pendingNativeIntent = null
    }
    if (!quitting) {
      quitting = true
      app.quit()
    }
  })
  window.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    window.destroy()
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
  else {
    managerWindow.show()
    managerWindow.focus()
  }
}

function markManagerRendererReady(sender: WebContents): void {
  const window = managerWindow
  if (!window || window.isDestroyed() || window.webContents.isDestroyed() || sender !== window.webContents) return
  managerRendererReady = true
  if (!nativeManaged || !nativeManagerClient?.isConnected) return
  void nativeManagerClient.request('manager-renderer-ready', {}).then(() => deliverPendingNativeIntent()).catch((error) => {
    console.error('[native-manager] renderer-ready acknowledgement failed', error)
    app.quit()
  })
}

const hasSingleInstanceLock = nativeManaged || app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()
else if (!nativeManaged) app.on('second-instance', () => showManager())

ipcMain.handle(IPC_CHANNELS.getVersion, () => app.getVersion())

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  app.setAppUserModelId('dev.nook.launcher')
  dataStore = new DataStore(join(app.getPath('userData'), 'nook-data.json'))
  secretStore = new SecretStore(join(app.getPath('userData'), 'secrets.json'))
  try {
    await dataStore.load()
  } catch (error) {
    dialog.showErrorBox('WebTools 本地数据无法读取', error instanceof Error ? error.message : '请检查本机数据文件和权限。')
    app.quit()
    return
  }
  const recoveryMessage = dataStore.getRecoveryMessage()
  if (recoveryMessage) await dialog.showMessageBox({ type: 'info', title: 'WebTools 本地数据', message: '本机数据已完成升级或恢复。', detail: recoveryMessage, buttons: ['确定'] })

  if (nativeManaged) {
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
  const pluginHost = createElectronPluginHost({ userData: app.getPath('userData'), hostVersion: app.getVersion(), sharedAI: sharedAIService, dataStore, getWindow: () => managerWindow })
  try { await pluginHost.manager.initialize(); pluginManager = pluginHost.manager }
  catch { pluginHost.manager.close() } // Fail closed without preventing existing Manager pages from opening.
  disposePluginHandlers = registerPluginIpcHandlers(ipcMain, {
    getManager: () => pluginManager,
    isManagerMainFrame: context => isCurrentWindowMainFrame(context, managerWindow),
    choosePackage: pluginHost.choosePackage,
  })
  translationService = new TranslationService({
    dataStore,
    sharedAI: sharedAIService,
    aiCredentials,
    myMemoryAdapter: new MyMemoryAdapter(),
    qwenMtAdapter: new QwenMtAdapter(),
  })
  const bookmarkService = new BookmarkService(dataStore)
  const websiteService = new WebsiteService(dataStore)
  const websiteMetadata = new WebsiteMetadataService()
  const everything = new EverythingClient(() => currentSettings().everythingEsPath)

  registerWindowIpcHandlers({
    markManagerRendererReady,
    acknowledgeNativeManagerIntent,
  })
  registerWebsiteIpcHandlers({ websiteService, websiteMetadata, bookmarkService, onWebsitesChanged: syncNativeWebsiteProjection })
  registerSettingsIpcHandlers({
    dataStore,
    isManagerMainFrame: (context) => isCurrentWindowMainFrame(context, managerWindow),
    cancelTranslations: cancelActiveAIRequests,
    getSettings: currentSettings,
    updateNativeLauncherSettings: nativeManaged ? updateNativeLauncherSettings : undefined,
  })
  cancelAIConnectionTests = registerTranslationIpcHandlers({
    translationService,
    sharedAIService,
    aiCredentials,
    openExternal: openExternalUrl,
    isManagerMainFrame: (context) => isCurrentWindowMainFrame(context, managerWindow),
  })
  registerEverythingIpcHandlers({ everything, dataStore, getManagerWindow: () => managerWindow, getSettings: currentSettings })
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (nativeManaged) app.quit()
      else createWindow()
    } else showManager()
  })
})

app.on('window-all-closed', () => app.quit())

app.on('before-quit', () => {
  quitting = true
  cancelActiveAIRequests()
  pluginManager?.close()
  disposePluginHandlers()
  nativeManagerClient?.close()
  nativeManagerClient = null
})
