import type { ThemePreference } from '../../src/shared/domain.ts'
import { resolvePluginWindowTheme, type PluginThemeSource, type PluginWindowTheme } from './plugin-window-theme.ts'

interface SystemTheme {
  readonly shouldUseDarkColors: boolean
  on(event: 'updated', listener: () => void): unknown
  removeListener(event: 'updated', listener: () => void): unknown
}

/** Observes existing settings; it owns no persistence or process-wide theme override. */
export class PluginThemeController implements PluginThemeSource {
  private acceptedPreference: ThemePreference
  private resolved: PluginWindowTheme
  private disposed = false
  private readonly listeners = new Set<(theme: PluginWindowTheme) => void>()
  constructor(private readonly getPreference: () => ThemePreference, private readonly systemTheme: SystemTheme) {
    this.acceptedPreference = getPreference()
    this.resolved = resolvePluginWindowTheme(this.acceptedPreference, systemTheme.shouldUseDarkColors)
    systemTheme.on('updated', this.resolveAccepted)
  }
  get current(): PluginWindowTheme { return this.resolved }
  readonly refresh = (): void => {
    if (this.disposed) return
    // Only the successful-save seam may accept a new preference. The Native
    // mirror can temporarily differ while a combined settings write rolls back.
    this.acceptedPreference = this.getPreference()
    this.resolveAccepted()
  }
  private readonly resolveAccepted = (): void => {
    if (this.disposed) return
    const next = resolvePluginWindowTheme(this.acceptedPreference, this.systemTheme.shouldUseDarkColors)
    if (next.scheme === this.resolved.scheme) return
    this.resolved = next
    for (const listener of this.listeners) {
      try { listener(next) } catch { /* One destroyed UI observer must not affect other windows or a saved setting. */ }
    }
  }
  subscribe(listener: (theme: PluginWindowTheme) => void): () => void {
    if (!this.disposed) this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  dispose(): void {
    this.disposed = true
    this.systemTheme.removeListener('updated', this.resolveAccepted)
    this.listeners.clear()
  }
}
