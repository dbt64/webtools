import { app, BrowserWindow, dialog, ipcMain, nativeTheme, protocol, session, utilityProcess, WebContentsView, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
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
import { Translation2SettingsService } from './services/translation2-settings.ts'
import { Translation2AIConfiguration } from './services/translation2-ai-configuration.ts'
import { Translation2ImportedApiExecutor } from './services/translation2-imported-api.ts'
import { Translation2ImportedServiceManager } from './services/translation2-imported-services.ts'
import { BuiltinTranslationPreview } from './services/builtin-translation-preview'
import { BuiltinPluginStateStore } from './plugins/builtin-plugin-state'
import { BuiltinTranslationLifecycle } from './plugins/builtin-translation-lifecycle'
import { openExternalUrl } from './services/external-opener'
import { BookmarkService } from './services/bookmark-service'
import { WebsiteService } from './services/website-service'
import { WebsiteMetadataService } from './services/website-metadata'
import { EverythingClient } from './services/everything-client'
import { isValidTranslationText } from './services/translation-prefill'
import { bindWindowStartupTrace, currentWindowRequest, loadWindowShell, presentWindow, traceWindowStartup, withWindowRequest } from './services/window-startup.ts'
import { registerWindowIpcHandlers } from './ipc/window-handlers'
import { registerWebsiteIpcHandlers } from './ipc/website-handlers'
import { registerSettingsIpcHandlers } from './ipc/settings-handlers'
import { registerTranslationIpcHandlers } from './ipc/translation-handlers'
import { registerEverythingIpcHandlers } from './ipc/everything-handlers'
import { isCurrentWindowMainFrame, registerManagerEventHandlers, registerManagerInvokeHandlers } from './ipc/window-security.ts'
import { isNativeManagerOnly } from './services/native-manager-mode'
import { NativeManagerClient, nativeManagerReply, parseNativeLauncherState, type NativeLauncherSettingsUpdate, type NativeLauncherState } from './services/native-manager-client'
import { NativeManagerRequestError, type NativeManagerEnvelope } from './services/native-manager-protocol'
import { ElectronHostOwnership, type HostOwnershipSnapshot } from './services/electron-host-ownership.ts'
import { parseNativeManagerCommand } from './services/native-manager-commands'
import { FeatureInvocationService } from './services/feature-invocation-service'
import { overlayNativeLauncherSettings, projectWebsitesForNative } from './services/native-launcher-settings'
import { resolveManagerTestProfile } from './services/manager-test-options'
import { createElectronPluginHost } from './plugins/electron-plugin-host'
import { registerPluginIpcHandlers } from './ipc/plugin-handlers'
import { registerPluginCatalogIpcHandlers } from './ipc/plugin-catalog-handlers'
import { PluginCatalog } from './plugins/plugin-catalog'
import { FeatureRegistry } from './plugins/feature-registry'
import { NativePluginProjectionPublisher } from './services/native-plugin-projection-publisher'
import { NativeFeatureProjectionPublisher } from './services/native-feature-projection-publisher'
import type { PluginRef } from '../src/shared/plugin-catalog-contracts'
import type { PluginManager } from './plugins/plugin-manager'
import type { DeclarativeCompatibilityFeature } from './plugins/feature-contracts'
import type { FeatureRef, FeatureProjectionV2 } from '../src/shared/feature-contracts'
import type { FeatureActivationOutcome } from './services/feature-activation.ts'
import { FeatureQuickResultConsent } from './services/feature-quick-result-consent.ts'
import { WebPluginRuntime } from './plugins/web-plugin-runtime.ts'
import type { WebCapabilityEffects } from './plugins/web-host-capabilities.ts'
import { createPluginRuntimeAcceptanceHostOverrides } from './services/plugin-runtime-acceptance.ts'
import { resolvePluginRuntimeAcceptanceOptions } from './services/plugin-runtime-acceptance-options.ts'
import { PluginDevelopment } from './plugins/plugin-development.ts'
import { PluginRuntimeDiagnostics } from './plugins/plugin-runtime-diagnostics.ts'
import { registerPluginDevelopmentHandlers } from './ipc/plugin-development-handlers.ts'
import { PluginWindowManager } from './plugins/plugin-window-manager.ts'
import { PLUGIN_WINDOW_CHROME_CHANNELS } from './plugins/plugin-window-chrome-contract.ts'
import { pluginRuntimeSession } from './plugins/plugin-runtime-session.ts'
import { BuiltinTranslationWindow } from './plugins/builtin-translation-window.ts'
import { Translation2WebsiteHost, isAllowedTranslationWebsiteUrl } from './plugins/translation2-website-host.ts'
import { TRANSLATION2_IPC_CHANNELS } from '../src/shared/translation2-ipc.ts'
import type { Translation2WebsiteProviderId } from '../src/shared/translation2-contracts.ts'
import { PluginThemeController } from './plugins/plugin-theme-controller.ts'
import { FeatureActivationService, FeaturePresentationRouter } from './services/feature-activation.ts'
import { NodeCommandExecutionAdapter } from './plugins/node-command-execution.ts'
import { registerTranslation2Handlers } from './ipc/translation2-handlers.ts'
import { parseSuperPanelSettingsStatus, type SuperPanelSettings } from '../src/shared/super-panel-settings.ts'

traceWindowStartup('electron-main-entry')
protocol.registerSchemesAsPrivileged([{
  scheme: 'webtools-plugin',
  privileges: { standard: true, secure: true, supportFetchAPI: true, allowServiceWorkers: true, corsEnabled: true, stream: true },
}])

const isDevelopment = !app.isPackaged
const pluginRuntimeAcceptanceRequested = process.argv.includes('--plugin-runtime-acceptance')
  && process.env.WEBTOOLS_PLUGIN_RUNTIME_ACCEPTANCE === '1'
const pluginRuntimeAcceptanceStandalone = pluginRuntimeAcceptanceRequested
  && process.env.WEBTOOLS_PLUGIN_RUNTIME_STANDALONE === '1'
if (pluginRuntimeAcceptanceRequested) {
  const debugPort = Number(process.env.WEBTOOLS_PLUGIN_RUNTIME_TEST_DEBUG_PORT)
  if (Number.isInteger(debugPort) && debugPort >= 1024 && debugPort <= 65535) app.commandLine.appendSwitch('remote-debugging-port', String(debugPort))
}
const nativeManaged = !pluginRuntimeAcceptanceStandalone
  && (app.isPackaged || isNativeManagerOnly(process.argv, process.env))
const hostOwnership = new ElectronHostOwnership()
const nativeHostProcessId = Number(process.env.WEBTOOLS_NATIVE_HOST_PID)
const nativePipeName = process.env.WEBTOOLS_NATIVE_PIPE ?? 'WebTools.NativeHost.Manager.v1'
const nativePipeAuthenticationToken = process.env.WEBTOOLS_NATIVE_PIPE_TOKEN
const managerDirectory = dirname(process.execPath)
const managerTestInstallRoot = app.isPackaged
  ? basename(managerDirectory).toLowerCase() === 'manager' ? dirname(managerDirectory) : managerDirectory
  : undefined
const pluginRuntimeAcceptanceOptions = resolvePluginRuntimeAcceptanceOptions(process.argv, process.env, {
  packaged: app.isPackaged, executable: process.execPath,
  userProfilePath: join(app.getPath('appData'), 'Nook'), installRoot: managerTestInstallRoot,
})
if (isDevelopment) app.setName('webtools-desktop-dev')

// Keep the established profile path: the Native Host migration and Manager share it.
const appDataPath = app.getPath('appData')
app.setPath('userData', resolveManagerTestProfile(process.argv, process.env, {
  userProfilePath: join(appDataPath, 'Nook'),
  installRoot: managerTestInstallRoot,
}) ?? pluginRuntimeAcceptanceOptions?.profilePath ?? join(appDataPath, isDevelopment ? 'WebTools-Dev' : 'Nook'))
if (pluginRuntimeAcceptanceOptions
  && realpathSync.native(app.getPath('userData')).toLowerCase() !== pluginRuntimeAcceptanceOptions.profilePath.toLowerCase()) {
  throw new Error('Plugin Runtime acceptance failed to isolate Electron userData.')
}
delete process.env.WEBTOOLS_NATIVE_PIPE
delete process.env.WEBTOOLS_NATIVE_PIPE_TOKEN

let dataStore: DataStore
let secretStore: SecretStore
let managerWindow: BrowserWindow | null = null
let translationService: TranslationService | null = null
let translation2Settings: Translation2SettingsService | null = null
let translationWindow: BuiltinTranslationWindow | null = null
let translationWebsiteHost: Translation2WebsiteHost | null = null
let translationPreview: BuiltinTranslationPreview | null = null
let builtinTranslationLifecycle: BuiltinTranslationLifecycle | null = null
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
let pluginWindows: PluginWindowManager | null = null
let pluginTheme: PluginThemeController | null = null
let featureActivation: FeatureActivationService | null = null
let pluginCommands: NodeCommandExecutionAdapter | null = null
let commandCapabilityEffects: Omit<WebCapabilityEffects, 'hasForegroundGesture'> | null = null
let effectsForWindow: ((getWindow: () => BrowserWindow | null) => Omit<WebCapabilityEffects, 'hasForegroundGesture'>) | null = null
let electronHostReady = false
let activationInFlight = 0
let hasPresentedTarget = false
let reconnectingNativeHost: Promise<void> | null = null
let pluginDevelopment: PluginDevelopment | null = null
let lastDevelopmentProjection: FeatureProjectionV2 | null = null
let lastDevelopmentProjectionKey = ''
let featureQuickResultConsent: FeatureQuickResultConsent | null = null
let disposePluginDevelopmentHandlers = () => {}
let disposePluginDevelopmentSubscriptions = () => {}
let webCapabilityEffects: Omit<WebCapabilityEffects, 'hasForegroundGesture'> | null = null
let managerClosing: Promise<void> | null = null
let runtimeQuitPrepared = false
let disposeCatalogHandlers = () => {}
let disposePluginHandlers: () => void = () => undefined
let disposeVersionIpcHandlers: () => void = () => undefined
let disposeWebRuntimeIpcHandlers: () => void = () => undefined
let disposeTranslation2Handlers: () => void = () => undefined
let disposeFeatureManagerSubscription: () => void = () => undefined
let disposeBuiltinFeatureSubscription: () => void = () => undefined

interface PendingNativeIntent {
  requestId: string
  intent: { kind: 'open-page'; section: 'favorites' | 'entries' | 'settings'; settingsSection?: 'super-panel' }
    | { kind: 'open-plugin'; ref: PluginRef }
    | { kind: 'select-plugin'; ref: PluginRef; section?: 'about' | 'settings' }
    | { kind: 'open-feature'; ref: FeatureRef }
  resolve: () => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

let pendingNativeIntent: PendingNativeIntent | null = null

function cancelActiveAIRequests(revokeDisplayedPreview = false): void {
  translationPreview?.invalidate()
  // Normal Host idle exit leaves accepted inert Native text intact.
  // Configuration changes additionally revoke the already displayed preview.
  if (revokeDisplayedPreview) void featureInvocationService?.revalidateDisplayedResult().catch(() => {})
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

async function syncNativeDevelopmentProjection(): Promise<void> {
  if (quitting || !nativeManagerClient?.supportsQuickResult) return
  const projection = pluginDevelopment?.nativeProjection(nativeManagerClient.supportsSelectedTextMatching) ?? null
  const key = projection ? `${projection.hostSessionId}:${projection.revision}` : 'none'
  if (key === lastDevelopmentProjectionKey) return
  lastDevelopmentProjectionKey = key
  const outgoing = projection ?? (lastDevelopmentProjection ? { ...lastDevelopmentProjection, revision: lastDevelopmentProjection.revision + 1, features: [] } : null)
  const sourceId = lastDevelopmentProjection?.features[0]?.ref.pluginId ?? projection?.features[0]?.ref.pluginId
  lastDevelopmentProjection = projection
  if (sourceId) void nativeManagerClient.clearAcceptedQuickResultForSource(sourceId).catch(() => console.warn('[quick-result] Development source clear was not acknowledged.'))
  await featureInvocationService?.revalidateDisplayedResult()
  if (lastDevelopmentProjectionKey !== key) return
  if (outgoing) {
    try { await nativeManagerClient.request('feature-development-overlay-v1', outgoing, 5000) }
    catch { lastDevelopmentProjectionKey = ''; console.warn('[quick-result] Development overlay synchronization failed.') }
  }
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

async function requestSuperPanelSettings(type: 'super-panel-settings-get' | 'super-panel-settings-update', payload: SuperPanelSettings | Record<string, never>) {
  if (!nativeManagerClient?.supportsSuperPanelSettings) throw new NativeManagerRequestError('SUPER_PANEL_UNAVAILABLE', 'NativeHost 尚未连接或不支持 Super Panel 设置。')
  const status = parseSuperPanelSettingsStatus(await nativeManagerClient.request(type, payload, 10_000))
  if (!status) throw new NativeManagerRequestError('INVALID_SUPER_PANEL_STATE', 'NativeHost 返回了无效的 Super Panel 状态。')
  return status
}

function deliverPendingNativeIntent(): void {
  const window = managerWindow
  if (!managerRendererReady || !window || window.isDestroyed() || window.webContents.isDestroyed()) return
  const pending = pendingNativeIntent
  if (!pending) return
  if (pending) window.webContents.send(IPC_CHANNELS.nativeManagerIntent, { requestId: pending.requestId, ...pending.intent })
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
  const presented = waitForNativeIntentAcknowledgement(requestId, { kind: 'open-feature', ref: { ...ref } })
  showManager()
  await presented
  if (managerWindow) await presentPluginWindow(managerWindow)
}

async function openPluginManagerSection(ref: PluginRef, section: 'about' | 'settings'): Promise<void> {
  const requestId = randomUUID()
  const presented = waitForNativeIntentAcknowledgement(requestId, { kind: 'select-plugin', ref: { ...ref }, section })
  showManager()
  await presented
  if (managerWindow) await presentPluginWindow(managerWindow)
}

async function returnToNativeLauncher(): Promise<boolean> {
  const client = nativeManagerClient
  if (!client?.isConnected || !client.supportsLauncherFeatures || quitting) return false
  try { return (await client.request<{ shown: boolean }>('launcher-show-empty', {}, 5000)).shown === true }
  catch { console.warn('[plugin-window] Returning to Launcher was not acknowledged.'); return false }
}

function bindTranslationEscape(contents: WebContents): void {
  contents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && !input.isAutoRepeat
      && !input.control && !input.meta && !input.alt && !input.shift) {
      event.preventDefault(); closeTranslationSurface()
    }
  })
}

function closeTranslationSurface(): void {
  builtinTranslationLifecycle?.closeWindow()
  void translationWindow?.close()
}

async function handleNativeManagerCommand(message: NativeManagerEnvelope): Promise<void | (() => void) | ReturnType<typeof nativeManagerReply>> {
  if (message.type === 'host-ownership-sync') {
    if (quitting) throw new NativeManagerRequestError('HOST_CLOSING', 'Electron Host is closing.')
    hostOwnership.replace(message.payload)
    traceWindowStartup('ownership-snapshot-synchronized')
    return nativeManagerReply({ exiting: canQuitIdleElectronHost() }, maybeQuitIdleElectronHost)
  }
  if (['open-page', 'open-plugin', 'translation-prefill', 'feature-invoke'].includes(message.type)) {
    const command = parseNativeManagerCommand(message)
    const requestId = command.kind === 'feature-invoke' ? command.request.requestId : 'requestId' in command ? command.requestId : ''
    if (quitting) throw new NativeManagerRequestError('HOST_CLOSING', 'Electron Host is closing.')
    let executed = false
    const context: NonNullable<ReturnType<typeof currentWindowRequest>> = { requestId,
      entry: command.kind === 'feature-invoke' ? command.request.source : 'launcher',
      pluginId: command.kind === 'feature-invoke' ? command.request.ref.pluginId : message.type === 'translation-prefill' ? 'webtools.translation' : 'manager',
      startup: hasPresentedTarget ? 'warm' : 'cold' }
    const outcome = await hostOwnership.execute(requestId, async () => {
      executed = true
      activationInFlight++
      try {
        const reply = await withWindowRequest(context, () => { traceWindowStartup('target-request-received'); return executeNativeManagerCommand(message) })
        return { reply, presented: context.presented }
      } finally { hasPresentedTarget = true; activationInFlight--; maybeQuitIdleElectronHost() }
    })
    if (!executed && outcome.presented && !outcome.presented.isDestroyed())
      await withWindowRequest(context, () => presentPluginWindow(outcome.presented!))
    return outcome.reply
  }
  return executeNativeManagerCommand(message)
}

async function executeNativeManagerCommand(message: NativeManagerEnvelope): Promise<void | (() => void) | ReturnType<typeof nativeManagerReply>> {
  if (message.type === 'feature-ai-decision-v1') {
    if (!nativeManagerClient?.supportsQuickResult || !featureQuickResultConsent?.decide(message.payload)) throw new NativeManagerRequestError('INVALID_NATIVE_COMMAND', 'The confirmation is no longer current.')
    return nativeManagerReply(null)
  }
  if (message.type === 'super-panel-settings-changed') {
    if (!nativeManagerClient?.supportsSuperPanelSettings || quitting) throw new NativeManagerRequestError('CAPABILITY_REQUIRED', 'Super Panel settings are unavailable.')
    const status = parseSuperPanelSettingsStatus(message.payload)
    if (!status) throw new NativeManagerRequestError('INVALID_SUPER_PANEL_STATE', 'Native Host returned invalid Super Panel settings.')
    translationPreview?.invalidate()
    void featureInvocationService?.revalidateDisplayedResult().catch(() => {})
    managerWindow?.webContents.send(IPC_CHANNELS.superPanelChanged, status)
    return
  }
  const command = parseNativeManagerCommand(message)
  if (command.kind === 'feature-result-cancel') {
    if (!nativeManagerClient?.supportsQuickResult) throw new NativeManagerRequestError('CAPABILITY_REQUIRED', 'Quick Result is unavailable.')
    featureInvocationService?.cancel(command.binding.requestId, command.binding.ref)
    return nativeManagerReply(null)
  }
  if (quitting && command.kind !== 'shutdown-manager') throw new NativeManagerRequestError('HOST_CLOSING', 'Electron Host is closing before accepting this request.')
  if (command.kind === 'focus-current-temporary-window') {
    if (!nativeManagerClient?.supportsLauncherFeatures) throw new NativeManagerRequestError('CAPABILITY_REQUIRED', 'Launcher Features were not negotiated.')
    return nativeManagerReply({ focused: pluginWindows?.focusCurrentTemporaryWindow() ?? false })
  }
  if (command.kind === 'feature-queue-ownership') {
    throw new NativeManagerRequestError('UNSUPPORTED_COMMAND', 'Use the complete Host ownership snapshot.')
  }
  if (command.kind === 'shutdown-manager') {
    return () => {
      quitting = true
      app.quit()
    }
  }
  if (command.kind === 'open-page') {
    if (command.section === 'translate') {
      await openTranslation2Window(command.requestId, null)
      return
    }
    const presented = waitForNativeIntentAcknowledgement(command.requestId, { kind: 'open-page', section: command.section,
      ...(command.settingsSection ? { settingsSection: command.settingsSection } : {}) })
    showManager()
    await presented
    if (managerWindow) await presentPluginWindow(managerWindow)
    return
  }
  if (command.kind === 'open-plugin') {
    const catalog = pluginCatalog
    if (!catalog) throw new NativeManagerRequestError('MANAGER_NOT_READY', 'Plugin catalog is unavailable.')
    const opened = await catalog.open(command.ref, catalog.session) // Cached Native shortcuts never authorize opening a plugin.
    if (command.ref.kind === 'builtin') {
      if (opened.kind === 'builtin' && opened.presentation === 'window') return
      await openTranslation2Window(command.requestId, null)
      return
    }
    const presented = waitForNativeIntentAcknowledgement(command.requestId, { kind: 'open-plugin', ref: command.ref })
    showManager()
    await presented
    if (managerWindow) await presentPluginWindow(managerWindow)
    return
  }
  if (command.kind === 'feature-invoke') {
    if (command.request.source === 'super-panel' && !nativeManagerClient?.supportsSuperPanel)
      return nativeManagerReply({ requestId: command.request.requestId, status: 'rejected', reasonCode: 'unsupported-feature-kind' })
    const service = featureInvocationService
    if (!service) return nativeManagerReply({ requestId: command.request.requestId, status: 'failed', reasonCode: 'dispatch-failed' })
    traceWindowStartup('plugin-request-received')
    const result = await service.invoke(command.request)
      .catch(() => ({ requestId: command.request.requestId, status: 'failed', reasonCode: 'dispatch-failed' }))
    if (result.status === 'rejected') await refreshFeatureRegistry()
    return nativeManagerReply(result)
  }
  if (!isValidTranslationText(command.text)) throw new NativeManagerRequestError('INVALID_TRANSLATION_TEXT', '翻译内容为空或超过 20,000 个字符。')
  await openTranslation2Window(command.requestId, command.text, command.source ?? 'launcher', command.handoffRequestId)
}

async function presentPluginWindow(window: BrowserWindow): Promise<void> {
  if (window === managerWindow) traceWindowStartup('manager-page-usable')
  await presentWindow(window, async (requestId, target) => {
    const client = nativeManagerClient
    if (client?.isConnected && client.supportsLauncherFeatures) {
      try {
        return (await client.request<{ handedOff: boolean }>('feature-window-presented',
          { requestId, windowHandle: target.getNativeWindowHandle().readBigUInt64LE().toString() }, 5000)).handedOff
      } catch (error) { if (client.isConnected) throw error }
    }
    return false
  })
}

async function openTranslation2Window(requestId: string, text: string | null, entry = 'manager', handoffRequestId = requestId): Promise<void> {
  if (!currentWindowRequest()) return withWindowRequest({ requestId: handoffRequestId, entry, pluginId: 'webtools.translation',
    startup: hasPresentedTarget ? 'warm' : 'cold' }, () => {
    traceWindowStartup('plugin-request-received')
    return openTranslation2Window(requestId, text, entry)
  })
  cancelPendingNativeIntent('INTENT_SUPERSEDED', 'A newer Manager request replaced this one.')
  translationPreview?.invalidate()
  translationService?.cancelAll()
  if (!translationWindow) throw new NativeManagerRequestError('TRANSLATION_UNAVAILABLE', '翻译窗口尚未就绪。')
  await translationWindow.open(text)
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

function canQuitIdleElectronHost(): boolean {
  return electronHostReady && !quitting && !(nativeManaged && hostOwnership.hasOwnership) && activationInFlight === 0
    && !pluginWindows?.hasSurfaces && !translationWindow?.hasSurface && !pluginCommands?.hasActiveWork
    && (!managerWindow || managerWindow.isDestroyed())
}
function maybeQuitIdleElectronHost(): void { if (canQuitIdleElectronHost()) app.quit() }

async function synchronizeNativeOwnership(client: NativeManagerClient): Promise<void> {
  hostOwnership.replace(await client.request('electron-host-ownership-get', {}))
  while (!quitting && client === nativeManagerClient) {
    const result = await client.request<{ synchronized: boolean; snapshot: HostOwnershipSnapshot }>('electron-host-ready',
      { ownershipRevision: hostOwnership.snapshotRevision })
    if (!client.isConnected || client !== nativeManagerClient) throw new Error('Ownership synchronization lost its connection.')
    hostOwnership.replace(result.snapshot)
    if (result.synchronized) {
      hostOwnership.connected()
      traceWindowStartup('ownership-snapshot-synchronized')
      traceWindowStartup('electron-host-ready')
      return
    }
  }
}

async function connectNativeHost(): Promise<NativeManagerClient> {
  const client = new NativeManagerClient(nativePipeName, nativePipeAuthenticationToken, true, true)
  nativeManagerClient = client
  client.onCommand(handleNativeManagerCommand)
  client.onDisconnect(error => {
    if (client !== nativeManagerClient || quitting) return
    hostOwnership.disconnected()
    traceWindowStartup('named-pipe-disconnected')
    featureQuickResultConsent?.close()
    if (electronHostReady && !reconnectingNativeHost) {
      startNativeReconnect()
    }
    console.warn('[native-manager] Pipe disconnected; retaining current ownership until synchronization.', error?.message ?? '')
  })
  nativeLauncherState = parseNativeLauncherState(await client.connect())
  traceWindowStartup('named-pipe-connected')
  return client
}

function startNativeReconnect(): void {
  if (reconnectingNativeHost || quitting) return
  reconnectingNativeHost = reconnectNativeHost().finally(() => {
    reconnectingNativeHost = null
    if (!quitting && !nativeManagerClient?.isConnected) startNativeReconnect()
  })
}

async function reconnectNativeHost(): Promise<void> {
  while (!quitting) {
    try { if (!Number.isSafeInteger(nativeHostProcessId) || nativeHostProcessId <= 0) break; process.kill(nativeHostProcessId, 0) }
    catch { break }
    try {
      const client = await connectNativeHost()
      await synchronizeNativeOwnership(client)
      await syncNativeWebsiteProjection()
      await syncNativePluginProjection()
      await syncNativeFeatureProjection()
      lastDevelopmentProjectionKey = ''
      await syncNativeDevelopmentProjection()
      deliverPendingNativeIntent()
      maybeQuitIdleElectronHost()
      return
    } catch {
      // Retry only the transport. This delay is not a Host ownership timeout.
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  if (!quitting) app.quit()
}

function createWindow(): void {
  if (managerWindow && !managerWindow.isDestroyed()) {
    managerWindow.show()
    managerWindow.focus()
    return
  }

  managerRendererReady = false
  managerClosing = null
  const window = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 840,
    minHeight: 600,
    backgroundColor: '#10151c',
    title: 'WebTools',
    icon: brandResourcePath('app.ico'),
    show: false,
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  managerWindow = window
  if (nativeManaged) window.setOpacity(0)
  window.setMenu(null)
  const detachManagerDialogs = pluginRuntimeSession.registerManagerWindow(window)
  window.once('closed', detachManagerDialogs)
  pluginWindows?.registerManagerWindow(window, () => closeManagerWindow(window))
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:') && !url.startsWith('http://localhost:')) event.preventDefault()
  })
  window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (!isMainFrame || isInPlace) return
    managerRendererReady = false
    void webPluginRuntime?.close()
    cancelAIConnectionTests()
    pluginManager?.beginSession()
    pluginCatalog?.beginSession()
    void pluginManager?.restoreSession().catch(error => console.warn('[plugins] Manager session restore failed.', error))
    if (nativeManaged && nativeManagerClient?.isConnected) {
      void nativeManagerClient.request('manager-renderer-not-ready', {}).catch((error) => console.error('[native-manager] renderer-not-ready failed', error))
    }
  })
  window.on('closed', () => {
    if (managerWindow !== window) return
    cancelAIConnectionTests()
    pluginManager?.beginSession()
    pluginCatalog?.beginSession()
    managerWindow = null
    managerRendererReady = false
    cancelPendingNativeIntent('MANAGER_CLOSED', 'Manager window closed before acknowledging the current request.')
    if (nativeManagerClient?.isConnected) void nativeManagerClient.request('manager-renderer-not-ready', {}).catch(() => {})
    maybeQuitIdleElectronHost()
  })
  window.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    void closeManagerWindow(window).catch(() => console.warn('[plugin-window] Manager runtime cleanup failed.'))
  })

  window.once('ready-to-show', () => { if (!pendingNativeIntent) { window.setOpacity(1); window.show() } })

  if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function closeManagerWindow(window: BrowserWindow): Promise<void> {
  if (window.isDestroyed()) return Promise.resolve()
  return managerClosing ??= (async () => {
    try { await webPluginRuntime?.close() }
    finally { if (!window.isDestroyed()) window.destroy() }
  })().finally(() => { managerClosing = null })
}

function showManager(): void {
  if (managerClosing) { void managerClosing.then(showManager, showManager); return }
  if (!managerWindow || managerWindow.isDestroyed()) createWindow()
  else {
    if (!pendingNativeIntent) { managerWindow.show(); managerWindow.focus() }
  }
}

function markManagerRendererReady(sender: WebContents): void {
  const window = managerWindow
  if (!window || window.isDestroyed() || window.webContents.isDestroyed() || sender !== window.webContents) return
  managerRendererReady = true
  if (!nativeManaged || !nativeManagerClient?.isConnected) { deliverPendingNativeIntent(); return }
  void nativeManagerClient.request('manager-renderer-ready', {}).then(() => deliverPendingNativeIntent()).catch((error) => {
    console.error('[native-manager] renderer-ready acknowledgement failed', error)
    app.quit()
  })
}

const hasSingleInstanceLock = nativeManaged || app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()
else if (!nativeManaged) app.on('second-instance', () => showManager())

disposeVersionIpcHandlers = registerManagerInvokeHandlers(ipcMain, context => isCurrentWindowMainFrame(context, managerWindow), {
  [IPC_CHANNELS.getVersion]: () => app.getVersion(),
})

app.whenReady().then(async () => {
  traceWindowStartup('electron-app-ready')
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
    try {
      await connectNativeHost()
      await syncNativeWebsiteProjection()
    } catch (error) {
      if (!nativeLauncherState) {
        dialog.showErrorBox('WebTools Native Host 连接失败', error instanceof Error ? error.message : '无法连接常驻启动器。')
        app.quit()
        return
      }
      console.warn('[native-manager] Startup transport disconnected; synchronizing again after service initialization.')
    }
  }

  pluginTheme = new PluginThemeController(() => currentSettings().theme, nativeTheme)
  const runtimeDiagnostics = new PluginRuntimeDiagnostics(
    [app.getPath('userData'), process.env.USERPROFILE ?? '', __dirname, dirname(process.execPath)],
    [nativePipeAuthenticationToken ?? '', ...Object.entries(process.env).filter(([name]) => /TOKEN|SECRET|PASSWORD|API_KEY/i.test(name)).map(([, value]) => value ?? '')],
  )
  const createFeatureRuntime = (getWindow: () => BrowserWindow | null) => new WebPluginRuntime(getWindow, {},
    (authority, owner) => {
      const store = authority?.development ? pluginDevelopment?.capabilityStore(authority) : pluginManager?.store
      const effects = owner && effectsForWindow ? effectsForWindow(() => owner.isDestroyed() ? null : owner) : webCapabilityEffects
      return store && effects ? { store, effects } : null
    },
    authority => authority.development
      ? pluginDevelopment?.resolveNodeRuntimePaths(authority) ?? Promise.reject(new Error('Development session unavailable'))
      : pluginManager ? pluginManager.resolveNodeRuntimePaths(authority) : Promise.reject(new Error('Plugin Manager is unavailable')),
    runtimeDiagnostics, pluginTheme ?? undefined, (window, input) => pluginWindows?.handleInput(window, input) ?? false,
    (window, point) => pluginWindows?.handlePluginMouseDown(window, point), bindWindowStartupTrace())
  webPluginRuntime = createFeatureRuntime(() => managerWindow)
  pluginWindows = new PluginWindowManager({ createRuntime: createFeatureRuntime, theme: pluginTheme,
    defaultIcon: brandResourcePath('app.ico'), chromePreload: join(__dirname, '../preload/plugin-window-chrome.js'), onSurfacesChanged: maybeQuitIdleElectronHost,
    hasPendingHostDialogs: window => pluginRuntimeSession.hasPendingHostDialogs(window), returnToLauncher: returnToNativeLauncher,
    presentWindow: presentPluginWindow, startupStage: traceWindowStartup,
    loadChrome: window => loadWindowShell(window, () => isDevelopment && process.env.ELECTRON_RENDERER_URL
      ? window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/plugin-window.html`).then(() => undefined)
      : window.loadFile(join(__dirname, '../renderer/plugin-window.html')).then(() => undefined)),
    loadMenuOverlay: view => isDevelopment && process.env.ELECTRON_RENDERER_URL
      ? view.webContents.loadURL(`${process.env.ELECTRON_RENDERER_URL}/plugin-window-menu.html`).then(() => undefined)
      : view.webContents.loadFile(join(__dirname, '../renderer/plugin-window-menu.html')).then(() => undefined),
    openPluginManager: openPluginManagerSection })
  ipcMain.handle(PLUGIN_WINDOW_CHROME_CHANNELS.getState, event => {
    const owner = pluginWindows?.chromeOwnerFor(event.sender, event.senderFrame)
    if (!owner) return null
    return pluginWindows?.getChromeState(owner) ?? null
  })
  ipcMain.handle(PLUGIN_WINDOW_CHROME_CHANNELS.action, async (event, action: unknown) => {
    const owner = pluginWindows?.chromeOwnerFor(event.sender, event.senderFrame)
    if (!owner) return false
    return pluginWindows?.performChromeAction(owner, action) ?? false
  })
  pluginRuntimeSession.onHostDialogsClosed = window => pluginWindows?.hostDialogsClosed(window)
  pluginCommands = new NodeCommandExecutionAdapter({
    fork: (file, options) => utilityProcess.fork(file, [], options),
    resolve: authority => authority.development
      ? pluginDevelopment?.resolveNodeRuntimePaths(authority, true) ?? Promise.reject(new Error('Development session unavailable'))
      : pluginManager?.resolveNodeRuntimePaths(authority, true) ?? Promise.reject(new Error('Plugin manager unavailable')),
    capabilities: authority => {
      const store = authority.development ? pluginDevelopment?.capabilityStore(authority) : pluginManager?.store
      if (!store || !commandCapabilityEffects) throw new Error('Command Host capabilities unavailable.')
      return { store, effects: commandCapabilityEffects }
    }, diagnostics: runtimeDiagnostics, onOwnershipChanged: maybeQuitIdleElectronHost,
    onCleanupFailed: () => { console.error('[plugins] Command cleanup failed; exiting this Electron Host.'); app.quit() },
  })
  featureActivation = new FeatureActivationService((ref, dispatch) => {
    const manager = pluginManager
    if (!manager) return Promise.reject(new NativeManagerRequestError('FEATURE_UNAVAILABLE', 'Plugin manager unavailable'))
    return manager.authorizeWebFeature(ref, null, dispatch)
  }, new FeaturePresentationRouter(pluginWindows, pluginCommands), delta => { activationInFlight += delta; maybeQuitIdleElectronHost() })
  webPluginRuntime.subscribe(status => {
    if (pluginRuntimeAcceptanceRequested) console.log(`[plugin-runtime-acceptance] state=${status.state} generation=${status.generation} feature=${status.featureId ?? ''}`)
    const window = managerWindow
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.webRuntimeState, status)
    }
  })
  disposeWebRuntimeIpcHandlers = registerManagerEventHandlers(ipcMain, context => isCurrentWindowMainFrame(context, managerWindow), {
    [IPC_CHANNELS.webRuntimeSetBounds]: (_event, value: unknown) => {
    if (!value || typeof value !== 'object') return
    const bounds = value as Record<string, unknown>
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(item => typeof item === 'number' && Number.isFinite(item))) return
    const rect = { x: bounds.x as number, y: bounds.y as number, width: bounds.width as number, height: bounds.height as number }
    if (rect.x < 0 || rect.y < 0 || rect.x > 4000 || rect.y > 4000 || rect.width < 1 || rect.height < 1 || rect.width > 8000 || rect.height > 8000) return
    webPluginRuntime?.setBounds(rect)
    },
    [IPC_CHANNELS.webRuntimeClose]: (_event, generation: unknown) => {
    if (typeof generation !== 'number' || !Number.isSafeInteger(generation)
      || webPluginRuntime?.status.generation !== generation) return
    void webPluginRuntime?.close()
    },
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
    () => { translationPreview?.invalidate(); translationService?.cancelAll(); void translationWindow?.close() },
  )
  await builtinTranslationLifecycle.initialize()
  translation2Settings = new Translation2SettingsService(dataStore)
  const translation2ImportedServices = new Translation2ImportedServiceManager({
    settings: translation2Settings,
    secrets: secretStore,
    executor: new Translation2ImportedApiExecutor(),
  })
  translationService = new TranslationService({
    dataStore,
    sharedAI: sharedAIService,
    aiCredentials,
    myMemoryAdapter: new MyMemoryAdapter(),
    qwenMtAdapter: new QwenMtAdapter(),
    importedServices: translation2ImportedServices,
    translationAdmission: {
      captureGeneration: () => builtinTranslationLifecycle?.isEnabled() ? builtinTranslationLifecycle.generation : null,
      isGenerationCurrent: generation => builtinTranslationLifecycle?.isGenerationCurrent(generation) ?? false,
    },
  })
  translationWindow = new BuiltinTranslationWindow({
    createWindow: () => {
      const window = new BrowserWindow({
        width: 1040,
        height: 720,
        minWidth: 720,
        minHeight: 520,
        backgroundColor: '#10151c',
        title: 'WebTools 翻译',
        icon: brandResourcePath('app.ico'),
        show: false,
        frame: false,
        autoHideMenuBar: true,
        webPreferences: {
          preload: join(__dirname, '../preload/translation.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      })
      traceWindowStartup('browser-window-created')
      const trace = bindWindowStartupTrace()
      window.on('closed', () => trace('translation-window-closed'))
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.setMenu(null)
      window.on('focus', () => pluginWindows?.activateBackgroundWindow())
      bindTranslationEscape(window.webContents)
      window.on('close', event => { event.preventDefault(); closeTranslationSurface() })
      window.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith('file:') && !url.startsWith('http://localhost:')) event.preventDefault()
      })
      return window
    },
    loadWindow: async handle => {
      const window = handle as BrowserWindow
      await loadWindowShell(window, () => isDevelopment && process.env.ELECTRON_RENDERER_URL
        ? window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/translation.html`)
        : window.loadFile(join(__dirname, '../renderer/translation.html')))
      await window.webContents.executeJavaScript(`new Promise(resolve => {
        if (document.documentElement.dataset.translationReady === 'true') { resolve(); return }
        document.addEventListener('webtools-translation-ready', () => resolve(), { once: true })
      })`)
      traceWindowStartup('translation-page-usable')
    },
    presentWindow: window => presentPluginWindow(window as BrowserWindow),
    isEnabled: () => builtinTranslationLifecycle?.isEnabled() ?? false,
    onFocused: () => pluginWindows?.activateBackgroundWindow(),
    onSurfacesChanged: active => {
      if (!active) {
        translationService?.cancelAll()
        void translationWebsiteHost?.closeAll()
      }
      maybeQuitIdleElectronHost()
    },
  })
  const websiteSessions = new Map<Translation2WebsiteProviderId, Electron.Session>()
  const websiteSession = (id: Translation2WebsiteProviderId) => {
    const existing = websiteSessions.get(id)
    if (existing) return existing
    const value = session.fromPartition(`webtools-translation-${id}`)
    value.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    value.setPermissionCheckHandler(() => false)
    value.on('will-download', (_event, item) => item.cancel())
    websiteSessions.set(id, value)
    return value
  }
  translationWebsiteHost = new Translation2WebsiteHost({
    getWindow: () => {
      const surface = translationWindow?.getSurface() as BrowserWindow | null
      return surface ? { contentView: {
        addChildView: view => surface.contentView.addChildView(view as WebContentsView),
        removeChildView: view => surface.contentView.removeChildView(view as WebContentsView),
      } } : null
    },
    createView: providerId => {
      const view = new WebContentsView({ webPreferences: {
        session: websiteSession(providerId),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        webviewTag: false,
        allowRunningInsecureContent: false,
        devTools: false,
      } })
      view.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
      bindTranslationEscape(view.webContents)
      view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      view.webContents.on('will-navigate', (event, url) => { if (!isAllowedTranslationWebsiteUrl(providerId, url)) event.preventDefault() })
      view.webContents.on('will-redirect', (event, url) => { if (!isAllowedTranslationWebsiteUrl(providerId, url)) event.preventDefault() })
      return view
    },
    clearSession: async id => {
      const value = websiteSessions.get(id)
      if (!value) return
      await value.clearStorageData()
      await value.closeAllConnections()
    },
    onStateChanged: state => {
      const surface = translationWindow?.getSurface() as BrowserWindow | null
      if (surface && !surface.webContents.isDestroyed()) surface.webContents.send(TRANSLATION2_IPC_CHANNELS.websiteState, state)
    },
  })
  disposeTranslation2Handlers = registerTranslation2Handlers(ipcMain, {
    isTranslationMainFrame: context => translationWindow?.ownsMainFrame(context) ?? false,
    window: {
      snapshot: () => translationWindow!.snapshot(),
      isPinned: () => translationWindow!.isPinned(),
      setPinned: pinned => translationWindow!.setPinned(pinned),
      minimize: () => translationWindow!.minimize(),
      close: async () => { closeTranslationSurface() },
    },
    settings: translation2Settings,
    translation: translationService,
    importedServices: translation2ImportedServices,
    websites: translationWebsiteHost,
    aiConfiguration: new Translation2AIConfiguration({ store: dataStore, credentials: aiCredentials, sharedAI: sharedAIService }),
    sharedAI: sharedAIService,
    languageDefaults: () => {
      const value = dataStore.snapshot().settings.translation
      return { sourceLanguage: value.sourceLanguage, targetLanguage: value.targetLanguage }
    },
    theme: () => currentSettings().theme,
  })
  translationPreview = new BuiltinTranslationPreview({
    service: translationService,
    settings: () => { const settings = dataStore.snapshot().settings; return { translation: settings.translation, translation2: translation2Settings!.get(), sharedAI: settings.sharedAI } },
    enabled: async () => { const status = await requestSuperPanelSettings('super-panel-settings-get', {}); return status.settings.enabled && status.settings.autoTranslationPreview },
  })
  const runtimeAcceptanceHostOverrides = pluginRuntimeAcceptanceOptions
    ? createPluginRuntimeAcceptanceHostOverrides(pluginRuntimeAcceptanceOptions) : undefined
  const pluginHost = createElectronPluginHost({ userData: app.getPath('userData'), hostVersion: app.getVersion(), sharedAI: sharedAIService, dataStore, getWindow: () => managerWindow,
    deleteRuntimeData: pluginId => webPluginRuntime?.clearPluginData(pluginId) ?? Promise.resolve(),
    clearTemporaryWindowTarget: pluginId => pluginWindows?.clearInstalledTemporaryTarget(pluginId),
    closeFeatureWindows: async pluginId => { await Promise.all([pluginWindows?.closePlugin(pluginId), pluginCommands?.cancelPlugin(pluginId)]) } }, runtimeAcceptanceHostOverrides)
  webCapabilityEffects = pluginHost.webEffects
  effectsForWindow = pluginHost.webEffectsForWindow
  commandCapabilityEffects = pluginHost.commandEffects
  featureQuickResultConsent = new FeatureQuickResultConsent({
    provider: async () => {
      const info = await sharedAIService.getDefaultProviderInfo()
      return { identity: JSON.stringify([info.providerId, info.model, dataStore.snapshot().settings.sharedAI]), label: info.providerName }
    },
    send: async value => {
      if (!nativeManagerClient?.supportsQuickResult) throw new Error('Native confirmation is unavailable.')
      await nativeManagerClient.request('feature-ai-confirm-v1', value, 5000)
    },
  })
  pluginDevelopment = new PluginDevelopment({ runtime: {
    clearWindowTarget: sessionId => pluginWindows?.clearDevelopmentTemporaryTarget(sessionId),
    activate: async authority => { await featureActivation!.activateAuthorized(authority, 'manager') },
    beginReload: sessionId => {
      const reload = pluginWindows!.beginDevelopmentReload(sessionId)
      return { get featureIds() { return reload.featureIds },
        ready: Promise.all([reload.ready, pluginCommands!.cancelDevelopmentSession(sessionId)]).then(() => undefined),
        finish: () => reload.finish() }
    },
    closeSession: async sessionId => { await Promise.all([pluginWindows!.closeDevelopmentSession(sessionId), pluginCommands!.cancelDevelopmentSession(sessionId)]) },
  }, diagnostics: runtimeDiagnostics,
    userData: app.getPath('userData'), hostVersion: app.getVersion(),
    confirmProject: async (projectName, pkg, signal) => {
      if (runtimeAcceptanceHostOverrides) return !signal.aborted && runtimeAcceptanceHostOverrides.confirmDevelopmentProject(pkg)
      const window = managerWindow
      if (!window || window.isDestroyed()) return false
      const result = await pluginRuntimeSession.withHostDialog(window, () => dialog.showMessageBox(window, {
        type: 'warning', title: '授权开发项目',
        message: pkg.manifest.runtime.kind === 'node'
          ? '连接此 Node 开发插件？它将以当前 Windows 用户身份执行本地代码。'
          : '连接此 Web 开发插件？成功构建后将自动重载它的 Feature。',
        detail: `项目：${projectName}\n插件：${pkg.manifest.name} (${pkg.manifest.id})\n宿主能力：${pkg.manifest.requestedCapabilities.join(', ') || '无'}\n\n仅连接你信任的项目。开发数据与已安装插件隔离；关闭开发者模式将断开连接。`,
        buttons: ['取消', '授权并连接'], defaultId: 0, cancelId: 0, noLink: true, signal,
      }))
      return result.response === 1 && managerWindow === window && !window.isDestroyed()
    },
  })
  const publishDevelopment = () => {
    const window = managerWindow
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(IPC_CHANNELS.pluginDevelopmentChanged, pluginDevelopment?.status)
    void syncNativeDevelopmentProjection().catch(() => console.warn('[quick-result] Development source invalidation failed.'))
  }
  const removeDevelopmentObserver = pluginDevelopment.subscribe(publishDevelopment)
  const removeDiagnosticObserver = runtimeDiagnostics.subscribe(publishDevelopment)
  disposePluginDevelopmentSubscriptions = () => { removeDevelopmentObserver(); removeDiagnosticObserver() }
  disposePluginDevelopmentHandlers = registerPluginDevelopmentHandlers(ipcMain, {
    development: pluginDevelopment, diagnostics: runtimeDiagnostics,
    isManagerMainFrame: context => isCurrentWindowMainFrame(context, managerWindow),
    chooseProject: async () => {
      if (runtimeAcceptanceHostOverrides) return runtimeAcceptanceHostOverrides.chooseDevelopmentProject()
      const window = managerWindow
      if (!window || window.isDestroyed()) return null
      const result = await pluginRuntimeSession.withHostDialog(window, () => dialog.showOpenDialog(window, { title: '连接正在运行 pnpm dev 的插件项目', properties: ['openDirectory'] }))
      if (managerWindow !== window || window.isDestroyed() || result.canceled) return null
      return result.filePaths[0] ?? null
    },
  })
  try { await pluginHost.manager.initialize(); pluginManager = pluginHost.manager }
  catch { pluginHost.manager.close() } // Fail closed without preventing existing Manager pages from opening.
  featureRegistry = new FeatureRegistry({
    listDeclarativeFeatures: () => pluginManager?.listFeatureCandidates() ?? Promise.resolve([]),
    listRuntimeFeatures: () => pluginManager?.listRuntimeFeatureCandidates() ?? Promise.resolve([]),
    isTranslationEnabled: () => builtinTranslationLifecycle?.isEnabled() ?? false,
  })
  if (pluginManager) {
    disposeFeatureManagerSubscription = pluginManager.subscribeFeatureAuthorityChanged(pluginId => {
      if (pluginId && !quitting) void nativeManagerClient?.clearAcceptedQuickResultForSource(pluginId).catch(() => console.warn('[quick-result] Source clear was not acknowledged.'))
      void refreshFeatureRegistry()
      void featureInvocationService?.revalidateDisplayedResult().catch(() => {})
    })
  }
  if (builtinTranslationLifecycle) {
    disposeBuiltinFeatureSubscription = builtinTranslationLifecycle.subscribeFeatureStateChanged(() => {
      translationPreview?.invalidate()
      void featureInvocationService?.revalidateDisplayedResult().catch(() => {})
      void refreshFeatureRegistry()
    })
  }
  await refreshFeatureRegistry()
  pluginCatalog = new PluginCatalog(app.getVersion(), () => pluginManager, builtinTranslationLifecycle, undefined, async ref => {
    if (!featureActivation) throw new Error('Feature activation unavailable')
    await featureActivation.activate({ ref, surface: 'manager' })
  }, async () => { await translationWindow!.open(null) })
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
    openTranslation: (requestId, text) => openTranslation2Window(requestId, text ?? null),
    translatePreview: (requestId, text, signal) => translationPreview!.run(requestId, text, signal),
    isWebFeature: ref => pluginDevelopment?.ownsPlugin(ref.pluginId) || (pluginManager?.isWebPackage(ref.pluginId) ?? false),
    activateWebFeature: async (ref, context, surface = 'launcher', quickResult) => {
      if (!featureActivation) throw new Error('Feature activation unavailable')
      if (quickResult && pluginDevelopment?.ownsPlugin(ref.pluginId)) {
        let outcome: FeatureActivationOutcome | undefined
        const ticket = await pluginDevelopment.authorizeFeature(ref, async (authority, current) => {
          outcome = await featureActivation!.activateAuthorized(authority, surface, context, quickResult, current)
        })
        await ticket.completion
        if (!outcome) throw new Error('Development Feature did not complete.')
        return outcome
      }
      return featureActivation.activate({ ref, surface, context, quickResult })
    },
    supportsQuickResult: () => nativeManagerClient?.supportsQuickResult ?? false,
    publishQuickResult: async payload => { await nativeManagerClient!.request('feature-result-v1', payload, 5000) },
    clearQuickResult: async binding => { await nativeManagerClient!.request('feature-result-clear-v1', binding, 5000) },
    quickResultEffects: (binding, signal) => ({
      confirm: (request, inputSignal) => request.kind === 'ai'
        ? featureQuickResultConsent!.confirm(binding.requestId, binding.ref, request, AbortSignal.any([signal, ...(inputSignal ? [inputSignal] : [])]))
        : commandCapabilityEffects!.confirm(request, inputSignal),
      completeAI: (prompt, inputSignal) => featureQuickResultConsent!.runApproved(binding, inputSignal, () => commandCapabilityEffects!.completeAI(prompt, inputSignal)),
    }),
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
    if (nativeManaged) {
      nativeFeatureProjectionPublisher = new NativeFeatureProjectionPublisher(
        async () => {
          const registry = featureRegistry
          if (!registry) throw new Error('Feature registry is unavailable.')
          return registry.snapshot(nativeManagerClient?.supportsLauncherFeatures ?? false, nativeManagerClient?.supportsSuperPanel ?? false,
            nativeManagerClient?.supportsSelectedTextMatching ?? false)
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
      const result = await pluginRuntimeSession.withHostDialog(window, () => dialog.showMessageBox(window, {
        type: 'warning',
        title: '恢复内置翻译状态',
        message: 'WebTools 将先备份无法读取的状态文件，再恢复翻译为启用状态。',
        detail: '原文件会保留在内置插件状态目录中。此操作不会修改翻译设置、AI 密钥或第三方插件数据。',
        buttons: ['备份并恢复', '取消'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      }))
      return result.response === 0
    },
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

  registerWindowIpcHandlers(ipcMain, {
    isManagerMainFrame: context => isCurrentWindowMainFrame(context, managerWindow),
    markManagerRendererReady,
    acknowledgeNativeManagerIntent,
    performManagerWindowAction: action => {
      const window = managerWindow
      if (!window || window.isDestroyed()) return { ok: false, error: { code: 'MANAGER_WINDOW_UNAVAILABLE', message: 'Manager 窗口当前不可用。' } }
      if (action === 'minimize') window.minimize()
      else if (action === 'toggle-maximize') {
        if (window.isMaximized()) window.unmaximize()
        else window.maximize()
      } else window.close()
      return { ok: true, data: { maximized: !window.isDestroyed() && window.isMaximized() } }
    },
  })
  registerWebsiteIpcHandlers(ipcMain, { isManagerMainFrame: context => isCurrentWindowMainFrame(context, managerWindow), websiteService, websiteMetadata, bookmarkService, onWebsitesChanged: syncNativeWebsiteProjection })
  registerSettingsIpcHandlers(ipcMain, {
    dataStore,
    isManagerMainFrame: (context) => isCurrentWindowMainFrame(context, managerWindow),
    cancelTranslations: () => cancelActiveAIRequests(true),
    getSettings: currentSettings,
    updateNativeLauncherSettings: nativeManaged ? updateNativeLauncherSettings : undefined,
    onThemePreferenceChanged: () => pluginTheme?.refresh(),
    getSuperPanelSettings: () => requestSuperPanelSettings('super-panel-settings-get', {}),
    updateSuperPanelSettings: settings => requestSuperPanelSettings('super-panel-settings-update', settings),
  })
  cancelAIConnectionTests = registerTranslationIpcHandlers(ipcMain, {
    sharedAIService,
    aiCredentials,
    isManagerMainFrame: (context) => isCurrentWindowMainFrame(context, managerWindow),
  })
  registerEverythingIpcHandlers(ipcMain, {
    isManagerMainFrame: context => isCurrentWindowMainFrame(context, managerWindow),
    everything,
    dataStore,
    getManagerWindow: () => managerWindow,
    showOpenDialog: (window, options) => window ? pluginRuntimeSession.withHostDialog(window, () => dialog.showOpenDialog(window, options)) : dialog.showOpenDialog(options),
    getSettings: currentSettings,
  })
  electronHostReady = true
  const hostOnly = nativeManaged && process.env.WEBTOOLS_ELECTRON_HOST_ONLY === '1'
  if (nativeManaged) {
    try {
      if (!nativeManagerClient?.isConnected) throw new Error('Startup pipe disconnected.')
      await synchronizeNativeOwnership(nativeManagerClient)
    } catch {
      hostOwnership.disconnected()
      startNativeReconnect()
      await reconnectingNativeHost
    }
  }
  if (quitting) return
  if (!hostOnly) createWindow()
  maybeQuitIdleElectronHost()

  app.on('activate', () => {
    showManager()
  })
})

app.on('window-all-closed', maybeQuitIdleElectronHost)

app.on('before-quit', event => {
  if (webPluginRuntime && !runtimeQuitPrepared) {
    event.preventDefault()
    runtimeQuitPrepared = true
    quitting = true
    void (async () => {
      if (nativeManagerClient?.supportsLauncherFeatures) await nativeManagerClient.request('electron-host-closing', {}).catch(() => {})
      await pluginDevelopment?.close().catch(() => console.warn('[plugin-development] Development session cleanup failed.'))
      await translationWindow?.close()
      await pluginWindows?.closeAll()
      await pluginCommands?.closeAll()
      await webPluginRuntime?.close()
    })().finally(() => app.quit())
    return
  }
  quitting = true
  featureQuickResultConsent?.close()
  cancelActiveAIRequests()
  disposeFeatureManagerSubscription()
  pluginTheme?.dispose()
  pluginTheme = null
  disposeBuiltinFeatureSubscription()
  featureRegistry?.close()
  featureRegistry = null
  builtinTranslationLifecycle?.close()
  pluginManager?.close()
  disposePluginHandlers()
  disposeVersionIpcHandlers()
  disposeWebRuntimeIpcHandlers()
  disposeTranslation2Handlers()
  disposePluginDevelopmentHandlers()
  disposePluginDevelopmentSubscriptions()
  pluginCatalog?.close()
  disposeCatalogHandlers()
  nativeManagerClient?.close()
  nativePluginProjectionPublisher?.close()
  nativeFeatureProjectionPublisher?.close()
  webPluginRuntime = null
  nativeManagerClient = null
})
