import type { PluginRuntimeDiagnostic } from '../../src/shared/plugin-development-contracts.ts'

export class PluginRuntimeDiagnostics {
  private active = false
  private readonly records = new Map<string, PluginRuntimeDiagnostic>()
  private readonly generations = new Map<string, { generation: number; startedAt: number }>()
  private readonly listeners = new Set<() => void>()
  private readonly secrets: Set<string>
  constructor(private readonly roots: readonly string[], secrets: readonly string[] = []) { this.secrets = new Set(secrets.filter(Boolean)) }
  rememberSecret(secret: string): void { if (secret) this.secrets.add(secret) }
  forgetSecret(secret: string): void { this.secrets.delete(secret) }
  get enabled(): boolean { return this.active }
  setEnabled(enabled: boolean): void {
    this.active = enabled
    if (!enabled) { this.records.clear(); this.generations.clear() }
    this.publish()
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish(): void { for (const listener of this.listeners) { try { listener() } catch { /* UI observers cannot interrupt the runtime. */ } } }
  private clean(value: string, limit: number): string {
    let result = value.slice(0, limit).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    for (const secret of this.secrets) if (secret) result = result.split(secret).join('[redacted]')
    for (const root of this.roots) {
      if (root) result = result.replace(new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '<host>')
    }
    return result.replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\r\n<>"']+/g, '<local-path>')
      .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [redacted]')
      .replace(/\b((?:api[_-]?key|token|secret|password|authorization)["']?\s*[:=]\s*["']?)[^\s,;"']+/gi, '$1[redacted]')
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
      .replace(/\b(?:sk-|sk_|ghp_|github_pat_)[A-Za-z0-9_-]{12,}/g, '[redacted]')
      .replace(/--webtools-plugin-runtime=[A-Za-z0-9_-]+/g, '--webtools-plugin-runtime=[redacted]')
  }
  begin(pluginId: string, generation: number, featureId = ''): void {
    const key = `${pluginId}\0${featureId}`
    this.generations.delete(key)
    this.generations.set(key, { generation, startedAt: Date.now() })
    if (this.generations.size > 16) this.generations.delete(this.generations.keys().next().value!)
  }
  ready(pluginId: string, generation: number, featureId = ''): void {
    const key = `${pluginId}\0${featureId}`
    const current = this.generations.get(key)
    if (!current || current.generation !== generation) return
    const previous = this.records.get(key)
    if (previous && (previous.runtimeGeneration === generation || previous.timestamp <= current.startedAt)) {
      this.records.delete(key); this.publish()
    }
    this.buildSucceeded(pluginId, current.startedAt)
  }
  record(value: PluginRuntimeDiagnostic): void {
    if (!this.active) return
    // RuntimeInstance checks sender identity/generation before recording. A
    // still-live window for another Feature is not stale merely because a
    // second window started more recently.
    const key = `${value.pluginId}\0${value.featureId ?? ''}`
    const diagnostic = Object.freeze({ ...value,
      code: this.clean(value.code, 128), message: this.clean(value.message, 4096),
      ...(value.source ? { source: this.clean(value.source, 512) } : {}),
      ...(value.stack ? { stack: this.clean(value.stack, 8192) } : {}),
    })
    this.records.delete(key); this.records.set(key, diagnostic)
    if (this.records.size > 16) this.records.delete(this.records.keys().next().value!)
    this.publish()
  }
  has(pluginId: string, generation: number): boolean { return [...this.records.values()].some(value => value.pluginId === pluginId && value.runtimeGeneration === generation) }
  buildSucceeded(pluginId: string, startedAt: number): void {
    const key = `${pluginId}\0`
    const record = this.records.get(key)
    if (record && record.runtimeGeneration === undefined && record.timestamp <= startedAt) { this.records.delete(key); this.publish() }
  }
  list(): readonly PluginRuntimeDiagnostic[] { return this.active ? [...this.records.values()].reverse() : [] }
  format(pluginId: string, featureId?: string): string {
    const value = this.active ? [...this.records.values()].reverse().find(value => value.pluginId === pluginId && value.featureId === featureId) : undefined
    if (!value) throw new Error('No current developer diagnostic is available.')
    return `Plugin: ${value.pluginId}\nFeature: ${value.featureId ?? '(none)'}\nPhase: ${value.phase}\nCode: ${value.code}\nTimestamp: ${new Date(value.timestamp).toISOString()}\nGeneration: ${value.runtimeGeneration ?? '(build)'}\n\nMessage:\n${value.message}\n\nSource:\n${value.source ?? '(unknown)'}\n\nStack:\n${value.stack ?? '(unavailable)'}`
  }
}
