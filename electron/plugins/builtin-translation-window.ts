export const TRANSLATION2_OPENED_CHANNEL = 'translation2:opened'

export interface Translation2OpenProjection {
  generation: number
  sourceText: string | null
}

export interface BuiltinTranslationWindowHandle {
  webContents: {
    readonly mainFrame?: object
    send(channel: string, payload: Translation2OpenProjection): void
    isDestroyed(): boolean
  }
  on(name: 'closed', listener: () => void): void
  show(): void
  focus(): void
  isMinimized(): boolean
  restore(): void
  minimize(): void
  isAlwaysOnTop(): boolean
  setAlwaysOnTop(value: boolean): void
  destroy(): void
  isDestroyed(): boolean
}

interface Dependencies {
  createWindow(): BuiltinTranslationWindowHandle
  loadWindow(window: BuiltinTranslationWindowHandle): Promise<void>
  isEnabled(): boolean
  onSurfacesChanged(active: boolean): void
  onFocused?(): void
  presentWindow?(window: BuiltinTranslationWindowHandle): Promise<void>
}

function validSource(value: string | null): boolean {
  return value === null || value.length <= 20_000 && value.trim().length > 0
}

/** Owns the single built-in Translation surface and its latest-source authority. */
export class BuiltinTranslationWindow {
  private window: BuiltinTranslationWindowHandle | null = null
  private opening: Promise<void> | null = null
  private generation = 0
  private sourceText: string | null = null
  private deliveredGeneration = 0

  constructor(private readonly deps: Dependencies) {}

  get hasSurface(): boolean { return this.window !== null && !this.window.isDestroyed() }

  getSurface(): BuiltinTranslationWindowHandle | null {
    return this.window && !this.window.isDestroyed() ? this.window : null
  }
  isPinned(): boolean { return this.getSurface()?.isAlwaysOnTop() ?? false }
  setPinned(pinned: boolean): { pinned: boolean } {
    const window = this.getSurface()
    if (!window) throw new Error('Translation window is closed.')
    window.setAlwaysOnTop(pinned)
    return { pinned: window.isAlwaysOnTop() }
  }
  minimize(): void { this.getSurface()?.minimize() }

  snapshot(): Translation2OpenProjection {
    return { generation: this.generation, sourceText: this.sourceText }
  }

  ownsMainFrame(context: { sender: object; senderFrame: object | null }): boolean {
    const window = this.window
    return Boolean(window && !window.isDestroyed() && !window.webContents.isDestroyed()
      && context.sender === window.webContents && context.senderFrame === window.webContents.mainFrame)
  }

  async open(sourceText: string | null = null): Promise<Translation2OpenProjection> {
    if (!this.deps.isEnabled()) throw new Error('Translation plugin is disabled.')
    if (!validSource(sourceText)) throw new Error('Translation source is invalid.')

    this.generation += 1
    this.sourceText = sourceText
    const window = this.ensureWindow()
    try { await this.opening }
    catch (error) {
      this.destroyOwnedWindow(window, true)
      throw error
    }
    if (this.window !== window || window.isDestroyed()) throw new Error('Translation window closed before it was ready.')
    this.publishLatest(window)
    if (window.isMinimized()) window.restore()
    this.deps.onFocused?.()
    if (this.deps.presentWindow) await this.deps.presentWindow(window)
    else { window.show(); window.focus() }
    return this.snapshot()
  }

  async close(): Promise<void> {
    const window = this.window
    if (!window) {
      this.generation += 1
      this.sourceText = null
      this.deliveredGeneration = 0
      return
    }
    this.destroyOwnedWindow(window, true)
  }

  private ensureWindow(): BuiltinTranslationWindowHandle {
    if (this.window && !this.window.isDestroyed()) return this.window
    const window = this.deps.createWindow()
    this.window = window
    this.deliveredGeneration = 0
    this.deps.onSurfacesChanged(true)
    this.opening = new Promise<void>((resolve, reject) => {
      window.on('closed', () => {
        reject(new Error('Translation window closed before it was ready.'))
        this.destroyOwnedWindow(window, false)
      })
      Promise.resolve().then(() => this.deps.loadWindow(window)).then(resolve, reject)
    }).finally(() => {
      if (this.window === window) this.opening = null
    })
    return window
  }

  private publishLatest(window: BuiltinTranslationWindowHandle): void {
    if (this.deliveredGeneration === this.generation || window.webContents.isDestroyed()) return
    window.webContents.send(TRANSLATION2_OPENED_CHANNEL, this.snapshot())
    this.deliveredGeneration = this.generation
  }

  private destroyOwnedWindow(window: BuiltinTranslationWindowHandle, destroy: boolean): void {
    if (this.window !== window) return
    this.window = null
    this.opening = null
    this.deliveredGeneration = 0
    this.generation += 1
    this.sourceText = null
    if (destroy && !window.isDestroyed()) window.destroy()
    this.deps.onSurfacesChanged(false)
  }
}
