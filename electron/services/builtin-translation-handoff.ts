import type {
  BuiltinTranslationHandoffProjection,
  ResolveTranslationHandoffRequest,
  TranslationHandoffToken,
} from '../../src/shared/builtin-translation-contracts.ts'
import type { BuiltinTranslationLifecycle, BuiltinTranslationRuntimeState } from '../plugins/builtin-translation-lifecycle.ts'

const DEFAULT_UNPRESENTED_TIMEOUT_MS = 40_000

interface HandoffLifecyclePort {
  snapshot(): BuiltinTranslationRuntimeState
  isEnabled(): boolean
  setEnabled(enabled: boolean, mayCommit?: () => boolean): Promise<BuiltinTranslationRuntimeState>
}

interface HandoffOptions {
  timeoutMs?: number
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}

interface Slot {
  requestId: string
  generation: number
  text: string | null
  timer: ReturnType<typeof setTimeout> | undefined
  resolveTransport(): void
  rejectTransport(error: HandoffError): void
  transportSettled: boolean
  gatePresented: boolean
  lastProjectedUiGeneration: number | null
  deliveredUiGeneration: number | null
}

export class HandoffError extends Error {
  readonly code: string
  constructor(code: string) { super(code); this.name = 'HandoffError'; this.code = code }
}

/** One bounded Main-owned Native-to-Translation text slot. The renderer can only act on projected tokens. */
export class BuiltinTranslationHandoff {
  private readonly lifecycle: HandoffLifecyclePort
  private readonly timeoutMs: number
  private readonly setTimer: NonNullable<HandoffOptions['setTimer']>
  private readonly clearTimer: NonNullable<HandoffOptions['clearTimer']>
  private slot: Slot | null = null
  private sequence = 0
  private uiGenerationValue = 0
  private rendererIsReady = false
  private closed = false

  constructor(lifecycle: HandoffLifecyclePort | BuiltinTranslationLifecycle, options: HandoffOptions = {}) {
    this.lifecycle = lifecycle
    this.timeoutMs = options.timeoutMs ?? DEFAULT_UNPRESENTED_TIMEOUT_MS
    this.setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay))
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer))
  }

  get uiGeneration(): number { return this.uiGenerationValue }

  begin(input: { requestId: string; text: string | null }): Promise<void> {
    if (this.closed) throw new HandoffError('MANAGER_CLOSED')
    if (!validRequestId(input?.requestId) || !(input.text === null || isValidText(input.text))) throw new HandoffError('INVALID_HANDOFF')
    this.supersede()
    let resolveTransport!: () => void
    let rejectTransport!: (error: HandoffError) => void
    const transport = new Promise<void>((resolve, reject) => { resolveTransport = resolve; rejectTransport = reject })
    const slot: Slot = {
      requestId: input.requestId,
      generation: ++this.sequence,
      text: input.text,
      timer: undefined,
      resolveTransport,
      rejectTransport,
      transportSettled: false,
      gatePresented: false,
      lastProjectedUiGeneration: null,
      deliveredUiGeneration: null,
    }
    this.slot = slot
    slot.timer = this.setTimer(() => {
      if (this.slot !== slot || slot.gatePresented) return
      this.slot = null
      slot.timer = undefined
      this.settleRejected(slot, 'HANDOFF_EXPIRED')
    }, this.timeoutMs)
    return transport
  }

  /** Called for each main-frame navigation. Retains the handoff while invalidating every old UI token. */
  rendererStarting(): void {
    if (this.closed) return
    this.rendererIsReady = false
    this.uiGenerationValue += 1
    if (this.slot) {
      this.slot.lastProjectedUiGeneration = null
      this.slot.deliveredUiGeneration = null
    }
  }

  rendererReady(): void { if (!this.closed) this.rendererIsReady = true }

  claimNativeDelivery(): { requestId: string } | null {
    const slot = this.slot
    if (this.closed || !this.rendererIsReady || !slot || slot.deliveredUiGeneration === this.uiGenerationValue) return null
    slot.deliveredUiGeneration = this.uiGenerationValue
    return { requestId: slot.requestId }
  }

  getProjection(): BuiltinTranslationHandoffProjection {
    const slot = this.slot
    if (this.closed || !this.rendererIsReady || !slot) return { status: 'none', uiGeneration: this.uiGenerationValue }
    slot.lastProjectedUiGeneration = this.uiGenerationValue
    const state = this.lifecycle.snapshot()
    if (state.status === 'ready' && state.enabled && this.lifecycle.isEnabled()) {
      return { status: 'ready', requestId: slot.requestId, generation: slot.generation, uiGeneration: this.uiGenerationValue, text: slot.text }
    }
    if (state.status === 'disabled') {
      return { status: 'blocked', requestId: slot.requestId, generation: slot.generation, uiGeneration: this.uiGenerationValue, reason: 'disabled', hasPrefill: slot.text !== null }
    }
    if (state.status === 'faulted') {
      return { status: 'blocked', requestId: slot.requestId, generation: slot.generation, uiGeneration: this.uiGenerationValue, reason: 'faulted', errorCode: state.errorCode, retryEnabled: state.retryEnabled, hasPrefill: slot.text !== null }
    }
    if (state.status === 'unavailable') {
      return { status: 'blocked', requestId: slot.requestId, generation: slot.generation, uiGeneration: this.uiGenerationValue, reason: 'unavailable', errorCode: state.errorCode, hasPrefill: slot.text !== null }
    }
    return { status: 'blocked', requestId: slot.requestId, generation: slot.generation, uiGeneration: this.uiGenerationValue, reason: 'transitioning', hasPrefill: slot.text !== null }
  }

  async resolve(request: ResolveTranslationHandoffRequest): Promise<BuiltinTranslationHandoffProjection> {
    const slot = this.assertCurrent(request)
    const projection = this.getProjection()
    if (projection.status === 'none') throw new HandoffError('STALE_HANDOFF')

    if (request.disposition === 'gate-presented') {
      if (projection.status !== 'blocked') throw new HandoffError('STALE_HANDOFF')
      slot.gatePresented = true
      this.clearSlotTimer(slot)
      this.settleResolved(slot)
      return projection
    }

    if (request.disposition === 'enable-and-open') {
      if (!slot.gatePresented || projection.status !== 'blocked') throw new HandoffError('STALE_HANDOFF')
      if (projection.reason === 'unavailable' || projection.reason === 'transitioning'
        || (projection.reason === 'faulted' && projection.retryEnabled !== true)) throw new HandoffError('HANDOFF_RECOVERY_REQUIRED')
      const generation = slot.generation
      await this.lifecycle.setEnabled(true, () => this.slot === slot && this.slot.generation === generation && !this.closed)
      if (this.slot !== slot || this.closed) throw new HandoffError('STALE_HANDOFF')
      return this.getProjection()
    }

    if (!slot.gatePresented && (projection.status !== 'ready' || slot.lastProjectedUiGeneration !== this.uiGenerationValue)) throw new HandoffError('STALE_HANDOFF')
    if (request.disposition === 'applied') {
      if (projection.status !== 'ready' || slot.lastProjectedUiGeneration !== this.uiGenerationValue) throw new HandoffError('STALE_HANDOFF')
      this.clearSlotTimer(slot)
      this.slot = null
      this.settleResolved(slot)
      return { status: 'none', uiGeneration: this.uiGenerationValue }
    }
    if (request.disposition === 'cancel') {
      this.clearSlotTimer(slot)
      this.slot = null
      this.settleResolved(slot)
      return { status: 'none', uiGeneration: this.uiGenerationValue }
    }
    throw new HandoffError('INVALID_HANDOFF')
  }

  supersede(): void {
    const slot = this.slot
    if (!slot) return
    this.slot = null
    this.clearSlotTimer(slot)
    this.settleRejected(slot, 'INTENT_SUPERSEDED')
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.rendererIsReady = false
    const slot = this.slot
    this.slot = null
    if (slot) {
      this.clearSlotTimer(slot)
      this.settleRejected(slot, 'MANAGER_CLOSED')
    }
  }

  private assertCurrent(request: ResolveTranslationHandoffRequest): Slot {
    const slot = this.slot
    if (this.closed || !slot || request.requestId !== slot.requestId || request.generation !== slot.generation
      || request.uiGeneration !== this.uiGenerationValue || slot.lastProjectedUiGeneration !== this.uiGenerationValue) throw new HandoffError('STALE_HANDOFF')
    return slot
  }

  private clearSlotTimer(slot: Slot): void {
    if (slot.timer === undefined) return
    this.clearTimer(slot.timer)
    slot.timer = undefined
  }

  private settleResolved(slot: Slot): void {
    if (slot.transportSettled) return
    slot.transportSettled = true
    slot.resolveTransport()
  }

  private settleRejected(slot: Slot, code: string): void {
    if (slot.transportSettled) return
    slot.transportSettled = true
    slot.rejectTransport(new HandoffError(code))
  }
}

function validRequestId(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 128 }
function isValidText(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 20_000 }
