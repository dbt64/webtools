import { BUILTIN_TRANSLATION_ID, type BuiltinPluginStateLoad } from './builtin-plugin-state.ts'

export type BuiltinTranslationRuntimeState =
  | { status: 'ready'; enabled: true; generation: number }
  | { status: 'disabled'; enabled: false; generation: number }
  | { status: 'enabling' | 'stopping'; enabled: false; targetEnabled: boolean; generation: number }
  | { status: 'faulted'; enabled: false; errorCode: string; retryEnabled: boolean; generation: number }
  | { status: 'unavailable'; enabled: false; errorCode: string; generation: number }

export interface BuiltinPluginStatePort {
  load(): Promise<BuiltinPluginStateLoad>
  setEnabled(id: typeof BUILTIN_TRANSLATION_ID, enabled: boolean, mayCommit?: () => boolean): Promise<BuiltinPluginStateLoad>
  recoverToDefault(mayCommit?: () => boolean): Promise<BuiltinPluginStateLoad>
}

function safeErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code
  return 'STATE_WRITE_FAILED'
}

function stateFromStore(state: BuiltinPluginStateLoad, generation: number): BuiltinTranslationRuntimeState {
  return state.status === 'ready'
    ? state.enabled ? { status: 'ready', enabled: true, generation } : { status: 'disabled', enabled: false, generation }
    : { status: 'unavailable', enabled: false, errorCode: state.errorCode, generation }
}

/** Main owns this state machine; Catalog and translation IPC consume its authority. */
export class BuiltinTranslationLifecycle {
  private readonly store: BuiltinPluginStatePort
  private readonly cancelTranslation: () => void
  private state: BuiltinTranslationRuntimeState = { status: 'unavailable', enabled: false, errorCode: 'STATE_UNAVAILABLE', generation: 0 }
  private generationValue = 0
  private initialized = false
  private transitionPrior: BuiltinTranslationRuntimeState | null = null

  constructor(store: BuiltinPluginStatePort, cancelTranslation: () => void) {
    this.store = store
    this.cancelTranslation = cancelTranslation
  }

  get generation(): number { return this.generationValue }
  isEnabled(): boolean { return this.state.status === 'ready' && this.state.enabled }
  isGenerationCurrent(generation: number): boolean { return this.isEnabled() && this.generationValue === generation }
  snapshot(): BuiltinTranslationRuntimeState { return structuredClone(this.state) }

  async initialize(): Promise<BuiltinTranslationRuntimeState> {
    if (this.initialized) return this.snapshot()
    this.state = stateFromStore(await this.store.load(), this.generationValue)
    this.initialized = true
    return this.snapshot()
  }

  async setEnabled(enabled: boolean, mayCommit: () => boolean = () => true): Promise<BuiltinTranslationRuntimeState> {
    if (!this.initialized || typeof enabled !== 'boolean') throw this.error('STATE_UNAVAILABLE')
    if (this.state.status === 'unavailable') throw this.error('STATE_UNAVAILABLE')
    if (this.state.status === 'faulted' && enabled !== this.state.retryEnabled) throw this.error('STATE_UNAVAILABLE')
    if (this.state.status === 'ready' && enabled) return this.snapshot()
    if (this.state.status === 'disabled' && !enabled) return this.snapshot()

    const prior = this.snapshot()
    const generation = ++this.generationValue
    this.transitionPrior = prior
    this.state = enabled
      ? { status: 'enabling', enabled: false, targetEnabled: true, generation }
      : { status: 'stopping', enabled: false, targetEnabled: false, generation }
    if (!enabled) this.cancelTranslation()

    try {
      const saved = await this.store.setEnabled(BUILTIN_TRANSLATION_ID, enabled, () => this.generationValue === generation && mayCommit())
      if (this.generationValue !== generation || !mayCommit()) throw this.error('SESSION_EXPIRED')
      if (saved.status !== 'ready' || saved.enabled !== enabled) throw this.error('STATE_WRITE_FAILED')
      this.state = enabled
        ? { status: 'ready', enabled: true, generation }
        : { status: 'disabled', enabled: false, generation }
      this.transitionPrior = null
      return this.snapshot()
    } catch (error) {
      if (this.generationValue !== generation) throw this.error('SESSION_EXPIRED')
      if (!mayCommit() || safeErrorCode(error) === 'SESSION_EXPIRED') {
        this.state = { ...prior, generation }
        this.transitionPrior = null
        throw this.error('SESSION_EXPIRED')
      }
      this.state = { status: 'faulted', enabled: false, errorCode: safeErrorCode(error), retryEnabled: enabled, generation }
      this.transitionPrior = null
      throw this.error(safeErrorCode(error))
    }
  }

  async recoverToDefault(confirmed: boolean, mayCommit: () => boolean = () => true): Promise<BuiltinTranslationRuntimeState> {
    if (!this.initialized || !confirmed || this.state.status !== 'unavailable') throw this.error('STATE_UNAVAILABLE')
    const generation = ++this.generationValue
    const prior = this.snapshot()
    this.transitionPrior = prior
    this.state = { status: 'enabling', enabled: false, targetEnabled: true, generation }
    try {
      const saved = await this.store.recoverToDefault(() => this.generationValue === generation && mayCommit())
      if (this.generationValue !== generation || !mayCommit()) throw this.error('SESSION_EXPIRED')
      if (saved.status !== 'ready' || !saved.enabled) throw this.error('STATE_RECOVERY_FAILED')
      this.state = { status: 'ready', enabled: true, generation }
      this.transitionPrior = null
      return this.snapshot()
    } catch (error) {
      if (this.generationValue !== generation) throw this.error('SESSION_EXPIRED')
      if (!mayCommit() || safeErrorCode(error) === 'SESSION_EXPIRED') {
        this.state = { ...prior, generation }
        this.transitionPrior = null
        throw this.error('SESSION_EXPIRED')
      }
      this.state = { ...prior, generation }
      this.transitionPrior = null
      throw this.error(safeErrorCode(error))
    }
  }

  /** Invalidate late Translation results and in-flight state changes on renderer-session rollover. */
  invalidateSession(): void {
    this.generationValue += 1
    if (this.transitionPrior) this.state = { ...this.transitionPrior, generation: this.generationValue }
    else this.state = { ...this.state, generation: this.generationValue }
    this.transitionPrior = null
  }

  /** Manager shutdown is terminal for work, but persisted enable choice is untouched. */
  close(): void {
    this.generationValue += 1
    this.state = { status: 'disabled', enabled: false, generation: this.generationValue }
    this.transitionPrior = null
    this.cancelTranslation()
  }

  private error(code: string): Error & { code: string } {
    const error = new Error(code) as Error & { code: string }
    error.code = code
    return error
  }
}
