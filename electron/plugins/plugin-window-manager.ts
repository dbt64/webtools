import { BrowserWindow, nativeImage, screen, WebContentsView, type NativeImage, type WebContents, type WebFrameMain } from 'electron'
import type { FeatureRef, FeaturePresentation } from '../../src/shared/feature-contracts.ts'
import { isWebFeatureAuthority, type WebFeatureAuthority } from './web-feature-authority.ts'
import { WebPluginRuntime } from './web-plugin-runtime.ts'
import type { InvocationTextContext } from './web-host-capabilities.ts'
import type { PluginThemeSource } from './plugin-window-theme.ts'
import { PLUGIN_WINDOW_CHROME_CHANNELS, type PluginWindowAction, type PluginWindowChromeState, type PluginWindowMode } from './plugin-window-chrome-contract.ts'

const TITLEBAR_HEIGHT = 42
interface WindowEntry {
  kind: 'feature'
  key: string
  ref: FeatureRef
  developmentSessionId?: string
  window: BrowserWindow
  runtime: WebPluginRuntime
  opening?: Promise<void>
  closing?: Promise<void>
  restarting: boolean
  packageHash: string
  blurBehavior: 'temporary-hide' | 'background'
  presentationMode: PluginWindowMode
  title: string
  iconDataUrl: string
  loading: boolean
  previousTemporaryTarget?: TemporaryTarget
  chromeReady: Promise<void>
  menuOverlay?: WebContentsView
  menuOverlayReady?: Promise<void>
  menuOpen: boolean
  alwaysOnTop: boolean
  returning?: Promise<void>
}
interface ManagerEntry {
  kind: 'manager'
  window: BrowserWindow
  close(): Promise<void>
  closing?: Promise<void>
  returning?: Promise<void>
}
type TemporaryTarget = WindowEntry | ManagerEntry
function key(authority: WebFeatureAuthority): string {
  return `${authority.development?.sessionId ?? 'installed'}\0${authority.snapshot.manifest.id}\0${authority.featureId}`
}

/** Owns presentation windows; package authority and execution stay in Runtime 2.0. */
export class PluginWindowManager {
  private readonly windows = new Map<string, WindowEntry>()
  private readonly closing = new Map<WindowEntry, Promise<void>>()
  private pendingReloads = 0
  private currentTemporaryTarget: TemporaryTarget | null = null
  private managerEntry: ManagerEntry | null = null
  private shuttingDown = false
  private readonly unsubscribeTheme: () => void
  constructor(private readonly deps: {
    createRuntime(getWindow: () => BrowserWindow | null): WebPluginRuntime
    defaultIcon: string
    chromePreload?: string
    onSurfacesChanged(): void
    theme: PluginThemeSource
    hasPendingHostDialogs?(window: BrowserWindow): boolean
    returnToLauncher?(): Promise<boolean>
    loadChrome?(window: BrowserWindow): Promise<void>
    presentWindow?(window: BrowserWindow): Promise<void>
    startupStage?(stage: string): void
    loadMenuOverlay?(view: WebContentsView): Promise<void>
    openPluginManager?(ref: { kind: 'web'; id: string; featureId: string }, section: 'about' | 'settings'): Promise<void>
  }) {
    this.unsubscribeTheme = deps.theme.subscribe(theme => {
      for (const entry of this.windows.values()) {
        try {
          if (!entry.window.isDestroyed()) entry.window.setBackgroundColor(theme.backgroundColor)
          this.publishChromeState(entry)
        }
        catch { console.warn('[plugin-theme] Could not update a closing Plugin Window background.') }
      }
    })
  }
  get hasSurfaces(): boolean { return this.managerEntry !== null || this.windows.size > 0 || this.closing.size > 0 || this.pendingReloads > 0 }
  clearTemporaryTarget(): void { this.currentTemporaryTarget = null }
  registerManagerWindow(window: BrowserWindow, close: () => Promise<void>): void {
    const entry: ManagerEntry = { kind: 'manager', window, close }
    this.managerEntry = entry
    window.on('focus', () => this.rememberFocused(entry))
    window.on('blur', () => this.settleBlur(entry))
    window.on('closed', () => {
      if (this.currentTemporaryTarget === entry) this.clearTemporaryTarget()
      if (this.managerEntry === entry) this.managerEntry = null
      this.deps.onSurfacesChanged()
    })
    this.bindEscape(window)
  }
  activateBackgroundWindow(): void {
    const previous = this.currentTemporaryTarget
    if (previous?.kind === 'feature' && previous.presentationMode === 'detached') return
    this.clearTemporaryTarget()
    if (previous && this.shouldCloseWhenSwitched(previous)) this.closeSwitchedTarget(previous)
  }
  private shouldCloseWhenSwitched(entry: TemporaryTarget): boolean {
    return entry.kind === 'manager' || entry.presentationMode === 'attached' && entry.blurBehavior === 'temporary-hide'
  }
  private closeSwitchedTarget(entry: TemporaryTarget): void {
    void this.closeTemporaryTarget(entry).catch(() => console.warn('[plugin-window] Previous temporary interface could not be closed.'))
  }
  private closeTemporaryTarget(entry: TemporaryTarget): Promise<void> {
    if (entry.kind === 'feature') return this.closeEntry(entry)
    if (this.currentTemporaryTarget === entry) this.clearTemporaryTarget()
    return entry.closing ??= Promise.resolve().then(() => entry.close())
  }
  clearInstalledTemporaryTarget(pluginId: string): void {
    const entry = this.currentTemporaryTarget
    if (entry?.kind === 'feature' && entry.ref.pluginId === pluginId && !entry.developmentSessionId) this.clearTemporaryTarget()
  }
  clearDevelopmentTemporaryTarget(sessionId: string): void {
    const entry = this.currentTemporaryTarget
    if (entry?.kind === 'feature' && entry.developmentSessionId === sessionId) this.clearTemporaryTarget()
  }
  focusCurrentTemporaryWindow(): boolean {
    const entry = this.currentTemporaryTarget
    if (!entry) return false
    if (entry.window.isDestroyed() || entry.closing || (entry.kind === 'manager' ? this.managerEntry !== entry
      : this.windows.get(entry.key) !== entry || (!entry.loading && (entry.restarting || entry.runtime.status.state !== 'READY')))) {
      this.clearTemporaryTarget(); return false
    }
    return this.focus(entry)
  }
  private rememberFocused(entry: TemporaryTarget): void {
    if (entry.closing || !entry.window.isFocused() || entry.kind === 'feature'
      && !entry.loading && (entry.restarting || entry.runtime.status.state !== 'READY')) return
    const previous = this.currentTemporaryTarget
    this.currentTemporaryTarget = entry.kind === 'manager' || entry.presentationMode === 'detached' || entry.blurBehavior === 'temporary-hide' ? entry : null
    if (previous && previous !== entry && this.shouldCloseWhenSwitched(previous)) {
      if (entry.kind === 'feature' && entry.loading) entry.previousTemporaryTarget ??= previous
      else this.closeSwitchedTarget(previous)
    }
  }
  private settleBlur(entry: TemporaryTarget): void {
    // Recheck after native focus/minimize events have settled; this is not an expiry timer.
    setImmediate(() => {
      if ((entry.kind === 'manager' ? this.managerEntry !== entry : this.windows.get(entry.key) !== entry
        || entry.restarting && !entry.loading) || entry.window.isDestroyed() || entry.closing
        || entry.window.isMinimized() || entry.window.isFocused() || this.deps.hasPendingHostDialogs?.(entry.window)) return
      if (entry.kind === 'feature') this.closeMenuOverlay(entry)
      if (entry.kind === 'manager' || entry.presentationMode === 'attached' && entry.blurBehavior === 'temporary-hide') entry.window.hide()
    })
  }
  hostDialogsClosed(window: BrowserWindow): void {
    const entry = this.managerEntry?.window === window ? this.managerEntry : [...this.windows.values()].find(item => item.window === window)
    if (entry) this.settleBlur(entry)
  }
  handleEscape(window: BrowserWindow): boolean {
    const entry = this.managerEntry?.window === window ? this.managerEntry : [...this.windows.values()].find(item => item.window === window)
    if (!entry || entry.closing || entry.kind === 'feature'
      && !entry.loading && (entry.restarting || entry.runtime.status.state !== 'READY')
      || this.deps.hasPendingHostDialogs?.(window)) return false
    if (entry.kind === 'feature' && entry.presentationMode === 'detached') {
      void this.endPluginRun(entry).catch(() => console.warn('[plugin-window] Ending the detached Feature failed.'))
      return true
    }
    if (entry.returning) return true
    if (!this.deps.returnToLauncher) return false
    entry.returning = this.deps.returnToLauncher().then(async shown => {
      if (!shown) return
      if (entry.kind === 'manager') await this.closeTemporaryTarget(entry)
      else if (entry.blurBehavior === 'temporary-hide') await this.closeTemporaryTarget(entry)
    }).catch(() => console.warn('[plugin-window] Returning to Launcher failed.')).finally(() => { entry.returning = undefined })
    return true
  }
  handleInput(window: BrowserWindow, input: { key: string; type: string; isAutoRepeat?: boolean; control?: boolean; meta?: boolean; alt?: boolean; shift?: boolean }): boolean {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return false
    if (input.key === 'Escape' && !input.control && !input.meta && !input.alt && !input.shift) return this.handleEscape(window)
    if (input.key.toLowerCase() === 'd' && input.control && !input.meta && !input.alt && !input.shift) {
      const entry = [...this.windows.values()].find(item => item.window === window)
      if (!entry || entry.closing || entry.restarting || entry.runtime.status.state !== 'READY' || entry.presentationMode === 'detached') return false
      this.detach(entry)
      return true
    }
    return false
  }
  private bindEscape(window: BrowserWindow): void {
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape' && !input.isAutoRepeat
        && !input.control && !input.meta && !input.alt && !input.shift && this.handleEscape(window)) event.preventDefault()
    })
  }
  private bindFeatureInput(window: BrowserWindow): void {
    window.webContents.on('before-input-event', (event, input) => {
      if (this.handleInput(window, input)) event.preventDefault()
    })
  }
  private focus(entry: TemporaryTarget): boolean {
    if (entry.window.isDestroyed()) return false
    if (entry.window.isMinimized()) entry.window.restore()
    entry.window.show(); entry.window.focus()
    if (entry.kind === 'feature') entry.runtime.focus()
    this.rememberFocused(entry)
    return entry.window.isFocused()
  }
  private icon(authority: WebFeatureAuthority): string | NativeImage {
    const manifest = authority.snapshot.manifest
    const target = manifest.features.find(feature => feature.id === authority.featureId)
    const icon = target?.icon?.kind === 'asset' ? target.icon : manifest.features.find(feature => feature.icon?.kind === 'asset')?.icon
    if (icon?.kind === 'asset') {
      const bytes = authority.snapshot.getResource(icon.path)?.bytes
      if (bytes) { const image = nativeImage.createFromBuffer(bytes); if (!image.isEmpty()) return image }
    }
    return this.deps.defaultIcon
  }
  private iconDataUrl(authority: WebFeatureAuthority): string {
    const icon = this.icon(authority)
    const image = typeof icon === 'string' ? nativeImage.createFromPath(icon) : icon
    return image.isEmpty() ? '' : image.toDataURL()
  }
  private chromeState(entry: WindowEntry): PluginWindowChromeState {
    return { title: entry.title, iconDataUrl: entry.iconDataUrl, mode: entry.presentationMode,
      alwaysOnTop: entry.alwaysOnTop, maximized: entry.window.isMaximized(), loading: entry.loading, themeCss: this.deps.theme.current.css }
  }
  private publishChromeState(entry: WindowEntry): void {
    if (entry.window.isDestroyed() || entry.window.webContents.isDestroyed()) return
    const state = this.chromeState(entry)
    entry.window.webContents.send(PLUGIN_WINDOW_CHROME_CHANNELS.state, state)
    if (entry.menuOverlay && !entry.menuOverlay.webContents.isDestroyed()) entry.menuOverlay.webContents.send(PLUGIN_WINDOW_CHROME_CHANNELS.state, state)
  }
  windowGeometryChanged(window: BrowserWindow): void {
    const entry = [...this.windows.values()].find(item => item.window === window)
    if (entry) this.positionMenuOverlay(entry)
  }
  getChromeState(window: BrowserWindow): PluginWindowChromeState | null {
    const entry = [...this.windows.values()].find(item => item.window === window)
    return entry && !entry.closing ? this.chromeState(entry) : null
  }
  chromeOwnerFor(sender: WebContents, senderFrame: WebFrameMain | null): BrowserWindow | null {
    if (!senderFrame || senderFrame !== sender.mainFrame) return null
    const entry = [...this.windows.values()].find(item => !item.closing
      && (item.window.webContents === sender || item.menuOverlay?.webContents === sender))
    return entry?.window ?? null
  }
  async performChromeAction(window: BrowserWindow, action: unknown): Promise<boolean> {
    const entry = [...this.windows.values()].find(item => item.window === window)
    const actions: readonly PluginWindowAction[] = ['toggle-menu', 'close-menu', 'detach', 'about', 'settings', 'exit-background', 'end-run', 'pin', 'minimize', 'toggle-maximize', 'close']
    if (!entry || entry.closing || !actions.includes(action as PluginWindowAction)) return false
    switch (action as PluginWindowAction) {
      case 'toggle-menu':
        if (entry.menuOpen) { this.closeMenuOverlay(entry); return true }
        try {
          const overlay = await this.ensureMenuOverlay(entry)
          this.positionMenuOverlay(entry)
          entry.menuOpen = true
          overlay.setVisible(true)
          this.publishChromeState(entry)
          return true
        } catch {
          return false
        }
      case 'close-menu':
        this.closeMenuOverlay(entry); return true
      case 'detach':
        if (entry.restarting || entry.runtime.status.state !== 'READY' || entry.presentationMode === 'detached') return false
        this.detach(entry); this.closeMenuOverlay(entry); return true
      case 'about':
      case 'settings':
        await this.deps.openPluginManager?.({ kind: 'web', id: entry.ref.pluginId, featureId: entry.ref.featureId }, action as 'about' | 'settings')
        this.closeMenuOverlay(entry)
        return true
      case 'exit-background':
        return this.exitToBackground(entry)
      case 'end-run':
        return this.endPluginRun(entry)
      case 'pin':
        entry.alwaysOnTop = !entry.alwaysOnTop
        entry.window.setAlwaysOnTop(entry.alwaysOnTop)
        this.publishChromeState(entry); this.closeMenuOverlay(entry); return true
      case 'minimize':
        this.closeMenuOverlay(entry); entry.window.minimize(); return true
      case 'toggle-maximize':
        if (entry.window.isMaximized()) entry.window.unmaximize(); else entry.window.maximize()
        this.publishChromeState(entry); this.closeMenuOverlay(entry); return true
      case 'close':
        if (entry.presentationMode === 'detached') return this.endPluginRun(entry)
        return this.closeAttached(entry)
    }
  }
  handlePluginMouseDown(window: BrowserWindow, point: { x: number; y: number }): void {
    const entry = [...this.windows.values()].find(item => item.window === window)
    if (!entry?.menuOpen || !entry.menuOverlay) return
    const bounds = entry.menuOverlay.getBounds()
    if (point.x < bounds.x || point.x >= bounds.x + bounds.width || point.y < bounds.y || point.y >= bounds.y + bounds.height) {
      this.closeMenuOverlay(entry)
    }
  }
  private async ensureMenuOverlay(entry: WindowEntry): Promise<WebContentsView> {
    let overlay = entry.menuOverlay
    if (!overlay || overlay.webContents.isDestroyed()) {
      overlay = new WebContentsView({ webPreferences: {
        ...(this.deps.chromePreload ? { preload: this.deps.chromePreload } : {}),
        sandbox: true, nodeIntegration: false, contextIsolation: true, webviewTag: false,
      } })
      overlay.setBackgroundColor('#00000000')
      overlay.setVisible(false)
      overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      overlay.webContents.on('will-navigate', event => event.preventDefault())
      overlay.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && this.handleInput(entry.window, input)) event.preventDefault()
      })
      entry.menuOverlay = overlay
      const ready = (async () => {
        if (!this.deps.loadMenuOverlay) throw new Error('Plugin menu overlay loader unavailable.')
        await this.deps.loadMenuOverlay(overlay!)
        if (entry.closing || entry.window.isDestroyed() || overlay!.webContents.isDestroyed()) throw new Error('Plugin menu overlay closed during initialization.')
        entry.window.contentView.addChildView(overlay!)
        this.positionMenuOverlay(entry)
        this.publishChromeState(entry)
      })()
      entry.menuOverlayReady = ready
      try { await ready }
      catch (error) {
        entry.window.contentView.removeChildView(overlay)
        if (entry.menuOverlay === overlay) { entry.menuOverlay = undefined; entry.menuOverlayReady = undefined }
        if (!overlay.webContents.isDestroyed()) overlay.webContents.close()
        throw error
      }
    } else if (entry.menuOverlayReady) {
      await entry.menuOverlayReady
      // A development reload adds a replacement plugin view after this overlay.
      // Re-adding the existing view keeps it topmost without changing the WindowEntry.
      entry.window.contentView.addChildView(overlay)
    }
    this.positionMenuOverlay(entry)
    return overlay
  }
  private positionMenuOverlay(entry: WindowEntry): void {
    const overlay = entry.menuOverlay
    if (!overlay || overlay.webContents.isDestroyed() || entry.window.isDestroyed()) return
    const [width, height] = entry.window.getContentSize()
    const overlayWidth = Math.min(224, width)
    const overlayHeight = Math.min(222, Math.max(1, height - 38))
    overlay.setBounds({ x: Math.max(0, width - overlayWidth - 9), y: 38, width: overlayWidth, height: overlayHeight })
  }
  private closeMenuOverlay(entry: WindowEntry): void {
    entry.menuOpen = false
    if (entry.menuOverlay && !entry.menuOverlay.webContents.isDestroyed()) entry.menuOverlay.setVisible(false)
  }
  private detach(entry: WindowEntry): void {
    entry.presentationMode = 'detached'
    const current = entry.window.getBounds()
    const area = screen.getDisplayMatching(current).workArea
    const width = Math.min(area.width, Math.max(current.width + 160, Math.round(current.width * 1.2)))
    const height = Math.min(area.height, Math.max(current.height + 120, Math.round(current.height * 1.2)))
    const left = Math.round(current.x + current.width / 2 - width / 2)
    const top = Math.round(current.y + current.height / 2 - height / 2)
    entry.window.setBounds({
      x: Math.max(area.x, Math.min(left, area.x + area.width - width)),
      y: Math.max(area.y, Math.min(top, area.y + area.height - height)),
      width,
      height,
    })
    this.publishChromeState(entry)
    this.rememberFocused(entry)
  }
  private hideToBackground(entry: WindowEntry): void {
    if (this.currentTemporaryTarget === entry) this.clearTemporaryTarget()
    this.closeMenuOverlay(entry)
    if (!entry.window.isDestroyed()) entry.window.hide()
  }
  private async exitToBackground(entry: WindowEntry): Promise<boolean> {
    if (entry.returning) {
      await entry.returning
      if (entry.window.isDestroyed() || !entry.window.isVisible()) return true
    }
    if (!this.deps.returnToLauncher) return false
    let exited = false
    entry.returning = this.deps.returnToLauncher().then(shown => { if (shown) { this.hideToBackground(entry); exited = true } })
      .catch(() => console.warn('[plugin-window] Returning to Launcher failed.')).finally(() => { entry.returning = undefined })
    await entry.returning
    return exited
  }
  private async closeAttached(entry: WindowEntry): Promise<boolean> {
    if (entry.returning) {
      await entry.returning
      if (entry.closing || entry.window.isDestroyed()) return true
    }
    if (!this.deps.returnToLauncher) return false
    entry.returning = this.deps.returnToLauncher().then(async shown => { if (shown) await this.closeEntry(entry) })
      .catch(() => console.warn('[plugin-window] Closing the Feature window failed.')).finally(() => { entry.returning = undefined })
    await entry.returning
    return Boolean(entry.closing)
  }
  private async endPluginRun(entry: WindowEntry): Promise<boolean> {
    if (entry.closing || entry.window.isDestroyed()) return true
    if (entry.returning) {
      await entry.returning
      if (entry.closing || entry.window.isDestroyed()) return true
    }
    if (!this.windows.has(entry.key) && !this.closing.has(entry)) return true
    const ending = (async () => {
      try { await this.deps.returnToLauncher?.() }
      catch { console.warn('[plugin-window] Returning to Launcher before ending the Feature failed.') }
      await this.closePluginIdentity(entry)
    })()
    entry.returning = ending
    try {
      await ending
      return true
    } finally {
      if (entry.returning === ending) entry.returning = undefined
    }
  }
  private closePluginIdentity(entry: WindowEntry): Promise<void> {
    const entries = new Set([...this.windows.values(), ...this.closing.keys()])
    return Promise.all([...entries].filter(candidate => candidate.ref.pluginId === entry.ref.pluginId
      && candidate.developmentSessionId === entry.developmentSessionId).map(candidate => this.closeEntry(candidate))).then(() => undefined)
  }
  async open(authority: WebFeatureAuthority, context?: InvocationTextContext): Promise<void> {
    const receivedAt = Date.now()
    const currentContext = () => context ? { ...context, ageMs: context.ageMs + Math.max(0, Date.now() - receivedAt) } : undefined
    if (this.shuttingDown || !isWebFeatureAuthority(authority) || !authority.isCurrent()) throw new Error('Feature authority unavailable.')
    const manifest = authority.snapshot.manifest
    if (manifest.manifestVersion !== 3) throw new Error('Independent Feature windows require Manifest v3.')
    const identity = key(authority)
    const feature = manifest.features.find(item => item.id === authority.featureId)!
    const preferences: Extract<FeaturePresentation, { type: 'window' }> = feature.presentation?.type === 'window' ? feature.presentation : { type: 'window' }
    let entry = this.windows.get(identity)
    if (entry?.closing) { await entry.closing; entry = this.windows.get(identity) }
    if (entry?.opening) { await entry.opening.catch(() => {}); entry = this.windows.get(identity) }
    if (!authority.isCurrent()) throw new Error('Feature authority revoked during activation.')
    if (entry && entry.packageHash === authority.snapshot.packageHash && entry.runtime.status.state === 'READY') {
      try {
        entry.runtime.updateContext(currentContext())
        if (this.deps.presentWindow) await this.deps.presentWindow(entry.window)
        this.focus(entry)
      } finally { authority.revoke() }
      return
    }
    if (!entry) {
      const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
      const minWidth = Math.min(area.width, Math.max(240, preferences.minWidth ?? 360))
      const minHeight = Math.min(area.height, Math.max(160, preferences.minHeight ?? 260))
      const width = Math.min(area.width, Math.max(minWidth, preferences.defaultWidth ?? 960))
      const height = Math.min(area.height, Math.max(minHeight, preferences.defaultHeight ?? 680))
      const window = new BrowserWindow({ title: feature.title || manifest.name, icon: this.icon(authority),
        width, height, minWidth, minHeight, x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2),
        resizable: preferences.resizable ?? true, show: false, frame: false, autoHideMenuBar: true, backgroundColor: this.deps.theme.current.backgroundColor,
        // The shell gets only the fixed Host chrome API. The child Runtime owns
        // the plugin document and its separate Web/Node bootstrap preferences.
        webPreferences: { ...(this.deps.chromePreload ? { preload: this.deps.chromePreload } : {}), sandbox: true, nodeIntegration: false, contextIsolation: true, webviewTag: false },
      })
      this.deps.startupStage?.('browser-window-created')
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.setMenu(null)
      window.webContents.on('will-navigate', event => event.preventDefault())
      const runtime = this.deps.createRuntime(() => window.isDestroyed() ? null : window)
      const title = feature.title || manifest.name
      entry = { kind: 'feature', key: identity, ref: { pluginId: authority.snapshot.manifest.id, featureId: authority.featureId },
        developmentSessionId: authority.development?.sessionId, window, runtime, restarting: false, packageHash: authority.snapshot.packageHash,
        blurBehavior: preferences.blurBehavior ?? 'temporary-hide', presentationMode: 'attached', title,
        iconDataUrl: this.iconDataUrl(authority), loading: true,
        chromeReady: this.deps.loadChrome?.(window) ?? Promise.resolve(), menuOpen: false, alwaysOnTop: false }
      this.windows.set(identity, entry)
      const owned = entry
      this.bindFeatureInput(window)
      const bounds = () => { if (!window.isDestroyed()) { const [width, height] = window.getContentSize(); runtime.setBounds({ x: 0, y: TITLEBAR_HEIGHT, width, height: height - TITLEBAR_HEIGHT }); runtime.setVisible(!owned.loading); this.windowGeometryChanged(window) } }
      const unsubscribe = runtime.subscribe(status => {
        bounds()
        if (status.state === 'FAULTED' || status.state === 'CLOSED' && !owned.restarting && !owned.closing) void this.closeEntry(owned)
      })
      window.on('resize', bounds)
      window.on('maximize', () => this.publishChromeState(owned))
      window.on('unmaximize', () => this.publishChromeState(owned))
      window.on('focus', () => this.rememberFocused(owned))
      window.on('blur', () => this.settleBlur(owned))
      window.on('close', event => { event.preventDefault(); void this.closeEntry(owned) })
      window.on('closed', () => { unsubscribe(); window.removeListener('resize', bounds); void this.closeEntry(owned) })
      this.deps.onSurfacesChanged()
    }
    const owned = entry
    owned.restarting = true
    owned.blurBehavior = preferences.blurBehavior ?? 'temporary-hide'
    owned.packageHash = authority.snapshot.packageHash
    owned.title = manifest.features.find(feature => feature.id === authority.featureId)?.title || manifest.name
    owned.iconDataUrl = this.iconDataUrl(authority)
    owned.loading = true
    owned.runtime.setVisible(false)
    this.publishChromeState(owned)
    owned.window.setTitle(owned.title)
    owned.window.setIcon(this.icon(authority))
    const runtimeOpening = owned.runtime.openAuthority(authority, currentContext())
    const opening = Promise.all([owned.chromeReady, runtimeOpening]).then(async () => {
      if (owned.closing || owned.window.isDestroyed()) throw new Error('Feature window closed during activation.')
      await owned.runtime.prepareFirstFrame?.()
      if (owned.closing || owned.window.isDestroyed()) throw new Error('Feature window closed during its first content frame.')
      owned.loading = false
      const [width, height] = owned.window.getContentSize()
      owned.runtime.setBounds({ x: 0, y: TITLEBAR_HEIGHT, width, height: height - TITLEBAR_HEIGHT })
      owned.runtime.setVisible(true)
      owned.restarting = false
      this.publishChromeState(owned)
      if (this.deps.presentWindow) await this.deps.presentWindow(owned.window)
      this.focus(owned)
      const previous = owned.previousTemporaryTarget
      owned.previousTemporaryTarget = undefined
      if (previous && (this.currentTemporaryTarget === owned || this.currentTemporaryTarget === null)
        && this.shouldCloseWhenSwitched(previous)) this.closeSwitchedTarget(previous)
    })
    owned.opening = opening
    try { await opening }
    catch (error) {
      const previous = owned.previousTemporaryTarget
      await this.closeEntry(owned)
      if (previous && !previous.window.isDestroyed() && !previous.closing && !this.currentTemporaryTarget) this.currentTemporaryTarget = previous
      throw error
    }
    finally { if (owned.opening === opening) owned.opening = undefined; owned.restarting = false }
  }
  private closeEntry(entry: WindowEntry): Promise<void> {
    if (entry.closing) return entry.closing
    if (this.currentTemporaryTarget === entry) this.clearTemporaryTarget()
    entry.closing = (async () => {
      this.closeMenuOverlay(entry)
      const menuOverlay = entry.menuOverlay
      entry.menuOverlay = undefined
      entry.menuOverlayReady = undefined
      if (menuOverlay) {
        try { if (!entry.window.isDestroyed()) entry.window.contentView.removeChildView(menuOverlay) } catch { /* The owner may already be closing. */ }
        if (!menuOverlay.webContents.isDestroyed()) menuOverlay.webContents.close()
      }
      try { await entry.runtime.close() }
      finally {
        if (!entry.window.isDestroyed()) entry.window.destroy()
        if (this.windows.get(entry.key) === entry) this.windows.delete(entry.key)
        this.closing.delete(entry); this.deps.onSurfacesChanged()
      }
    })()
    this.closing.set(entry, entry.closing)
    return entry.closing
  }
  async closePlugin(pluginId: string): Promise<void> {
    await Promise.all([...this.windows.values()].filter(entry => entry.ref.pluginId === pluginId && !entry.developmentSessionId).map(entry => this.closeEntry(entry)))
  }
  async closeDevelopmentSession(sessionId: string): Promise<void> {
    this.clearDevelopmentTemporaryTarget(sessionId)
    const entries = new Set([...this.windows.values(), ...this.closing.keys()])
    await Promise.all([...entries].filter(entry => entry.developmentSessionId === sessionId).map(entry => this.closeEntry(entry)))
  }
  beginDevelopmentReload(sessionId: string): { featureIds: readonly string[]; ready: Promise<void>; finish(): Promise<void> } {
    this.clearDevelopmentTemporaryTarget(sessionId)
    const entries = [...this.windows.values()].filter(entry => entry.developmentSessionId === sessionId && !entry.closing)
    this.pendingReloads++
    for (const entry of entries) { entry.restarting = true; this.closeMenuOverlay(entry) }
    let finished = false
    // All old Feature contexts must be destroyed before the shared origin can
    // serve a new snapshot. Keep the OS windows and a Host surface lease alive.
    const ready = Promise.all(entries.map(entry => entry.runtime.close())).then(() => undefined)
    return { get featureIds() { return entries.filter(entry => !entry.closing && !entry.window.isDestroyed()).map(entry => entry.ref.featureId) }, ready, finish: async () => {
      if (finished) return
      finished = true
      try {
        await Promise.all(entries.map(async entry => {
          entry.restarting = false
          if (entry.runtime.status.state !== 'READY') await this.closeEntry(entry)
        }))
      } finally { this.pendingReloads--; this.deps.onSurfacesChanged() }
    } }
  }
  async closeAll(): Promise<void> { this.shuttingDown = true; this.unsubscribeTheme(); await Promise.all([
    ...[...this.windows.values()].map(entry => this.closeEntry(entry)), ...(this.managerEntry ? [this.closeTemporaryTarget(this.managerEntry)] : []),
  ]) }
}
