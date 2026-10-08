import { WebContentsView, ipcMain, session, type BrowserWindow, type Rectangle, type Session } from 'electron'
import { join } from 'node:path'
import { WebPluginBridge } from './web-plugin-bridge.ts'
import { PLUGIN_BRIDGE_CLIENT_ROUTE, PLUGIN_BRIDGE_HOST_ROUTE } from './web-plugin-bridge-routes.ts'
import { buildRuntimeCsp, buildRuntimeResourceUrl, createRuntimeOrigin, parseRuntimePackageUrl, selectValidatedWebFeature } from './web-runtime-policy.ts'
import type { ValidatedWebPackageSnapshot } from './validated-web-package-snapshot.ts'
import { isValidatedWebPackageSnapshot } from './package-validator.ts'

const PARTITION = 'webtools-web-plugin-runtime'
const LOAD_TIMEOUT_MS = 15_000
const CLEANUP_TIMEOUT_MS = 5_000

export type WebRuntimeState = 'ABSENT' | 'CREATING' | 'LOADING' | 'READY' | 'FAULTED' | 'CLOSING' | 'CLOSED'
export interface WebRuntimeStatus { readonly state: WebRuntimeState; readonly featureId?: string; readonly generation: number }
interface RuntimeInstance {
  readonly snapshot: ValidatedWebPackageSnapshot
  readonly featureId: string
  readonly feature: ReturnType<typeof selectValidatedWebFeature>['feature']
  readonly host: string
  readonly generation: number
  readonly view: WebContentsView
  state: WebRuntimeState
  removeView: boolean
  rejectLoad?: (error: Error) => void
  timeout?: NodeJS.Timeout
  closePromise?: Promise<void>
  entryUrl: string
  documentLoaded: boolean
  initialNavigationStarted: boolean
  bridge?: WebPluginBridge
  removeBridgeListener?: () => void
}

interface WebRuntimeAcceptanceTestOptions {
  readonly holdPingUntilAbort?: (signal: AbortSignal) => null | Promise<null>
}

export class WebPluginRuntime {
  private readonly getWindow: () => BrowserWindow | null
  private readonly acceptanceTestOptions: WebRuntimeAcceptanceTestOptions
  private active: RuntimeInstance | null = null
  private runtimeSession: Session | null = null
  private pendingTeardown: Promise<void> = Promise.resolve()
  private generation = 0
  private requestGeneration = 0
  private unavailable = false
  private operationQueue: Promise<void> = Promise.resolve()
  private readonly listeners = new Set<(status: WebRuntimeStatus) => void>()

  constructor(getWindow: () => BrowserWindow | null, acceptanceTestOptions: WebRuntimeAcceptanceTestOptions = {}) {
    this.getWindow = getWindow
    this.acceptanceTestOptions = acceptanceTestOptions
  }

  subscribe(listener: (status: WebRuntimeStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get status(): WebRuntimeStatus {
    const active = this.active
    return Object.freeze({ state: active?.state ?? (this.unavailable ? 'CLOSED' : 'ABSENT'), ...(active ? { featureId: active.featureId } : {}), generation: active?.generation ?? this.generation })
  }

  setBounds(bounds: Rectangle): void {
    const active = this.active
    if (!active || active.state === 'CLOSING' || active.state === 'CLOSED') return
    const window = this.getWindow()
    if (!window || window.isDestroyed() || !window.contentView.children.includes(active.view)) return
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width < 1 || bounds.height < 1) return
    active.view.setBounds({ x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) })
  }

  async open(snapshot: ValidatedWebPackageSnapshot, featureId: string): Promise<WebRuntimeStatus> {
    const requestGeneration = ++this.requestGeneration
    const loading = this.active
    const preempt = loading && (loading.state === 'CREATING' || loading.state === 'LOADING')
      ? this.closeRuntime(loading)
      : Promise.resolve()
    const operation = this.operationQueue.then(async () => {
      await preempt
      return this.openInternal(snapshot, featureId, requestGeneration)
    })
    this.operationQueue = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async openInternal(snapshot: ValidatedWebPackageSnapshot, featureId: string, requestGeneration: number): Promise<WebRuntimeStatus> {
    // Crash teardown starts outside operationQueue; replacement must still wait for it.
    await this.pendingTeardown
    this.assertCurrentRequest(requestGeneration)
    if (this.unavailable) throw new Error('Web Plugin runtime is unavailable after an incomplete security cleanup')
    if (!isValidatedWebPackageSnapshot(snapshot)) throw new TypeError('Web Plugin runtime accepts only Host-validated package snapshots')
    const selection = selectValidatedWebFeature(snapshot, featureId)
    const existing = this.active
    if (existing && existing.snapshot.packageHash === snapshot.packageHash && existing.featureId === featureId && existing.state === 'READY') return this.status
    // This method already runs inside operationQueue; enqueueing close() here would await itself.
    if (existing) await this.closeRuntime(existing)
    this.assertCurrentRequest(requestGeneration)
    if (this.unavailable) throw new Error('Web Plugin runtime is unavailable after an incomplete security cleanup')
    const window = this.getWindow()
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) throw new Error('Manager window is unavailable')

    const identity = createRuntimeOrigin()
    const currentSession = await this.getRuntimeSession()
    this.assertCurrentRequest(requestGeneration)
    const view = new WebContentsView({ webPreferences: {
      session: currentSession,
      preload: join(__dirname, '../preload/web-plugin.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
      devTools: false,
    } })
    const runtime: RuntimeInstance = {
      snapshot, featureId, feature: selection.feature, host: identity.host,
      generation: ++this.generation, view, state: 'CREATING', removeView: false,
      entryUrl: buildRuntimeResourceUrl(identity.host, selection.entryPath), documentLoaded: false, initialNavigationStarted: false,
    }
    this.active = runtime
    runtime.bridge = new WebPluginBridge({
      authenticate: event => this.authenticateBridge(runtime, event),
      send: raw => view.webContents.send(PLUGIN_BRIDGE_HOST_ROUTE, raw),
      onReady: () => { runtime.state = 'READY'; this.publish(runtime) },
      onFatal: () => { void this.closeRuntime(runtime) },
      dispatchPing: this.acceptanceTestOptions.holdPingUntilAbort,
    })
    const receive = (event: Electron.IpcMainEvent, raw: unknown) => runtime.bridge?.receive(event, raw)
    ipcMain.on(PLUGIN_BRIDGE_CLIENT_ROUTE, receive)
    if (isAcceptanceRuntime()) console.log(`[web-runtime-acceptance] bridge-listeners=${ipcMain.listenerCount(PLUGIN_BRIDGE_CLIENT_ROUTE)} action=attach generation=${runtime.generation}`)
    runtime.removeBridgeListener = () => {
      ipcMain.removeListener(PLUGIN_BRIDGE_CLIENT_ROUTE, receive)
      if (isAcceptanceRuntime()) console.log(`[web-runtime-acceptance] bridge-listeners=${ipcMain.listenerCount(PLUGIN_BRIDGE_CLIENT_ROUTE)} action=detach generation=${runtime.generation}`)
    }
    this.publish(runtime)
    window.contentView.addChildView(view)
    runtime.removeView = true
    view.setBounds({ x: 1, y: 1, width: 1, height: 1 })
    view.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    this.bindNavigationPolicy(runtime)
    runtime.state = 'LOADING'
    this.publish(runtime)
    try {
      await this.load(runtime, runtime.entryUrl)
      await runtime.bridge.ready
      if (this.active !== runtime || runtime.generation !== this.generation || (runtime.state as WebRuntimeState) !== 'READY') throw new Error('Stale Web Plugin runtime load')
      return this.status
    } catch (error) {
      if ((runtime.state as WebRuntimeState) !== 'CLOSING' && (runtime.state as WebRuntimeState) !== 'CLOSED') {
        runtime.state = 'FAULTED'
        this.publish(runtime)
      }
      await this.closeRuntime(runtime)
      throw error
    }
  }

  async close(): Promise<void> {
    ++this.requestGeneration
    const activeAtRequest = this.active
    const immediateClose = activeAtRequest ? this.closeRuntime(activeAtRequest) : Promise.resolve()
    const operation = this.operationQueue.then(async () => {
      await immediateClose
      await this.pendingTeardown
      const active = this.active
      if (active) await this.closeRuntime(active)
    })
    this.operationQueue = operation.then(() => undefined, () => undefined)
    await operation
  }

  private publish(runtime: RuntimeInstance): void {
    const status = Object.freeze({ state: runtime.state, featureId: runtime.featureId, generation: runtime.generation })
    for (const listener of [...this.listeners]) {
      try { listener(status) } catch { /* A UI observer cannot break runtime lifecycle. */ }
    }
  }

  private async getRuntimeSession(): Promise<Session> {
    if (!this.runtimeSession) {
      const current = session.fromPartition(PARTITION, { cache: false })
      current.setPermissionRequestHandler((_contents, permission, callback) => {
        if (isAcceptanceRuntime()) console.log(`[web-runtime-acceptance] permission-denied kind=${permission}`)
        callback(false)
      })
      current.setPermissionCheckHandler(() => false)
      current.on('will-download', (_event, item) => {
        if (isAcceptanceRuntime()) console.log('[web-runtime-acceptance] download-cancelled')
        item.cancel()
      })
      current.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
        const active = this.active
        const path = active && parseRuntimePackageUrl(details.url, active.host)
        const resourceExists = path !== null && path !== undefined && active?.snapshot.inventory.some(item => item.canonicalPath === path)
        const cancel = !(active && active.state !== 'CLOSING' && active.state !== 'CLOSED' && resourceExists)
        if (cancel && isAcceptanceRuntime()) {
          let scheme = 'unknown'
          try { scheme = new URL(details.url).protocol.slice(0, -1).toLowerCase() } catch {}
          console.log(`[web-runtime-acceptance] request-denied scheme=${scheme}`)
        }
        callback({ cancel })
      })
      current.protocol.handle('webtools-plugin', async request => {
        const active = this.active
        if (!active || active.state === 'CLOSING' || active.state === 'CLOSED') return new Response('', { status: 404 })
        const path = parseRuntimePackageUrl(request.url, active.host)
        const resource = active.snapshot.getResource(path ?? '')
        if (!resource || !['GET', 'HEAD'].includes(request.method)) {
          if (isAcceptanceRuntime()) console.log('[web-runtime-acceptance] protocol-denied route')
          return new Response('', { status: 404 })
        }
        const delayAcceptanceResponse = isAcceptanceRuntime()
          && ((active.featureId === 'offline-demo-delayed' && path === 'web/delayed.html')
            || (process.env.WEBTOOLS_WEB_RUNTIME_TEST_SWITCH === '1' && active.featureId === 'offline-demo' && path === 'web/index.html'))
        if (delayAcceptanceResponse) {
          const delayMs = active.featureId === 'offline-demo-delayed' ? 30_000 : 8_000
          await new Promise<void>(resolveDelay => {
            const delayTimer = setTimeout(resolveDelay, delayMs)
            delayTimer.unref?.()
          })
          if (this.active !== active || (active.state as WebRuntimeState) === 'CLOSING' || (active.state as WebRuntimeState) === 'CLOSED') return new Response('', { status: 404 })
        }
        const headers = new Headers({
          'content-type': resource.mimeType,
          'content-security-policy': buildRuntimeCsp(active.feature.executionRequirements.wasm),
          'x-content-type-options': 'nosniff',
          'x-frame-options': 'DENY',
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
        })
        return new Response(request.method === 'HEAD' ? null : Uint8Array.from(resource.bytes), { status: 200, headers })
      })
      this.runtimeSession = current
    }
    await this.runtimeSession.setProxy({ mode: 'direct' })
    return this.runtimeSession
  }

  private bindNavigationPolicy(runtime: RuntimeInstance): void {
    const contents = runtime.view.webContents
    const allowed = (url: string): boolean => this.active === runtime
      && runtime.generation === this.generation
      && runtime.state !== 'CLOSING' && runtime.state !== 'CLOSED'
      && Boolean(runtime.snapshot.getResource(parseRuntimePackageUrl(url, runtime.host) ?? ''))
    const denyNavigation = (event: Electron.Event, url: string): void => {
      if (allowed(url)) return
      event.preventDefault()
      if (isAcceptanceRuntime()) {
        let scheme = 'unknown'
        try { scheme = new URL(url).protocol.slice(0, -1).toLowerCase() } catch {}
        console.log(`[web-runtime-acceptance] navigation-denied scheme=${scheme}`)
      }
    }
    contents.on('will-navigate', denyNavigation)
    contents.on('will-frame-navigate', details => {
      if (!details.isMainFrame || !allowed(details.url)) denyNavigation(details, details.url)
    })
    contents.on('will-redirect', denyNavigation)
    contents.on('login', event => event.preventDefault())
    contents.on('select-client-certificate', event => event.preventDefault())
    contents.on('certificate-error', (event, _url, _error, _certificate, callback) => {
      event.preventDefault()
      callback(false)
    })
    contents.on('will-attach-webview', event => event.preventDefault())
    contents.on('did-start-navigation', details => {
      if (!details.isMainFrame || details.isSameDocument) return
      if (runtime.initialNavigationStarted || runtime.documentLoaded || details.url !== runtime.entryUrl) {
        void this.closeRuntime(runtime)
      } else runtime.initialNavigationStarted = true
    })
    contents.on('unresponsive', () => { void this.closeRuntime(runtime) })
    contents.on('destroyed', () => {
      if (runtime.state !== 'CLOSING' && runtime.state !== 'CLOSED') void this.closeRuntime(runtime)
    })
    contents.on('render-process-gone', () => {
      if (this.active !== runtime || runtime.state === 'CLOSING' || runtime.state === 'CLOSED') return
      runtime.state = 'FAULTED'
      this.publish(runtime)
      void this.closeRuntime(runtime)
    })
  }

  private async load(runtime: RuntimeInstance, url: string): Promise<void> {
    const contents = runtime.view.webContents
    const result = new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(runtime.timeout)
        contents.removeListener('did-finish-load', finish)
        contents.removeListener('did-fail-load', failed)
        contents.removeListener('render-process-gone', crashed)
      }
      const finish = () => {
        cleanup()
        runtime.documentLoaded = true
        runtime.bridge?.documentLoaded()
        resolve()
      }
      const failed = (_event: Electron.Event, code: number, description: string, _url: string, isMainFrame: boolean) => {
        if (!isMainFrame || code === -3) return
        cleanup(); reject(new Error(`Web Plugin document failed to load (${code}): ${description}`))
      }
      const crashed = () => { cleanup(); reject(new Error('Web Plugin renderer process exited during load')) }
      runtime.rejectLoad = error => { cleanup(); reject(error) }
      contents.once('did-finish-load', finish)
      contents.on('did-fail-load', failed)
      contents.once('render-process-gone', crashed)
      runtime.timeout = setTimeout(() => runtime.rejectLoad?.(new Error('Web Plugin load timed out')), LOAD_TIMEOUT_MS)
      runtime.timeout.unref?.()
    })
    void contents.loadURL(url).catch(error => runtime.rejectLoad?.(error instanceof Error ? error : new Error('Web Plugin navigation failed')))
    await result
  }

  private assertCurrentRequest(requestGeneration: number): void {
    if (requestGeneration !== this.requestGeneration) throw new Error('Stale Web Plugin runtime request')
  }

  private authenticateBridge(runtime: RuntimeInstance, value: unknown): 'current' | 'invalid' | 'unrelated' {
    const event = value as Electron.IpcMainEvent
    const contents = runtime.view.webContents
    if (event.sender !== contents) return 'unrelated'
    if (this.active !== runtime || runtime.generation !== this.generation
      || !['LOADING', 'READY'].includes(runtime.state) || contents.isDestroyed()
      || !event.senderFrame || event.senderFrame !== contents.mainFrame || event.senderFrame.detached
      || event.senderFrame.url.split(/[?#]/, 1)[0] !== runtime.entryUrl
      || contents.getURL().split(/[?#]/, 1)[0] !== runtime.entryUrl
      || !isValidatedWebPackageSnapshot(runtime.snapshot)
      || runtime.feature.id !== runtime.featureId || !runtime.snapshot.manifest.features.includes(runtime.feature)) return 'invalid'
    return 'current'
  }

  private closeRuntime(runtime: RuntimeInstance): Promise<void> {
    if (runtime.closePromise) return runtime.closePromise
    runtime.closePromise = this.performCloseRuntime(runtime)
    this.pendingTeardown = runtime.closePromise
    return runtime.closePromise
  }

  private async performCloseRuntime(runtime: RuntimeInstance): Promise<void> {
    if (runtime.state === 'CLOSED') return
    runtime.state = 'CLOSING'
    if (this.active === runtime) this.active = null // Revoke generation and protocol access before touching WebContents.
    const bridgeClosed = runtime.bridge?.revoke()
    runtime.removeBridgeListener?.()
    runtime.removeBridgeListener = undefined
    runtime.rejectLoad?.(new Error('Web Plugin runtime closed'))
    clearTimeout(runtime.timeout)
    this.publish(runtime)
    await bridgeClosed // At most the frozen two-second cooperative grace; authority is already gone.
    const window = this.getWindow()
    try {
      if (runtime.removeView && window && !window.isDestroyed() && window.contentView.children.includes(runtime.view)) window.contentView.removeChildView(runtime.view)
    } catch { /* Continue fail-closed teardown even if the Manager is already being destroyed. */ }
    try { if (!runtime.view.webContents.isDestroyed()) runtime.view.webContents.close({ waitForBeforeUnload: false }) } catch { /* Contents may already be gone after a renderer crash. */ }
    try {
      const current = this.runtimeSession
      if (current) {
        let cleanupTimer: NodeJS.Timeout | undefined
        try {
          await Promise.race([
            (async () => { await current.closeAllConnections(); await current.clearStorageData(); await current.clearCache() })(),
            new Promise<never>((_, reject) => { cleanupTimer = setTimeout(() => reject(new Error('Web Plugin Session cleanup timed out')), CLEANUP_TIMEOUT_MS); cleanupTimer.unref?.() }),
          ])
          if (isAcceptanceRuntime()) {
            const remainingCookies = await current.cookies.get({})
            console.log(`[web-runtime-acceptance] storage-cleanup=completed cookies-remaining=${remainingCookies.length}`)
          }
        } finally { clearTimeout(cleanupTimer) }
      }
    } catch (error) {
      this.unavailable = true
      if (isAcceptanceRuntime()) console.error(`[web-runtime-acceptance] storage-cleanup=failed reason=${error instanceof Error ? error.message : 'unknown'}`)
    }
    runtime.state = 'CLOSED'
    this.generation++
    this.publish(runtime)
  }
}

function isAcceptanceRuntime(): boolean {
  return process.argv.includes('--phase6e4b-web-runtime-acceptance') && process.env.WEBTOOLS_WEB_RUNTIME_ACCEPTANCE === '1'
}
