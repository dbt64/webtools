import { WebContentsView, ipcMain, type BrowserWindow, type Rectangle, type Session, type NativeImage } from 'electron'
import { appendFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { WebPluginBridge } from './web-plugin-bridge.ts'
import { PLUGIN_BRIDGE_CLIENT_ROUTE, PLUGIN_BRIDGE_HOST_ROUTE, PLUGIN_RUNTIME_PRELOAD_ERROR_ROUTE } from './web-plugin-bridge-routes.ts'
import { buildRuntimeResourceUrl, createRuntimeOrigin, parseRuntimePackageUrl, selectValidatedWebFeature } from './web-runtime-policy.ts'
import type { ValidatedPluginRuntimeSnapshot } from './package-validator.ts'
import { isValidatedPluginRuntimeSnapshot } from './package-validator.ts'
import { isWebFeatureAuthority, type WebFeatureAuthority } from './web-feature-authority.ts'
import { WebHostCapabilities, type InvocationTextContext, type WebCapabilityEffects } from './web-host-capabilities.ts'
import type { PluginStore } from './plugin-store.ts'
import { tracePluginRuntimeAcceptance } from './plugin-runtime-acceptance-trace.ts'
import type { PluginRuntimeDiagnostics } from './plugin-runtime-diagnostics.ts'
import { pluginRuntimeSession } from './plugin-runtime-session.ts'
import { nextRuntimeGeneration } from './runtime-generation.ts'
import type { PluginThemeSource } from './plugin-window-theme.ts'

const LOAD_TIMEOUT_MS = 15_000
const CLEANUP_TIMEOUT_MS = 5_000

export type WebRuntimeState = 'ABSENT' | 'CREATING' | 'LOADING' | 'READY' | 'FAULTED' | 'CLOSING' | 'CLOSED'
export interface WebRuntimeStatus {
  readonly state: WebRuntimeState
  readonly featureId?: string
  readonly pluginId?: string
  readonly pluginName?: string
  readonly developmentSessionId?: string
  readonly errorCode?: string
  readonly generation: number
}
interface RuntimeInstance {
  readonly snapshot: ValidatedPluginRuntimeSnapshot
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
  removePreloadErrorListener?: () => void
  authority?: WebFeatureAuthority
  capabilities?: WebHostCapabilities
  removeAuthorityListener?: () => void
  gestureAt?: number
  errorCode?: string
  releaseSession?: () => Promise<void>
  themeWork?: Promise<void>
  themeCss?: string
  themeKeys?: Set<string>
  removeThemeListener?: () => void
}

interface WebRuntimeTestOptions {
  readonly dispatchPing?: (signal: AbortSignal) => null | Promise<null>
}

interface NodePluginPreloadDescriptor { pluginId: string; packageHash: string; preloadPath: string; preloadHash: string; localDataPath: string; generation: number }

export class WebPluginRuntime {
  private readonly getWindow: () => BrowserWindow | null
  private readonly runtimeTestOptions: WebRuntimeTestOptions
  private readonly getCapabilityDependencies?: (authority?: WebFeatureAuthority, window?: BrowserWindow) => { store: PluginStore; effects: Omit<WebCapabilityEffects, 'hasForegroundGesture'> } | null
  private readonly resolveNodePreload?: (authority: WebFeatureAuthority) => Promise<Omit<NodePluginPreloadDescriptor, 'generation'>>
  private active: RuntimeInstance | null = null
  private pendingTeardown: Promise<void> = Promise.resolve()
  private generation = 0
  private requestGeneration = 0
  private unavailable = false
  private operationQueue: Promise<void> = Promise.resolve()
  private readonly listeners = new Set<(status: WebRuntimeStatus) => void>()

  constructor(getWindow: () => BrowserWindow | null, runtimeTestOptions: WebRuntimeTestOptions = {},
    getCapabilityDependencies?: (authority?: WebFeatureAuthority, window?: BrowserWindow) => { store: PluginStore; effects: Omit<WebCapabilityEffects, 'hasForegroundGesture'> } | null,
    resolveNodePreload?: (authority: WebFeatureAuthority) => Promise<Omit<NodePluginPreloadDescriptor, 'generation'>>,
    private readonly diagnostics?: PluginRuntimeDiagnostics,
    private readonly themeSource?: PluginThemeSource,
    private readonly handleWindowEscape?: (window: BrowserWindow, input: { key: string; type: string; isAutoRepeat?: boolean; control?: boolean; meta?: boolean; alt?: boolean; shift?: boolean }) => boolean,
    private readonly handlePluginMouseDown?: (window: BrowserWindow, point: { x: number; y: number }) => void,
    private readonly startupStage?: (stage: string, frame?: NativeImage) => void) {
    this.getWindow = getWindow
    this.runtimeTestOptions = runtimeTestOptions
    this.getCapabilityDependencies = getCapabilityDependencies
    this.resolveNodePreload = resolveNodePreload
  }

  subscribe(listener: (status: WebRuntimeStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get status(): WebRuntimeStatus {
    const active = this.active
    return active ? this.describe(active) : Object.freeze({ state: this.unavailable ? 'CLOSED' : 'ABSENT', generation: this.generation })
  }

  setBounds(bounds: Rectangle): void {
    const active = this.active
    if (!active || active.state === 'CLOSING' || active.state === 'CLOSED') return
    const window = this.getWindow()
    if (!window || window.isDestroyed() || !window.contentView.children.includes(active.view)) return
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width < 1 || bounds.height < 1) return
    active.view.setBounds({ x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) })
  }

  setVisible(visible: boolean): void {
    const active = this.active
    if (!active || active.state === 'CLOSING' || active.state === 'CLOSED') return
    const window = this.getWindow()
    if (!window || window.isDestroyed() || !window.contentView.children.includes(active.view)) return
    active.view.setVisible(visible)
  }

  async prepareFirstFrame(): Promise<void> {
    const active = this.active
    const window = this.getWindow()
    if (!active || active.state !== 'READY' || !window || window.isDestroyed()) throw new Error('Plugin closed before its first frame.')
    const painted = active.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: `new Promise(resolve => {
      const done = () => requestAnimationFrame(() => resolve())
      if (performance.getEntriesByType('paint').some(entry => entry.name === 'first-contentful-paint')) { done(); return }
      const observer = new PerformanceObserver(entries => {
        if (entries.getEntries().some(entry => entry.name === 'first-contentful-paint')) { observer.disconnect(); done() }
      }); observer.observe({ type: 'paint', buffered: true })
    })` }])
    active.view.setVisible(true)
    // Chrome has staged this actual target at zero opacity. Give Chromium its
    // display surface without activating/revealing it; WPF remains the only
    // visible handoff surface until the ready content has painted.
    window.showInactive()
    await painted
    if (this.active !== active || window.isDestroyed()) throw new Error('Stale first plugin frame.')
    this.startupStage?.('plugin-content-frame')
  }

  openAuthority(authority: WebFeatureAuthority, context?: InvocationTextContext): Promise<WebRuntimeStatus> {
    tracePluginRuntimeAcceptance('runtime-open-authority', { pluginId: authority.snapshot.manifest.id, featureId: authority.featureId })
    if (!isWebFeatureAuthority(authority) || !authority.isCurrent()) return Promise.reject(new Error('Web Feature authority unavailable'))
    return this.open(authority.snapshot, authority.featureId, { authority, context, receivedAtUnixMs: Date.now() })
  }

  async open(snapshot: ValidatedPluginRuntimeSnapshot, featureId: string,
    invocation?: { authority: WebFeatureAuthority; context?: InvocationTextContext; receivedAtUnixMs: number }): Promise<WebRuntimeStatus> {
    tracePluginRuntimeAcceptance('runtime-open-queued', { pluginId: snapshot.manifest.id, featureId })
    const requestGeneration = ++this.requestGeneration
    const diagnosticRequest: { generation?: number } = {}
    const previous = this.active
    const reuse = previous && !invocation && !previous.authority && previous.state === 'READY'
      && previous.snapshot.packageHash === snapshot.packageHash && previous.featureId === featureId
    const preempt = previous && !reuse
      ? this.closeRuntime(previous)
      : Promise.resolve()
    const operation = this.operationQueue.then(async () => {
      tracePluginRuntimeAcceptance('runtime-open-dequeued', { pluginId: snapshot.manifest.id, featureId })
      await preempt
      return this.openInternal(snapshot, featureId, requestGeneration, invocation, diagnosticRequest)
    }).catch(error => {
      if (requestGeneration === this.requestGeneration
        && (diagnosticRequest.generation === undefined || !this.diagnostics?.has(snapshot.manifest.id, diagnosticRequest.generation))
        && !/Stale|runtime closed|authority revoked/i.test(error instanceof Error ? error.message : '')) {
        this.diagnostics?.record({ pluginId: snapshot.manifest.id, featureId, phase: 'runtime', code: 'RUNTIME_INITIALIZATION_FAILED',
          message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined,
          timestamp: Date.now(), runtimeGeneration: diagnosticRequest.generation ?? this.generation })
      }
      throw error
    })
    this.operationQueue = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async openInternal(snapshot: ValidatedPluginRuntimeSnapshot, featureId: string, requestGeneration: number,
    invocation?: { authority: WebFeatureAuthority; context?: InvocationTextContext; receivedAtUnixMs: number },
    diagnosticRequest: { generation?: number } = {}): Promise<WebRuntimeStatus> {
    tracePluginRuntimeAcceptance('runtime-open-internal', { pluginId: snapshot.manifest.id, featureId })
    // Crash teardown starts outside operationQueue; replacement must still wait for it.
    await this.pendingTeardown
    tracePluginRuntimeAcceptance('runtime-after-teardown', { featureId })
    this.assertCurrentRequest(requestGeneration)
    if (this.unavailable) throw new Error('Web Plugin runtime is unavailable after an incomplete security cleanup')
    if (!isValidatedPluginRuntimeSnapshot(snapshot)) throw new TypeError('Web Plugin runtime accepts only Host-validated package snapshots')
    if (invocation && (!isWebFeatureAuthority(invocation.authority) || !invocation.authority.isCurrent()
      || invocation.authority.snapshot !== snapshot || invocation.authority.featureId !== featureId)) throw new Error('Web Feature authority unavailable')
    const selection = selectValidatedWebFeature(snapshot, featureId)
    const existing = this.active
    if (existing && !invocation && !existing.authority && existing.snapshot.packageHash === snapshot.packageHash && existing.featureId === featureId && existing.state === 'READY') return this.status
    // This method already runs inside operationQueue; enqueueing close() here would await itself.
    if (existing) await this.closeRuntime(existing)
    this.assertCurrentRequest(requestGeneration)
    if (this.unavailable) throw new Error('Web Plugin runtime is unavailable after an incomplete security cleanup')
    const window = this.getWindow()
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) throw new Error('Manager window is unavailable')

    const identity = createRuntimeOrigin(invocation?.authority.development?.originIdentity
      ?? (snapshot.manifest.manifestVersion === 3 ? snapshot.manifest.id : undefined))
    const currentSession = await this.getRuntimeSession()
    tracePluginRuntimeAcceptance('runtime-after-session', { featureId })
    this.assertCurrentRequest(requestGeneration)
    if (invocation && !invocation.authority.isCurrent()) throw new Error('Web Feature authority revoked')
    const capabilityDependencies = invocation ? this.getCapabilityDependencies?.(invocation.authority, window) : null
    if (invocation && !capabilityDependencies) throw new Error('Web capabilities unavailable')
    const runtimeGeneration = nextRuntimeGeneration()
    this.generation = runtimeGeneration
    diagnosticRequest.generation = runtimeGeneration
    this.diagnostics?.begin(snapshot.manifest.id, runtimeGeneration, featureId)
    let nodePreload: NodePluginPreloadDescriptor | undefined
    if (snapshot.manifest.manifestVersion === 3 && snapshot.manifest.runtime.kind === 'node') {
      if (!invocation || !this.resolveNodePreload) throw new Error('Node Plugin preload resolver is unavailable')
      tracePluginRuntimeAcceptance('runtime-node-preload-resolving', { pluginId: snapshot.manifest.id, featureId })
      const resolved = await this.resolveNodePreload(invocation.authority)
      tracePluginRuntimeAcceptance('runtime-node-preload-resolved', { pluginId: snapshot.manifest.id, featureId })
      if (resolved.pluginId !== snapshot.manifest.id || resolved.packageHash !== snapshot.packageHash
        || !isAbsolute(resolved.preloadPath) || !isAbsolute(resolved.localDataPath)) throw new Error('Node Plugin preload identity mismatch')
      nodePreload = { ...resolved, generation: runtimeGeneration }
      this.assertCurrentRequest(requestGeneration)
      if (!invocation.authority.isCurrent()) throw new Error('Web Feature authority revoked')
    }
    const view = new WebContentsView({ webPreferences: {
      session: currentSession,
      preload: join(__dirname, '../preload', nodePreload ? 'node-web-plugin.js' : 'web-plugin.js'),
      sandbox: nodePreload === undefined,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
      devTools: false,
      additionalArguments: [
        ...(this.diagnostics?.enabled ? ['--webtools-plugin-developer-diagnostics'] : []),
        ...(isAcceptanceRuntime() ? ['--plugin-runtime-acceptance'] : []),
        ...(invocation ? [
          ...(invocation.authority.isCurrent('sharedAI.complete') ? ['--webtools-plugin-ai'] : []),
          ...(invocation.authority.isCurrent('clipboard.write') ? ['--webtools-plugin-clipboard'] : []),
        ] : []),
        ...(nodePreload ? [`--webtools-plugin-runtime=${Buffer.from(JSON.stringify(nodePreload)).toString('base64url')}`] : []),
      ],
    } })
    const runtime: RuntimeInstance = {
      snapshot, featureId, feature: selection.feature, host: identity.host,
      generation: runtimeGeneration, view, state: 'CREATING', removeView: false,
      entryUrl: buildRuntimeResourceUrl(identity.host, selection.entryPath), documentLoaded: false, initialNavigationStarted: false,
      authority: invocation?.authority,
    }
    this.active = runtime
    if (invocation && capabilityDependencies) {
      try {
        runtime.capabilities = new WebHostCapabilities({ authority: invocation.authority, store: capabilityDependencies.store,
          context: invocation.context ? { ...invocation.context, ageMs: invocation.context.ageMs + Math.max(0, Date.now() - invocation.receivedAtUnixMs) } : undefined,
          isRuntimeCurrent: () => this.active === runtime && runtime.generation === this.generation && runtime.state === 'READY',
          effects: { ...capabilityDependencies.effects, hasForegroundGesture: () => {
            const gestureAt = runtime.gestureAt; runtime.gestureAt = undefined
            return gestureAt !== undefined && performance.now() - gestureAt >= 0 && performance.now() - gestureAt < 5000 && runtime.state === 'READY'
              && this.active === runtime && window.isFocused() && runtime.view.webContents.isFocused()
          } } })
        runtime.removeAuthorityListener = invocation.authority.onRevoke(() => {
          traceAcceptanceRuntime('authority-revoked', { state: runtime.state, featureId: runtime.featureId })
          void this.closeRuntime(runtime)
        })
      } catch (error) { await this.closeRuntime(runtime); throw error }
    }
    try {
      runtime.releaseSession = await pluginRuntimeSession.attach({ contents: view.webContents, window, host: runtime.host,
        snapshot, featureId, authority: invocation?.authority,
        current: () => this.active === runtime && runtime.generation === this.generation
          && !['CLOSING', 'CLOSED', 'FAULTED'].includes(runtime.state) && !view.webContents.isDestroyed()
          && (!runtime.authority || runtime.authority.isCurrent()),
        foregroundGesture: consume => {
          const at = runtime.gestureAt
          const allowed = at !== undefined && performance.now() - at >= 0 && performance.now() - at < 5000
            && runtime.state === 'READY' && window.isFocused() && view.webContents.isFocused()
          if (allowed && consume) runtime.gestureAt = undefined
          return allowed
        },
      })
    } catch (error) { await this.closeRuntime(runtime); throw error }
    runtime.bridge = new WebPluginBridge({
      authenticate: event => this.authenticateBridge(runtime, event),
      send: raw => view.webContents.send(PLUGIN_BRIDGE_HOST_ROUTE, raw),
      onReady: () => {
        if (this.active !== runtime || runtime.generation !== this.generation || runtime.errorCode) return
        traceAcceptanceRuntime('runtime-ready', { featureId: runtime.featureId, generation: runtime.generation })
        this.startupStage?.('runtime-bridge-ready')
        runtime.state = 'READY'; this.diagnostics?.ready(snapshot.manifest.id, runtime.generation, runtime.featureId); this.publish(runtime)
      },
      onFatal: reason => {
        traceAcceptanceRuntime('bridge-fatal', { state: runtime.state, featureId: runtime.featureId, reason })
        this.fault(runtime, 'runtime', 'BRIDGE_INITIALIZATION_FAILED', new Error(reason))
        void this.closeRuntime(runtime)
      },
      dispatchPing: this.runtimeTestOptions.dispatchPing,
      dispatchCapability: runtime.capabilities ? (request, signal) => runtime.capabilities!.dispatch(request, signal) : undefined,
    })
    const receive = (event: Electron.IpcMainEvent, raw: unknown) => runtime.bridge?.receive(event, raw)
    ipcMain.on(PLUGIN_BRIDGE_CLIENT_ROUTE, receive)
    if (isAcceptanceRuntime()) console.log(`[plugin-runtime-acceptance] bridge-listeners=${ipcMain.listenerCount(PLUGIN_BRIDGE_CLIENT_ROUTE)} action=attach generation=${runtime.generation}`)
    runtime.removeBridgeListener = () => {
      ipcMain.removeListener(PLUGIN_BRIDGE_CLIENT_ROUTE, receive)
      if (isAcceptanceRuntime()) console.log(`[plugin-runtime-acceptance] bridge-listeners=${ipcMain.listenerCount(PLUGIN_BRIDGE_CLIENT_ROUTE)} action=detach generation=${runtime.generation}`)
    }
    const preloadFailed = (event: Electron.IpcMainEvent, value: unknown) => {
      if (event.sender !== view.webContents || event.senderFrame !== view.webContents.mainFrame
        || runtime !== this.active || runtime.state !== 'LOADING' || runtime.generation !== this.generation) return
      if (!value || typeof value !== 'object' || (value as Record<string, unknown>).code !== 'NODE_PRELOAD_FAILED') return
      traceAcceptanceRuntime('node-preload-failed', { state: runtime.state, featureId: runtime.featureId })
      const detail = (value as Record<string, unknown>).detail
      const failure = new Error('Node Plugin preload failed integrity or execution checks')
      if (this.diagnostics?.enabled && detail && typeof detail === 'object') {
        const fields = detail as Record<string, unknown>
        if (typeof fields.message === 'string') failure.message = fields.message.slice(0, 4096)
        if (typeof fields.stack === 'string') failure.stack = fields.stack.slice(0, 8192)
      }
      this.fault(runtime, 'preload', 'NODE_PRELOAD_FAILED', failure)
      runtime.rejectLoad?.(new Error('Node Plugin preload failed integrity or execution checks'))
    }
    ipcMain.on(PLUGIN_RUNTIME_PRELOAD_ERROR_ROUTE, preloadFailed)
    runtime.removePreloadErrorListener = () => ipcMain.removeListener(PLUGIN_RUNTIME_PRELOAD_ERROR_ROUTE, preloadFailed)
    view.webContents.on('preload-error', (_event, _path, error) => {
      this.fault(runtime, 'preload', nodePreload ? 'NODE_PRELOAD_FAILED' : 'HOST_BRIDGE_PRELOAD_FAILED', error)
      runtime.rejectLoad?.(new Error('Plugin preload failed'))
    })
    this.publish(runtime)
    tracePluginRuntimeAcceptance('runtime-view-published', { pluginId: snapshot.manifest.id, featureId })
    window.contentView.addChildView(view)
    runtime.removeView = true
    view.setBounds({ x: 1, y: 1, width: 1, height: 1 })
    view.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    view.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && this.handleWindowEscape?.(window, input)) {
        event.preventDefault(); return
      }
      if (input.type === 'keyDown' && !input.isAutoRepeat && !input.control && !input.meta && !input.alt) runtime.gestureAt = performance.now()
    })
    view.webContents.on('before-mouse-event', (_event, input) => {
      if (input.type === 'mouseDown') {
        runtime.gestureAt = performance.now()
        const bounds = view.getBounds()
        this.handlePluginMouseDown?.(window, { x: bounds.x + input.x, y: bounds.y + input.y })
      }
    })
    this.bindNavigationPolicy(runtime)
    runtime.state = 'LOADING'
    this.publish(runtime)
    try {
      await this.load(runtime, runtime.entryUrl)
      await runtime.bridge.ready
      if (this.active !== runtime || runtime.generation !== this.generation || (runtime.state as WebRuntimeState) !== 'READY') throw new Error('Stale Web Plugin runtime load')
      return this.status
    } catch (error) {
      if (!runtime.errorCode) this.fault(runtime, 'runtime', 'PLUGIN_RUNTIME_FAILED', error)
      runtime.removePreloadErrorListener?.(); runtime.removePreloadErrorListener = undefined
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

  waitForTeardown(): Promise<void> { return this.pendingTeardown }
  focus(): void {
    const active = this.active
    if (active?.state === 'READY' && !active.view.webContents.isDestroyed()) active.view.webContents.focus()
  }
  updateContext(context?: InvocationTextContext): void { this.active?.capabilities?.setContext(context) }

  async clearPluginData(pluginId: string): Promise<void> {
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(pluginId) || pluginId.length > 128) throw new TypeError('Invalid plugin identity')
    const active = this.active
    if (active?.snapshot.manifest.manifestVersion === 3 && active.snapshot.manifest.id === pluginId
      && !active.authority?.development) await this.closeRuntime(active)
    await pluginRuntimeSession.clearPluginData(pluginId)
  }

  private describe(runtime: RuntimeInstance): WebRuntimeStatus {
    return Object.freeze({ state: runtime.state, featureId: runtime.featureId, pluginId: runtime.snapshot.manifest.id,
      pluginName: runtime.snapshot.manifest.name, generation: runtime.generation,
      ...(runtime.authority?.development ? { developmentSessionId: runtime.authority.development.sessionId } : {}),
      ...(runtime.errorCode ? { errorCode: runtime.errorCode } : {}) })
  }

  private fault(runtime: RuntimeInstance, phase: 'runtime' | 'preload', code: string, error: unknown): void {
    if (this.active !== runtime || runtime.generation !== this.generation || ['CLOSING', 'CLOSED'].includes(runtime.state)) return
    runtime.errorCode = code
    const manifest = runtime.snapshot.manifest
    this.diagnostics?.record({ pluginId: manifest.id, featureId: runtime.featureId, phase, code,
      message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined,
      source: phase === 'preload' && manifest.manifestVersion === 3 && manifest.runtime.kind === 'node'
        ? manifest.runtime.preload : runtime.feature.entry.kind === 'web-bundle' ? runtime.feature.entry.document : runtime.feature.entry.module,
      timestamp: Date.now(), runtimeGeneration: runtime.generation })
  }

  private publish(runtime: RuntimeInstance): void {
    const status = this.describe(runtime)
    for (const listener of [...this.listeners]) {
      try { listener(status) } catch { /* A UI observer cannot break runtime lifecycle. */ }
    }
  }

  private getRuntimeSession(): Promise<Session> { return pluginRuntimeSession.get() }

  private acceptsTheme(runtime: RuntimeInstance): boolean {
    return this.active === runtime && runtime.generation === this.generation
      && ['LOADING', 'READY'].includes(runtime.state) && !runtime.view.webContents.isDestroyed()
      && (!runtime.authority || runtime.authority.isCurrent())
  }

  private async removeThemeStyles(runtime: RuntimeInstance, keep?: string): Promise<void> {
    for (const key of runtime.themeKeys ?? []) {
      if (key === keep) continue
      try {
        if (!runtime.view.webContents.isDestroyed()) await runtime.view.webContents.removeInsertedCSS(key)
        runtime.themeKeys?.delete(key)
      } catch { console.warn('[plugin-theme] Could not remove a retired theme stylesheet.') }
    }
  }

  private updateTheme(runtime: RuntimeInstance): Promise<void> {
    const work = (runtime.themeWork ?? Promise.resolve()).then(async () => {
      if (!this.themeSource || !this.acceptsTheme(runtime)) return
      const theme = this.themeSource.current
      const css = theme.css
      if (runtime.themeCss === css) return
      try {
        const key = await runtime.view.webContents.insertCSS(css)
        ;(runtime.themeKeys ??= new Set()).add(key)
        if (!this.acceptsTheme(runtime)) { await this.removeThemeStyles(runtime); return }
        runtime.themeCss = css
        traceAcceptanceRuntime('theme-applied', { featureId: runtime.featureId, generation: runtime.generation, scheme: theme.scheme })
        await this.removeThemeStyles(runtime, key)
      } catch { console.warn('[plugin-theme] Theme stylesheet unavailable; plugin fallback or previous style remains active.') }
    })
    runtime.themeWork = work
    return work
  }

  private async prepareTheme(runtime: RuntimeInstance): Promise<void> {
    runtime.removeThemeListener = this.themeSource?.subscribe(() => { void this.updateTheme(runtime) })
    let pending = this.updateTheme(runtime)
    // A settings change during insertion must settle before the first visible frame.
    while (this.acceptsTheme(runtime)) {
      await pending
      if (pending === runtime.themeWork) return
      pending = runtime.themeWork!
    }
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
        console.log(`[plugin-runtime-acceptance] navigation-denied scheme=${scheme}`)
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
      traceAcceptanceRuntime('navigation-start', {
        url: details.url, isMainFrame: details.isMainFrame, isSameDocument: details.isSameDocument,
        initialNavigationStarted: runtime.initialNavigationStarted, documentLoaded: runtime.documentLoaded,
        expectedUrl: runtime.entryUrl, state: runtime.state,
      })
      if (!details.isMainFrame || details.isSameDocument) return
      if (runtime.initialNavigationStarted || runtime.documentLoaded || details.url !== runtime.entryUrl) {
        void this.closeRuntime(runtime)
      } else runtime.initialNavigationStarted = true
    })
    contents.on('unresponsive', () => {
      traceAcceptanceRuntime('web-contents-unresponsive', { state: runtime.state, featureId: runtime.featureId })
      this.fault(runtime, 'runtime', 'PLUGIN_RENDERER_UNRESPONSIVE', new Error('Plugin renderer stopped responding.'))
      void this.closeRuntime(runtime)
    })
    contents.on('destroyed', () => {
      traceAcceptanceRuntime('web-contents-destroyed', { state: runtime.state, featureId: runtime.featureId })
      if (runtime.state !== 'CLOSING' && runtime.state !== 'CLOSED') void this.closeRuntime(runtime)
    })
    contents.on('render-process-gone', (_event, details) => {
      traceAcceptanceRuntime('render-process-gone', { state: runtime.state, featureId: runtime.featureId, ...details })
      if (this.active !== runtime || runtime.state === 'CLOSING' || runtime.state === 'CLOSED') return
      this.fault(runtime, 'runtime', 'PLUGIN_RENDERER_CRASHED', new Error(`Plugin renderer exited (${details.reason}, ${details.exitCode}).`))
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
        traceAcceptanceRuntime('document-finished', { url: contents.getURL(), state: runtime.state })
        runtime.documentLoaded = true
        const ready = () => {
          if (this.active !== runtime || !['LOADING', 'READY'].includes(runtime.state)) return
          cleanup()
          runtime.bridge?.documentLoaded()
          resolve()
        }
        if (!this.themeSource) ready()
        else void this.prepareTheme(runtime).then(ready).catch(error => runtime.rejectLoad?.(error))
      }
      const failed = (_event: Electron.Event, code: number, description: string, _url: string, isMainFrame: boolean) => {
        traceAcceptanceRuntime('did-fail-load', { code, description, url: _url, isMainFrame, state: runtime.state })
        if (!isMainFrame || code === -3) return
        cleanup(); reject(new Error(`Web Plugin document failed to load (${code}): ${description}`))
      }
      const crashed = (_event: Electron.Event, details: Electron.RenderProcessGoneDetails) => {
        traceAcceptanceRuntime('renderer-exited-during-load', { ...details, state: runtime.state })
        cleanup(); reject(new Error('Web Plugin renderer process exited during load'))
      }
      runtime.rejectLoad = error => {
        traceAcceptanceRuntime('load-rejected', { message: error.message, state: runtime.state, featureId: runtime.featureId })
        cleanup(); reject(error)
      }
      contents.once('did-finish-load', finish)
      contents.on('did-fail-load', failed)
      contents.once('render-process-gone', crashed)
      runtime.timeout = setTimeout(() => runtime.rejectLoad?.(new Error('Web Plugin load timed out')), LOAD_TIMEOUT_MS)
      runtime.timeout.unref?.()
    })
    void contents.loadURL(url).catch(error => {
      traceAcceptanceRuntime('loadURL-rejected', { message: error instanceof Error ? error.message : String(error), url })
      runtime.rejectLoad?.(error instanceof Error ? error : new Error('Web Plugin navigation failed'))
    })
    await result
  }

  private assertCurrentRequest(requestGeneration: number): void {
    if (requestGeneration !== this.requestGeneration) throw new Error('Stale Web Plugin runtime request')
  }

  private authenticateBridge(runtime: RuntimeInstance, value: unknown): 'current' | 'invalid' | 'unrelated' {
    const event = value as Electron.IpcMainEvent
    const contents = runtime.view.webContents
    if (event.sender !== contents) return 'unrelated'
    let reason: string | undefined
    if (this.active !== runtime) reason = 'not-active'
    else if (runtime.generation !== this.generation) reason = 'generation-mismatch'
    else if (!['LOADING', 'READY'].includes(runtime.state)) reason = 'state'
    else if (contents.isDestroyed()) reason = 'contents-destroyed'
    else if (!event.senderFrame) reason = 'no-sender-frame'
    else if (event.senderFrame !== contents.mainFrame) reason = 'frame-not-main'
    else if (event.senderFrame.detached) reason = 'frame-detached'
    else {
      const frameUrl = event.senderFrame.url
      const contentsUrl = contents.getURL()
      const allowBlankInitialUrl = runtime.state === 'LOADING' && runtime.initialNavigationStarted && !runtime.documentLoaded
      if (frameUrl === '') {
        if (!allowBlankInitialUrl) reason = 'frame-url'
      } else if (frameUrl.split(/[?#]/, 1)[0] !== runtime.entryUrl) reason = 'frame-url'
      if (!reason && contentsUrl === '') {
        if (!allowBlankInitialUrl) reason = 'contents-url'
      } else if (!reason && contentsUrl.split(/[?#]/, 1)[0] !== runtime.entryUrl) reason = 'contents-url'
    }
    if (!reason) {
      if (!isValidatedPluginRuntimeSnapshot(runtime.snapshot)) reason = 'snapshot-invalid'
      else if (runtime.feature.id !== runtime.featureId || !runtime.snapshot.manifest.features.some(feature => feature === runtime.feature)) reason = 'feature-invalid'
      else if (runtime.authority && !runtime.authority.isCurrent()) reason = 'authority-revoked'
    }
    if (reason) {
      traceAcceptanceRuntime('bridge-authentication-invalid', { state: runtime.state, featureId: runtime.featureId, reason,
        senderFrameUrl: event.senderFrame?.url, contentsUrl: contents.isDestroyed() ? null : contents.getURL(), expectedUrl: runtime.entryUrl })
      return 'invalid'
    }
    return 'current'
  }

  private closeRuntime(runtime: RuntimeInstance): Promise<void> {
    if (runtime.closePromise) return runtime.closePromise
    traceAcceptanceRuntime('close-requested', { state: runtime.state, featureId: runtime.featureId, stack: new Error().stack })
    runtime.closePromise = this.performCloseRuntime(runtime)
    this.pendingTeardown = runtime.closePromise
    return runtime.closePromise
  }

  private async performCloseRuntime(runtime: RuntimeInstance): Promise<void> {
    if (runtime.state === 'CLOSED') return
    runtime.state = 'CLOSING'
    if (this.active === runtime) this.active = null // Revoke generation and protocol access before touching WebContents.
    runtime.removeThemeListener?.(); runtime.removeThemeListener = undefined
    void this.removeThemeStyles(runtime)
    runtime.gestureAt = undefined
    runtime.removeAuthorityListener?.(); runtime.removeAuthorityListener = undefined
    runtime.capabilities?.dispose(); runtime.capabilities = undefined
    runtime.authority?.revoke()
    const bridgeClosed = runtime.bridge?.revoke()
    runtime.removeBridgeListener?.()
    runtime.removeBridgeListener = undefined
    runtime.removePreloadErrorListener?.()
    runtime.removePreloadErrorListener = undefined
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
      if (runtime.releaseSession) {
        let cleanupTimer: NodeJS.Timeout | undefined
        try {
          await Promise.race([
            runtime.releaseSession(),
            new Promise<never>((_, reject) => { cleanupTimer = setTimeout(() => reject(new Error('Web Plugin Session cleanup timed out')), CLEANUP_TIMEOUT_MS); cleanupTimer.unref?.() }),
          ])
        } finally { clearTimeout(cleanupTimer) }
      }
    } catch (error) {
      this.unavailable = true
      if (isAcceptanceRuntime()) console.error(`[plugin-runtime-acceptance] storage-cleanup=failed reason=${error instanceof Error ? error.message : 'unknown'}`)
    }
    runtime.state = 'CLOSED'
    runtime.releaseSession = undefined
    this.generation = nextRuntimeGeneration()
    this.publish(runtime)
  }
}

function isAcceptanceRuntime(): boolean {
  return process.argv.includes('--plugin-runtime-acceptance') && process.env.WEBTOOLS_PLUGIN_RUNTIME_ACCEPTANCE === '1'
}

function traceAcceptanceRuntime(event: string, details: Record<string, unknown>): void {
  if (!isAcceptanceRuntime()) return
  const record = { at: new Date().toISOString(), event, details }
  console.log(`[plugin-runtime-trace] ${JSON.stringify(record)}`)
  const isolatedProfile = process.env.WEBTOOLS_PLUGIN_RUNTIME_TEST_PROFILE
  if (!isolatedProfile || !isAbsolute(isolatedProfile)) return
  try { appendFileSync(join(isolatedProfile, 'plugin-runtime-trace.jsonl'), `${JSON.stringify(record)}\n`, 'utf8') } catch { /* Acceptance diagnostics cannot affect runtime behavior. */ }
}
