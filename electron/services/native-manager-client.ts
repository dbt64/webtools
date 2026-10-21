import { randomUUID } from 'node:crypto'
import { createConnection, type Socket } from 'node:net'
import {
  encodeProtocolFrame,
  isNativeManagerEnvelope,
  MAX_PROTOCOL_MESSAGE_BYTES,
  NATIVE_MANAGER_PROTOCOL_VERSION,
  ProtocolFrameDecoder,
  NativeManagerRequestError,
  type NativeManagerAck,
  type NativeManagerEnvelope,
} from './native-manager-protocol.ts'
import type { AppSettings, SearchEngine, ThemePreference, LauncherDisplayMode, WebsiteSearchEntry } from '../../src/shared/domain'
import { QUICK_RESULT_CAPABILITY, parseFeatureResultControl } from '../../src/shared/feature-quick-result-contracts.ts'

export interface NativeAppSearchMemoryRecord { query: string; appId: string; lastUsedAt: number }

const supportedManagerCapabilities = [
  'feature-projection-v2',
  'electron-host-lifecycle-v1',
  'launcher-feature-surfaces-v1',
  'super-panel-context-v1',
  'super-panel-settings-v2',
] as const

export interface NativeLauncherState {
  schemaVersion: number
  quickSearchShortcut: string
  theme: ThemePreference
  launcherDisplayMode: LauncherDisplayMode
  launchOnStartup: boolean
  searchEngines: SearchEngine[]
  defaultSearchEngineId: string
  everythingEnabled: boolean
  everythingEsPath: string
  websites: WebsiteSearchEntry[]
  appSearchMemory: NativeAppSearchMemoryRecord[]
}

export type NativeLauncherSettingsUpdate = Partial<Pick<AppSettings,
  'quickSearchShortcut' | 'theme' | 'launcherDisplayMode' | 'launchOnStartup' | 'searchEngines'
  | 'defaultSearchEngineId' | 'everythingEnabled' | 'everythingEsPath'>>

export function parseNativeLauncherState(value: unknown): NativeLauncherState {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || typeof value.quickSearchShortcut !== 'string'
    || !['light', 'dark', 'system'].includes(String(value.theme))
    || !['compact', 'expanded'].includes(String(value.launcherDisplayMode))
    || typeof value.launchOnStartup !== 'boolean'
    || !Array.isArray(value.searchEngines)
    || typeof value.defaultSearchEngineId !== 'string'
    || typeof value.everythingEnabled !== 'boolean'
    || typeof value.everythingEsPath !== 'string'
    || !Array.isArray(value.websites)
    || !Array.isArray(value.appSearchMemory)) {
    throw new NativeManagerRequestError('INVALID_NATIVE_STATE', 'Native Host returned an invalid Launcher state.')
  }
  const engines = value.searchEngines.every((engine) => isRecord(engine)
    && typeof engine.id === 'string' && typeof engine.name === 'string' && typeof engine.template === 'string'
    && typeof engine.enabled === 'boolean' && typeof engine.builtIn === 'boolean' && Number.isSafeInteger(engine.order))
  const websites = value.websites.every((website) => isRecord(website)
    && typeof website.id === 'string' && typeof website.name === 'string' && typeof website.url === 'string'
    && typeof website.description === 'string' && Array.isArray(website.folderIds) && website.folderIds.every((id) => typeof id === 'string'))
  const memory = value.appSearchMemory.every((item) => isRecord(item)
    && typeof item.query === 'string' && typeof item.appId === 'string' && Number.isSafeInteger(item.lastUsedAt))
  if (!engines || !websites || !memory) throw new NativeManagerRequestError('INVALID_NATIVE_STATE', 'Native Host returned an invalid Launcher state.')
  return value as unknown as NativeLauncherState
}

interface PendingRequest {
  type: string
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export interface NativeManagerCommandReply {
  readonly kind: 'native-manager-reply'
  readonly result: unknown
  readonly afterAcknowledgement?: () => void
}

export function nativeManagerReply(result: unknown, afterAcknowledgement?: () => void): NativeManagerCommandReply {
  return { kind: 'native-manager-reply', result, ...(afterAcknowledgement ? { afterAcknowledgement } : {}) }
}

type NativeManagerCommandHandler = (message: NativeManagerEnvelope) => void | (() => void) | NativeManagerCommandReply | Promise<void | (() => void) | NativeManagerCommandReply>

export class NativeManagerClient {
  private static readonly featureProjectionV2Capability = 'feature-projection-v2'
  private static readonly hostLifecycleCapability = 'electron-host-lifecycle-v1'
  private static readonly launcherFeaturesCapability = 'launcher-feature-surfaces-v1'
  private static readonly superPanelCapability = 'super-panel-context-v1'
  private static readonly superPanelSettingsCapability = 'super-panel-settings-v2'
  private socket: Socket | null = null
  private readonly decoder = new ProtocolFrameDecoder()
  private readonly pending = new Map<string, PendingRequest>()
  private readonly commandHandlers = new Set<NativeManagerCommandHandler>()
  private readonly disconnectHandlers = new Set<(error?: Error) => void>()
  private connected = false
  private featureProjectionV2Supported = false
  private hostLifecycleSupported = false
  private launcherFeaturesSupported = false
  private superPanelSupported = false
  private superPanelSettingsSupported = false
  private quickResultSupported = false
  private selectedTextMatchingSupported = false
  private closed = false
  private readonly pipeName: string
  private developmentAuthenticationToken: string | null

  constructor(pipeName: string, developmentAuthenticationToken?: string, private readonly offerQuickResult = false, private readonly offerSelectedTextMatching = false) {
    this.pipeName = pipeName
    this.developmentAuthenticationToken = developmentAuthenticationToken ?? null
  }

  get isConnected(): boolean { return this.connected && !this.closed }
  get supportsFeatureProjectionV2(): boolean { return this.isConnected && this.featureProjectionV2Supported }
  get supportsHostLifecycle(): boolean { return this.isConnected && this.hostLifecycleSupported }
  get supportsLauncherFeatures(): boolean { return this.isConnected && this.launcherFeaturesSupported }
  get supportsSuperPanel(): boolean { return this.isConnected && this.superPanelSupported }
  get supportsSuperPanelSettings(): boolean { return this.isConnected && this.superPanelSettingsSupported }
  get supportsQuickResult(): boolean { return this.isConnected && this.quickResultSupported }
  get supportsSelectedTextMatching(): boolean { return this.isConnected && this.selectedTextMatchingSupported }
  async clearAcceptedQuickResultForSource(pluginId: string): Promise<void> {
    if (!this.supportsQuickResult) return
    // Idempotent capability reply exposes correlation metadata only. This does
    // not restore an old invocation, read text or grant execution authority.
    const response = await this.request<{ capability?: string; acceptedResult?: unknown }>('feature-quick-result-negotiate-v1', { capability: QUICK_RESULT_CAPABILITY }, 5000)
    if (response?.capability !== QUICK_RESULT_CAPABILITY) throw new TypeError('Invalid Quick Result metadata reply.')
    if (response.acceptedResult == null) return
    const binding = parseFeatureResultControl(response.acceptedResult)
    if (!binding) throw new TypeError('Invalid accepted Quick Result binding.')
    if (binding.ref.pluginId === pluginId) await this.request('feature-result-clear-v1', binding, 5000)
  }

  async connect(timeoutMs = 30_000): Promise<unknown> {
    if (this.connected) throw new Error('Native Manager pipe is already connected.')
    const pipePath = this.pipeName.startsWith('\\\\.\\pipe\\') ? this.pipeName : `\\\\.\\pipe\\${this.pipeName}`
    const socket = createConnection(pipePath)
    this.socket = socket
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out connecting to the Native Host.')), timeoutMs)
        socket.once('connect', () => { clearTimeout(timer); resolve() })
        socket.once('error', (error) => { clearTimeout(timer); reject(error) })
      })
      socket.on('data', (chunk) => this.handleData(chunk))
      socket.on('error', (error) => this.handleDisconnect(error))
      socket.on('close', () => this.handleDisconnect())
      const hello = await this.request<{ state?: unknown; supportedFeatures?: unknown }>('hello', {
        processId: process.pid,
        managerVersion: process.env.npm_package_version ?? 'unknown',
        capabilities: [NativeManagerClient.featureProjectionV2Capability, NativeManagerClient.hostLifecycleCapability, NativeManagerClient.launcherFeaturesCapability, NativeManagerClient.superPanelCapability, NativeManagerClient.superPanelSettingsCapability],
        ...(this.developmentAuthenticationToken ? { developmentAuthenticationToken: this.developmentAuthenticationToken } : {}),
      }, timeoutMs)
      const advertised = hello?.supportedFeatures
      const validCapabilities = Array.isArray(advertised)
        && advertised.every((item): item is typeof supportedManagerCapabilities[number] =>
          typeof item === 'string' && supportedManagerCapabilities.includes(item as typeof supportedManagerCapabilities[number]))
        && new Set(advertised).size === advertised.length
      const capabilities = validCapabilities ? advertised : []
      this.featureProjectionV2Supported = capabilities.includes(NativeManagerClient.featureProjectionV2Capability)
      this.hostLifecycleSupported = capabilities.includes(NativeManagerClient.hostLifecycleCapability)
      this.launcherFeaturesSupported = capabilities.includes(NativeManagerClient.launcherFeaturesCapability)
      this.superPanelSupported = capabilities.includes(NativeManagerClient.superPanelCapability)
      this.superPanelSettingsSupported = capabilities.includes(NativeManagerClient.superPanelSettingsCapability)
      this.connected = true
      this.selectedTextMatchingSupported = false
      this.developmentAuthenticationToken = null
      // Legacy NativeHost validates the hello capability list strictly. An authenticated
      // post-hello opt-in lets old peers return UNKNOWN_MESSAGE without breaking startup.
      if (this.offerQuickResult && this.supportsSuperPanel) {
        try {
          const extension = await this.request<{ capability?: unknown }>('feature-quick-result-negotiate-v1', { capability: QUICK_RESULT_CAPABILITY }, 3000)
          this.quickResultSupported = extension?.capability === QUICK_RESULT_CAPABILITY
        } catch (error) {
          if (!(error instanceof NativeManagerRequestError) || !['UNKNOWN_MESSAGE', 'CAPABILITY_REQUIRED'].includes(error.code)) throw error
        }
      }
      if (this.offerSelectedTextMatching && this.supportsSuperPanel) {
        try {
          const extension = await this.request<{ capability?: unknown }>('feature-text-match-negotiate-v1', { capability: 'selected-text-match-http-url-v1' }, 3000)
          this.selectedTextMatchingSupported = extension?.capability === 'selected-text-match-http-url-v1'
        } catch (error) {
          if (!(error instanceof NativeManagerRequestError) || !['UNKNOWN_MESSAGE', 'CAPABILITY_REQUIRED'].includes(error.code)) throw error
        }
      }
      return hello?.state
    } catch (error) {
      this.handleDisconnect(asError(error))
      throw error
    }
  }

  request<T = unknown>(type: string, payload: unknown, timeoutMs = 30_000): Promise<T> {
    const socket = this.socket
    if (!socket || socket.destroyed || this.closed) return Promise.reject(new Error('Native Host is not connected.'))
    const requestId = randomUUID()
    const envelope: NativeManagerEnvelope = { protocolVersion: NATIVE_MANAGER_PROTOCOL_VERSION, requestId, type, payload }
    let frame: Buffer
    try { frame = encodeProtocolFrame(envelope) } catch (error) { return Promise.reject(asError(error)) }

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`Native Host did not acknowledge ${type} within ${timeoutMs} ms.`))
      }, timeoutMs)
      this.pending.set(requestId, {
        type,
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      })
      socket.write(frame, (error) => {
        if (!error) return
        const pending = this.pending.get(requestId)
        if (!pending) return
        clearTimeout(pending.timer)
        this.pending.delete(requestId)
        pending.reject(error)
      })
    })
  }

  onCommand(handler: NativeManagerCommandHandler): () => void {
    this.commandHandlers.add(handler)
    return () => this.commandHandlers.delete(handler)
  }

  onDisconnect(handler: (error?: Error) => void): () => void {
    this.disconnectHandlers.add(handler)
    return () => this.disconnectHandlers.delete(handler)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.connected = false
    this.socket?.end()
    this.socket?.destroy()
    this.failPending(new Error('Native Manager pipe closed.'))
  }

  private handleData(chunk: Buffer): void {
    let messages: NativeManagerEnvelope[]
    try { messages = this.decoder.push(chunk) }
    catch (error) { this.handleDisconnect(asError(error)); return }
    for (const message of messages) {
      if (!isNativeManagerEnvelope(message) || message.protocolVersion !== NATIVE_MANAGER_PROTOCOL_VERSION) {
        this.handleDisconnect(new NativeManagerRequestError('PROTOCOL_VERSION', 'Native Host protocol version is incompatible.'))
        return
      }
      if (message.type === 'ack') { this.acceptAcknowledgement(message); continue }
      if (message.type === 'error') {
        const payload = isRecord(message.payload) ? message.payload : {}
        this.handleDisconnect(new NativeManagerRequestError(typeof payload.code === 'string' ? payload.code : 'NATIVE_HOST_ERROR', typeof payload.message === 'string' ? payload.message : 'Native Host rejected the connection.'))
        return
      }
      void this.handleCommand(message)
    }
  }

  private acceptAcknowledgement(message: NativeManagerEnvelope): void {
    if (!isRecord(message.payload) || typeof message.payload.replyToId !== 'string') return
    const requestId = message.payload.replyToId
    const pending = this.pending.get(requestId)
    if (!pending || pending.type !== message.payload.replyToType) return
    clearTimeout(pending.timer)
    this.pending.delete(requestId)
    const ack = message.payload as unknown as NativeManagerAck
    if (!ack.ok) {
      pending.reject(new NativeManagerRequestError(ack.error?.code ?? 'NATIVE_REQUEST_FAILED', ack.error?.message ?? 'Native Host rejected the request.'))
      return
    }
    pending.resolve(ack.result)
  }

  private async handleCommand(message: NativeManagerEnvelope): Promise<void> {
    try {
      const afterAcknowledgement: (() => void)[] = []
      let result: unknown
      let hasResult = false
      for (const handler of this.commandHandlers) {
        const callback = await handler(message)
        if (typeof callback === 'function') afterAcknowledgement.push(callback)
        else if (isNativeManagerCommandReply(callback)) {
          if (hasResult) throw new NativeManagerRequestError('DUPLICATE_COMMAND_RESULT', 'Manager produced multiple command responses.')
          result = callback.result
          hasResult = true
          if (callback.afterAcknowledgement) afterAcknowledgement.push(callback.afterAcknowledgement)
        }
      }
      await this.writeAcknowledgement(message, true, result)
      for (const callback of afterAcknowledgement) callback()
    } catch (error) {
      const requestError = error instanceof NativeManagerRequestError ? error : new NativeManagerRequestError('MANAGER_COMMAND_FAILED', asError(error).message)
      try { await this.writeAcknowledgement(message, false, undefined, requestError) }
      catch { /* writeAcknowledgement has already disconnected the failed pipe. */ }
    }
  }

  private async writeAcknowledgement(message: NativeManagerEnvelope, ok: boolean, result: unknown, error?: NativeManagerRequestError): Promise<void> {
    const socket = this.socket
    if (!socket || socket.destroyed) return
    const ack: NativeManagerEnvelope = {
      protocolVersion: NATIVE_MANAGER_PROTOCOL_VERSION,
      requestId: message.requestId,
      type: 'ack',
      payload: {
        replyToId: message.requestId,
        replyToType: message.type,
        ok,
        result,
        ...(error ? { error: { code: error.code, message: error.message.slice(0, MAX_PROTOCOL_MESSAGE_BYTES / 4) } } : {}),
      },
    }
    try {
      const frame = encodeProtocolFrame(ack)
      await new Promise<void>((resolve, reject) => socket.write(frame, error => error ? reject(error) : resolve()))
    } catch (writeError) {
      this.handleDisconnect(asError(writeError))
      throw writeError
    }
  }

  private handleDisconnect(error?: Error): void {
    if (this.closed) return
    const wasConnected = this.connected || this.socket !== null
    this.connected = false
    this.closed = true
    this.socket?.destroy()
    this.failPending(error ?? new Error('Native Host pipe disconnected.'))
    if (wasConnected) for (const handler of this.disconnectHandlers) handler(error)
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNativeManagerCommandReply(value: unknown): value is NativeManagerCommandReply {
  return isRecord(value) && value.kind === 'native-manager-reply' && Object.hasOwn(value, 'result')
    && (value.afterAcknowledgement === undefined || typeof value.afterAcknowledgement === 'function')
}

function asError(error: unknown): Error { return error instanceof Error ? error : new Error(String(error)) }
