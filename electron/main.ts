import { app, BrowserWindow, dialog, ipcMain, protocol, type WebContents } from 'electron'
import { basename, dirname, join } from 'node:path'
import { readFile, unlink } from 'node:fs/promises'
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
import { BuiltinPluginStateStore } from './plugins/builtin-plugin-state'
import { BuiltinTranslationLifecycle } from './plugins/builtin-translation-lifecycle'
import { BuiltinTranslationHandoff } from './services/builtin-translation-handoff'
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
import { NativeManagerClient, nativeManagerReply, parseNativeLauncherState, type NativeLauncherSettingsUpdate, type NativeLauncherState } from './services/native-manager-client'
import { NativeManagerRequestError, type NativeManagerEnvelope } from './services/native-manager-protocol'
import { parseNativeManagerCommand } from './services/native-manager-commands'
import { FeatureInvocationService } from './services/feature-invocation-service'
import { overlayNativeLauncherSettings, projectWebsitesForNative } from './services/native-launcher-settings'
import { resolveManagerTestProfile } from './services/manager-test-options'
import { createElectronPluginHost } from './plugins/electron-plugin-host'
import { registerPluginIpcHandlers } from './ipc/plugin-handlers'
import { registerPluginCatalogIpcHandlers } from './ipc/plugin-catalog-handlers'
import { registerBuiltinTranslationHandoffHandlers } from './ipc/builtin-translation-handoff-handlers'
import { PluginCatalog } from './plugins/plugin-catalog'
import { FeatureRegistry } from './plugins/feature-registry'
import { NativePluginProjectionPublisher } from './services/native-plugin-projection-publisher'
import { NativeFeatureProjectionPublisher } from './services/native-feature-projection-publisher'
import type { PluginRef } from '../src/shared/plugin-catalog-contracts'
import type { PluginManager } from './plugins/plugin-manager'
import type { DeclarativeCompatibilityFeature } from './plugins/feature-contracts'
import type { FeatureRef } from '../src/shared/feature-contracts'
import { WebPluginRuntime } from './plugins/web-plugin-runtime.ts'
import { validateWebPackageForRuntime } from './plugins/package-validator.ts'
import { resolveWebRuntimeAcceptanceOptions } from './services/web-runtime-acceptance-options.ts'

protocol.registerSchemesAsPrivileged([{
  scheme: 'webtools-plugin',
  privileges: { standard: true, secure: true, supportFetchAPI: true },
}])

const isDevelopment = !app.isPackaged
const webRuntimeAcceptance = process.argv.includes('--phase6e4b-web-runtime-acceptance') && process.env.WEBTOOLS_WEB_RUNTIME_ACCEPTANCE === '1'
if (webRuntimeAcceptance) {
  const debugPort = Number(process.env.WEBTOOLS_WEB_RUNTIME_TEST_DEBUG_PORT)
  if (Number.isInteger(debugPort) && debugPort >= 1024 && debugPort <= 65535) app.commandLine.appendSwitch('remote-debugging-port', String(debugPort))
}
const nativeManaged = !webRuntimeAcceptance && (app.isPackaged || isNativeManagerOnly(process.argv, process.env))
const nativePipeName = process.env.WEBTOOLS_NATIVE_PIPE ?? 'WebTools.NativeHost.Manager.v1'
const managerDirectory = dirname(process.execPath)
const managerTestInstallRoot = app.isPackaged
  ? basename(managerDirectory).toLowerCase() === 'manager' ? dirname(managerDirectory) : managerDirectory
  : undefined
const webRuntimeAcceptanceOptions = resolveWebRuntimeAcceptanceOptions(process.argv, process.env, {
  userProfilePath: join(app.getPath('appData'), 'Nook'),
  installRoot: managerTestInstallRoot,
})
if (isDevelopment) app.setName('webtools-desktop-dev')

// Keep the established profile path: the Native Host migration and Manager share it.
const appDataPath = app.getPath('appData')
app.setPath('userData', resolveManagerTestProfile(process.argv, process.env, {
  userProfilePath: join(appDataPath, 'Nook'),
  installRoot: managerTestInstallRoot,
}) ?? webRuntimeAcceptanceOptions?.profilePath ?? join(appDataPath, isDevelopment ? 'WebTools-Dev' : 'Nook'))

let dataStore: DataStore
let secretStore: SecretStore
let managerWindow: BrowserWindow | null = null
let translationService: TranslationService | null = null
let builtinTranslationLifecycle: BuiltinTranslationLifecycle | null = null
let builtinTranslationHandoff: BuiltinTranslationHandoff | null = null
let cancelAIConnectionTests: () => void = () => undefined
let nativeManagerClient: NativeManagerClient | null = null
let nativeLauncherState: NativeLauncherState | null = null
let managerRendererReady = false
let quitting = false
let pluginManager: PluginManager | null = null
let pluginCatalog: PluginCatalog | null = null
let featureRegistry: FeatureRegistry | null = null
let featureInvocationService: FeatureInvocationService | null = null
let nativePluginProjectionPublisher: NativePluginProjectionPublisher | null = null
let nativeFeatureProjectionPublisher: NativeFeatureProjectionPublisher | null = null
let webPluginRuntime: WebPluginRuntime | null = null
let managerCloseStarted = false
let runtimeQuitPrepared = false
let webRuntimeAcceptanceStarted = false
let disposeCatalogHandlers = () => {}
let disposePluginHandlers: () => void = () => undefined
let disposeBuiltinTranslationHandoffHandlers: () => void = () => undefined
let disposeFeatureManagerSubscription: () => void = () => undefined
let disposeBuiltinFeatureSubscription: () => void = () => undefined

interface PendingNativeIntent {
  requestId: string
  intent: { kind: 'open-page'; section: 'favorites' | 'entries' | 'settings' }
    | { kind: 'open-plugin'; ref: PluginRef }
    | { kind: 'open-feature'; ref: FeatureRef }
  resolve: () => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
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

async function syncNativePluginProjection(): Promise<void> {
  // This is a recoverable derived presentation cache, not the plugin authority.
  // Retry on the next explicit catalog read/mutation or Manager startup.
  await nativePluginProjectionPublisher?.trySync(() => console.warn('[native-plugins] Launcher cache synchronization failed; catalog remains available.'))
}

async function syncNativeFeatureProjection(): Promise<void> {
  if (!nativeManagerClient?.supportsFeatureProjectionV2) return
  await nativeFeatureProjectionPublisher?.trySync(() => console.warn('[native-features] Feature Projection v2 synchronization failed; Native keeps its last-known-good cache.'))
}

async function refreshFeatureRegistry(): Promise<void> {
  try {
    await featureRegistry?.refresh()
    await syncNativeFeatureProjection()
  }
  catch (error) { console.warn('[native-features] derived Feature projection refresh failed.', error) }
}

async function updateNativeLauncherSettings(update: NativeLauncherSettingsUpdate) {
  if (!nativeManagerClient?.isConnected) throw new Error('Native Host is not connected; Launcher settings were not saved.')
  const result = await nativeManagerClient.request<unknown>('launcher-settings-update', update)
  nativeLauncherState = parseNativeLauncherState(result)
  return currentSettings()
}

function deliverPendingNativeIntent(): void {
  const window = managerWindow
  if (!managerRendererReady || !window || window.isDestroyed() || window.webContents.isDestroyed()) return
  const pending = pendingNativeIntent
  const handoff = builtinTranslationHandoff?.claimNativeDelivery()
  if (!pending && !handoff) return
  window.show()
  window.focus()
  if (pending) window.webContents.send(IPC_CHANNELS.nativeManagerIntent, { requestId: pending.requestId, ...pending.intent })
  if (handoff) window.webContents.send(IPC_CHANNELS.nativeManagerIntent, { requestId: handoff.requestId, kind: 'translation-handoff' })
}

function waitForNativeIntentAcknowledgement(
  requestId: string,
  intent: PendingNativeIntent['intent'],
): Promise<void> {
  cancelPendingNativeIntent('INTENT_SUPERSEDED', 'A newer Manager request replaced this one.')
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingNativeIntent?.requestId === requestId) cancelPendingNativeIntent('INTENT_TIMEOUT', 'Manager did not complete the requested navigation in time.')
    }, 40_000)
    timer.unref?.()
    pendingNativeIntent = { requestId, intent, resolve, reject, timer }
    deliverPendingNativeIntent()
  })
}

function cancelPendingNativeIntent(code: string, message: string): void {
  const pending = pendingNativeIntent
  if (!pending) return
  pendingNativeIntent = null
  clearTimeout(pending.timer)
  pending.reject(new NativeManagerRequestError(code, message))
}

async function beginNativeFeaturePageIntent(requestId: string, ref: FeatureRef): Promise<void> {
  builtinTranslationHandoff?.supersede()
  const presented = waitForNativeIntentAcknowledgement(requestId, { kind: 'open-feature', ref: { ...ref } })
  showManager()
  await presented
}

async function handleNativeManagerCommand(message: NativeManagerEnvelope): Promise<void | (() => void) | ReturnType<typeof nativeManagerReply>> {
  const command = parseNativeManagerCommand(message)
  if (command.kind === 'shutdown-manager') {
    return () => {
      quitting = true
      app.quit()
    }
  }
  if (command.kind === 'open-page') {
    if (command.section === 'translate') {
      await beginNativeTranslationHandoff(command.requestId, null)
      return
    }
    builtinTranslationHandoff?.supersede()
    showManager()
    await waitForNativeIntentAcknowledgement(command.requestId, { kind: 'open-page', section: command.section })
    return
  }
  if (command.kind === 'open-plugin') {
    const catalog = pluginCatalog
    if (!catalog) throw new NativeManagerRequestError('MANAGER_NOT_READY', 'Plugin catalog is unavailable.')
    await catalog.open(command.ref, catalog.session) // Cached Native shortcuts never authorize opening a plugin.
    if (command.ref.kind === 'builtin') { await beginNativeTranslationHandoff(command.requestId, null); return }
    builtinTranslationHandoff?.supersede()
    showManager()
    await waitForNativeIntentAcknowledgement(command.requestId, { kind: 'open-plugin', ref: command.ref })
    return
  }
  if (command.kind === 'feature-invoke') {
    const service = featureInvocationService
    if (!service) return nativeManagerReply({ requestId: command.request.requestId, status: 'failed', reasonCode: 'dispatch-failed' })
    return nativeManagerReply(await service.invoke(command.request))
  }
  if (!isValidTranslationText(command.text)) throw new NativeManagerRequestError('INVALID_TRANSLATION_TEXT', '翻译内容为空或超过 20,000 个字符。')
  await beginNativeTranslationHandoff(command.requestId, command.text)
}

async function beginNativeTranslationHandoff(requestId: string, text: string | null): Promise<void> {
  cancelPendingNativeIntent('INTENT_SUPERSEDED', 'A newer Manager request replaced this one.')
  const handoff = builtinTranslationHandoff
  if (!handoff) throw new NativeManagerRequestError('MANAGER_NOT_READY', 'Manager translation handoff is unavailable.')
  const presented = handoff.begin({ requestId, text })
  showManager()
  deliverPendingNativeIntent()
  try { await presented }
  catch (error) {
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'HANDOFF_FAILED'
    const message = code === 'INTENT_SUPERSEDED' ? 'A newer Manager request replaced this one.' : 'Manager did not present the Translation request.'
    throw new NativeManagerRequestError(code, message)
  }
}

function acknowledgeNativeManagerIntent(context: { sender: object; senderFrame: object | null }, requestId: unknown, outcome: unknown): void {
  if (!isCurrentWindowMainFrame(context, managerWindow) || typeof requestId !== 'string'
    || outcome !== undefined && outcome !== 'accepted' && outcome !== 'rejected') return
  const pending = pendingNativeIntent
  if (!pending || pending.requestId !== requestId) return
  pendingNativeIntent = null
  clearTimeout(pending.timer)
  if (outcome === 'rejected') pending.reject(new NativeManagerRequestError('FEATURE_UNAVAILABLE', 'The requested feature is no longer available.'))
  else pending.resolve()
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
  managerCloseStarted = false
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
    void webPluginRuntime?.close()
    builtinTranslationHandoff?.rendererStarting()
    builtinTranslationLifecycle?.invalidateSession()
    cancelActiveAIRequests()
    pluginManager?.beginSession()
    pluginCatalog?.beginSession()
    void pluginManager?.restoreSession().catch(error => console.warn('[plugins] Manager session restore failed.', error))
    if (nativeManaged && nativeManagerClient?.isConnected) {
      void nativeManagerClient.request('manager-renderer-not-ready', {}).catch((error) => console.error('[native-manager] renderer-not-ready failed', error))
    }
  })
  window.on('closed', () => {
    if (managerWindow !== window) return
    cancelActiveAIRequests()
    builtinTranslationLifecycle?.close()
    builtinTranslationHandoff?.close()
    pluginManager?.close()
    pluginCatalog?.close()
    managerWindow = null
    managerRendererReady = false
    cancelPendingNativeIntent('MANAGER_CLOSED', 'Manager window closed before acknowledging the current request.')
    if (!quitting) {
      quitting = true
      app.quit()
    }
  })
  window.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    if (managerCloseStarted) return
    managerCloseStarted = true
    void (async () => {
      await webPluginRuntime?.close()
      if (!window.isDestroyed()) window.destroy()
    })()
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
  if (webRuntimeAcceptance && !webRuntimeAcceptanceStarted) {
    webRuntimeAcceptanceStarted = true
    void startWebRuntimeAcceptanceFixture()
  }
  builtinTranslationHandoff?.rendererReady()
  if (!nativeManaged || !nativeManagerClient?.isConnected) { deliverPendingNativeIntent(); return }
  void nativeManagerClient.request('manager-renderer-ready', {}).then(() => deliverPendingNativeIntent()).catch((error) => {
    console.error('[native-manager] renderer-ready acknowledgement failed', error)
    app.quit()
  })
}

async function startWebRuntimeAcceptanceFixture(): Promise<void> {
  const options = webRuntimeAcceptanceOptions
  const runtime = webPluginRuntime
  if (!options || !runtime) return
  try {
    const bytes = await readFile(options.packagePath)
    const snapshot = await validateWebPackageForRuntime(bytes, app.getVersion())
    const expectedFeature = snapshot.manifest.features.find(feature => feature.id === 'offline-demo')
    const expectedSwitchFeature = snapshot.manifest.features.find(feature => feature.id === 'offline-demo-wasm')
    const delayedFeature = snapshot.manifest.features.find(feature => feature.id === 'offline-demo-delayed')
    if (snapshot.manifest.id !== 'org.webtools.phase6e4b.runtime-test' || snapshot.manifest.version !== '1.0.0'
      || !expectedFeature || !expectedSwitchFeature || !delayedFeature || snapshot.manifest.network.mode !== 'none') {
      throw new Error('The supplied package is not the fixed offline Web Runtime acceptance fixture.')
    }
    if (process.env.WEBTOOLS_WEB_RUNTIME_TEST_MUTATE_ARCHIVE === '1') {
      await unlink(options.packagePath)
      bytes.fill(0)
      console.log('[web-runtime-acceptance] validated snapshot survived source archive deletion and buffer mutation')
    }
    const scenario = process.env.WEBTOOLS_WEB_RUNTIME_TEST_SCENARIO
    if (scenario === 'renderer-crash') {
      const unsubscribe = runtime.subscribe(status => {
        if (status.state !== 'FAULTED') return
        unsubscribe()
        // The acceptance driver explicitly reinvokes; production never restarts plugin code automatically.
        void runtime.open(snapshot, expectedFeature.id).then(recovered => {
          if (recovered.state === 'READY' && recovered.generation > status.generation) {
            console.log('[web-runtime-acceptance] crash-reopen=PASS')
          }
        }).catch(error => console.error('[web-runtime-acceptance] crash-reopen=failed', error.message))
      })
    }
    if (scenario === 'switch-while-loading') {
      const firstOpen = runtime.open(snapshot, delayedFeature.id)
      await waitForWebRuntimeAcceptanceState(runtime, 'LOADING')
      const replacementOpen = runtime.open(snapshot, expectedSwitchFeature.id)
      const [firstResult, replacementResult] = await Promise.allSettled([firstOpen, replacementOpen])
      if (firstResult.status !== 'rejected' || replacementResult.status !== 'fulfilled'
        || replacementResult.value.state !== 'READY' || replacementResult.value.featureId !== expectedSwitchFeature.id) {
        throw new Error('Loading Feature replacement did not revoke the old generation and reach the replacement Feature.')
      }
      console.log(`[web-runtime-acceptance] loading-switch=PASS oldLoadRejected=true activeFeature=${expectedSwitchFeature.id}`)
      return
    }

    const initialFeature = scenario === 'close-while-loading' ? delayedFeature : expectedFeature
    console.log(`[web-runtime-acceptance] opening initial offline Feature scenario=${scenario ?? 'standard'}`)
    const initialStatus = await runtime.open(snapshot, initialFeature.id)
    if (process.env.WEBTOOLS_WEB_RUNTIME_TEST_SWITCH === '1') {
      console.log('[web-runtime-acceptance] initial Feature ready; opening switch Feature')
      const switchedStatus = await runtime.open(snapshot, expectedSwitchFeature.id)
      if (switchedStatus.state !== 'READY' || switchedStatus.featureId !== expectedSwitchFeature.id
        || switchedStatus.generation === initialStatus.generation) {
        throw new Error('Controlled Feature switch did not replace the active runtime generation.')
      }
      console.log(`[web-runtime-acceptance] switched Feature ready generation=${initialStatus.generation}->${switchedStatus.generation}`)
    }
  } catch (error) {
    console.error('[web-runtime-acceptance] controlled fixture could not be opened:', error instanceof Error ? error.message : 'unknown error')
  }
}

function waitForWebRuntimeAcceptanceState(runtime: WebPluginRuntime, state: 'LOADING', timeoutMs = 10_000): Promise<void> {
  if (runtime.status.state === state) return Promise.resolve()
  return new Promise((resolve, reject) => {
    let unsubscribe: () => void = () => undefined
    const timer = setTimeout(() => { unsubscribe(); reject(new Error(`Timed out waiting for Web Runtime ${state} state.`)) }, timeoutMs)
    timer.unref?.()
    unsubscribe = runtime.subscribe(status => {
      if (status.state !== state) return
      clearTimeout(timer)
      unsubscribe()
      resolve()
    })
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
      featureInvocationService?.clearSession()
      cancelPendingNativeIntent('MANAGER_DISCONNECTED', 'Native Host disconnected during the Feature request.')
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

  webPluginRuntime = new WebPluginRuntime(() => managerWindow)
  webPluginRuntime.subscribe(status => {
    if (webRuntimeAcceptance) console.log(`[web-runtime-acceptance] state=${status.state} generation=${status.generation} feature=${status.featureId ?? ''}`)
    const window = managerWindow
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.webRuntimeState, status)
    }
  })
  ipcMain.on(IPC_CHANNELS.webRuntimeSetBounds, (event, value: unknown) => {
    if (!isCurrentWindowMainFrame(event, managerWindow) || !value || typeof value !== 'object') return
    const bounds = value as Record<string, unknown>
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(item => typeof item === 'number' && Number.isFinite(item))) return
    const rect = { x: bounds.x as number, y: bounds.y as number, width: bounds.width as number, height: bounds.height as number }
    if (rect.x < 0 || rect.y < 0 || rect.x > 4000 || rect.y > 4000 || rect.width < 1 || rect.height < 1 || rect.width > 8000 || rect.height > 8000) return
    webPluginRuntime?.setBounds(rect)
  })
  ipcMain.on(IPC_CHANNELS.webRuntimeClose, (event, generation: unknown) => {
    if (!isCurrentWindowMainFrame(event, managerWindow)) return
    if (typeof generation !== 'number' || !Number.isSafeInteger(generation)
      || webPluginRuntime?.status.generation !== generation) return
    void webPluginRuntime?.close()
  })

  const aiCredentials = new AIProviderCredentialStore(secretStore)
  const sharedAIService = new SharedAIService({
    dataStore,
    credentials: aiCredentials,
    openAICompatibleAdapter: new OpenAICompatibleAdapter(),
    anthropicAdapter: new AnthropicMessagesAdapter(),
  })
  builtinTranslationLifecycle = new BuiltinTranslationLifecycle(
    new BuiltinPluginStateStore(app.getPath('userData')),
    () => translationService?.cancelAll(),
  )
  await builtinTranslationLifecycle.initialize()
  builtinTranslationHandoff = new BuiltinTranslationHandoff(builtinTranslationLifecycle)
  translationService = new TranslationService({
    dataStore,
    sharedAI: sharedAIService,
    aiCredentials,
    myMemoryAdapter: new MyMemoryAdapter(),
    qwenMtAdapter: new QwenMtAdapter(),
    translationAdmission: {
      captureGeneration: () => builtinTranslationLifecycle?.isEnabled() ? builtinTranslationLifecycle.generation : null,
      isGenerationCurrent: generation => builtinTranslationLifecycle?.isGenerationCurrent(generation) ?? false,
    },
  })
  const pluginHost = createElectronPluginHost({ userData: app.getPath('userData'), hostVersion: app.getVersion(), sharedAI: sharedAIService, dataStore, getWindow: () => managerWindow })
  try { await pluginHost.manager.initialize(); pluginManager = pluginHost.manager }
  catch { pluginHost.manager.close() } // Fail closed without preventing existing Manager pages from opening.
  featureRegistry = new FeatureRegistry({
    listDeclarativeFeatures: () => pluginManager?.listFeatureCandidates() ?? Promise.resolve([]),
    isTranslationEnabled: () => builtinTranslationLifecycle?.isEnabled() ?? false,
  })
  if (pluginManager) {
    disposeFeatureManagerSubscription = pluginManager.subscribeFeatureAuthorityChanged(() => { void refreshFeatureRegistry() })
  }
  if (builtinTranslationLifecycle) {
    disposeBuiltinFeatureSubscription = builtinTranslationLifecycle.subscribeFeatureStateChanged(() => { void refreshFeatureRegistry() })
  }
  await refreshFeatureRegistry()
  pluginCatalog = new PluginCatalog(app.getVersion(), () => pluginManager, builtinTranslationLifecycle)
  featureInvocationService = new FeatureInvocationService({
    isConnected: () => nativeManagerClient?.isConnected === true,
    isTranslationEnabled: () => builtinTranslationLifecycle?.isEnabled() ?? false,
    authorizeDeclarative: (ref, dispatch) => {
      const manager = pluginManager
      if (!manager) {
        const error = new NativeManagerRequestError('FEATURE_UNAVAILABLE', 'The Plugin manager is unavailable.')
        return Promise.reject(error)
      }
      return manager.authorizeAndDispatchFeature(ref, manager.session, dispatch)
    },
    openDeclarative: (requestId, feature: DeclarativeCompatibilityFeature) => beginNativeFeaturePageIntent(requestId, feature.ref),
    openTranslation: requestId => beginNativeTranslationHandoff(requestId, null),
  })
  if (nativeManaged) {
    nativePluginProjectionPublisher = new NativePluginProjectionPublisher(async () => {
      const catalog = pluginCatalog
      if (!catalog) throw new Error('Plugin catalog is unavailable.')
      return catalog.launcherProjection(catalog.session)
    }, async projection => {
      if (!nativeManagerClient?.isConnected) throw new Error('Native Host is disconnected.')
      return nativeManagerClient.request('plugins-update', projection)
    })
    await syncNativePluginProjection()
    if (nativeManagerClient?.supportsFeatureProjectionV2) {
      nativeFeatureProjectionPublisher = new NativeFeatureProjectionPublisher(
        async () => {
          const registry = featureRegistry
          if (!registry) throw new Error('Feature registry is unavailable.')
          return registry.snapshot()
        },
        async (_projection, serialized) => {
          const client = nativeManagerClient
          if (!client?.supportsFeatureProjectionV2) throw new Error('Native Host did not negotiate Feature Projection v2.')
          return client.request('features-update', JSON.parse(serialized) as unknown)
        },
      )
      await syncNativeFeatureProjection()
    }
  }
  disposeCatalogHandlers = registerPluginCatalogIpcHandlers(ipcMain, {
    getCatalog: () => pluginCatalog,
    onCatalogChanged: syncNativePluginProjection,
    isManagerMainFrame: context => isCurrentWindowMainFrame(context, managerWindow),
    confirmBuiltinStateRecovery: async () => {
      const window = managerWindow
      if (!window || window.isDestroyed()) return false
      const result = await dialog.showMessageBox(window, {
        type: 'warning',
        title: '恢复内置翻译状态',
        message: 'WebTools 将先备份无法读取的状态文件，再恢复翻译为启用状态。',
        detail: '原文件会保留在内置插件状态目录中。此操作不会修改翻译设置、AI 密钥或第三方插件数据。',
        buttons: ['备份并恢复', '取消'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      })
      return result.response === 0
    },
  })
  disposeBuiltinTranslationHandoffHandlers = registerBuiltinTranslationHandoffHandlers(ipcMain, {
    getHandoff: () => builtinTranslationHandoff,
    onCatalogChanged: syncNativePluginProjection,
    isManagerMainFrame: context => isCurrentWindowMainFrame(context, managerWindow),
  })
  disposePluginHandlers = registerPluginIpcHandlers(ipcMain, {
    getManager: () => pluginManager,
    onCatalogChanged: syncNativePluginProjection,
    isManagerMainFrame: context => isCurrentWindowMainFrame(context, managerWindow),
    choosePackage: pluginHost.choosePackage,
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
  cancelAIConnectionTests = registerTranslationIpcHandlers(ipcMain, {
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

app.on('before-quit', event => {
  if (webPluginRuntime && !runtimeQuitPrepared) {
    event.preventDefault()
    runtimeQuitPrepared = true
    void webPluginRuntime.close().finally(() => app.quit())
    return
  }
  quitting = true
  cancelActiveAIRequests()
  disposeFeatureManagerSubscription()
  disposeBuiltinFeatureSubscription()
  featureRegistry?.close()
  featureRegistry = null
  builtinTranslationLifecycle?.close()
  pluginManager?.close()
  disposePluginHandlers()
  disposeBuiltinTranslationHandoffHandlers()
  pluginCatalog?.close()
  disposeCatalogHandlers()
  nativeManagerClient?.close()
  nativePluginProjectionPublisher?.close()
  nativeFeatureProjectionPublisher?.close()
  webPluginRuntime = null
  nativeManagerClient = null
})
