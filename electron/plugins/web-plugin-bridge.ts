import { BRIDGE_MAJOR, decodeRaw, encodeMessage, validateParsed, validRequestId, type BridgeErrorCode, type HostMessage } from '../../plugin-sdk/declarative-v1/web/protocol.mjs'

interface BridgeOptions {
  authenticate(event: unknown): 'current' | 'invalid' | 'unrelated'
  send(raw: string): void
  onReady(): void
  onFatal(): void
  now?: () => number
  /** Internal fixed ping implementation seam; never a method router/capability. */
  dispatchPing?: (signal: AbortSignal) => null | Promise<null>
}
interface Pending {
  event: unknown
  controller: AbortController
  timer: ReturnType<typeof setTimeout>
  deadline: number
  work?: Promise<void>
}

/** Transport state is subordinate to the owning WebPluginRuntime generation. */
export class WebPluginBridge {
  readonly ready: Promise<void>
  private resolveReady!: () => void
  private rejectReady!: (error: Error) => void
  private readonly options: BridgeOptions
  private readonly now: () => number
  private readonly pending = new Map<string, Pending>()
  private closed = false
  private loaded = false
  private accepted = false
  private hello: unknown = null
  private readyTimer?: ReturnType<typeof setTimeout>
  private readyDeadline = Infinity
  private closePromise?: Promise<void>
  private tokens = 20
  private refilledAt: number

  constructor(options: BridgeOptions) {
    this.options = options
    this.now = options.now ?? (() => performance.now())
    this.refilledAt = this.now()
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject })
    this.ready.catch(() => {})
  }

  documentLoaded(): void {
    if (this.closed || this.loaded) return
    this.loaded = true
    this.readyDeadline = this.now() + 10_000
    this.readyTimer = setTimeout(() => this.fatal(), 10_000)
    this.tryReady()
  }

  receive(event: unknown, raw: unknown): void {
    if (this.closed) return
    const identity = this.options.authenticate(event)
    if (identity === 'unrelated') return
    if (identity !== 'current') { this.fatal(); return }
    let value: unknown
    try { value = decodeRaw(raw) } catch { this.takeToken(); return } // No oversized ID recovery.
    const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
    let control = false
    if (record && (record.type === 'hello' || record.type === 'cancel')) {
      try {
        const parsed = validateParsed(raw as string, value, 'client')
        control = parsed.protocolMajor === BRIDGE_MAJOR && (parsed.type === 'hello' ? !this.accepted : this.accepted)
      } catch { /* Fake controls are charged below. */ }
    }
    if (control && record?.type === 'hello') { this.hello = event; this.tryReady(); return }
    if (control && record?.type === 'cancel') {
      const id = record.requestId as string
      const entry = this.pending.get(id)
      if (entry) this.finish(id, entry, this.now() >= entry.deadline ? 'TIMEOUT' : 'CANCELLED')
      return // Unknown/duplicate cancel retains no state.
    }
    const admittedRate = this.takeToken()
    const id = record?.type === 'request' && validRequestId(record.requestId) ? record.requestId : undefined
    if (id && this.pending.has(id)) { this.fatal(); return }
    if (record?.type === 'hello') {
      this.send({ type: 'ready', protocolMajor: BRIDGE_MAJOR, accepted: false, error: { code: record.protocolMajor !== BRIDGE_MAJOR ? 'NOT_AVAILABLE' : 'INVALID_REQUEST', retryable: false } })
      this.fatal(); return
    }
    if (!id) return
    if (!admittedRate) { this.reply(id, 'LIMIT_EXCEEDED'); return }
    try {
      const message = validateParsed(raw as string, value, 'client')
      if (message.type !== 'request') return
      if (!this.accepted || message.protocolMajor !== BRIDGE_MAJOR) { this.reply(id, 'NOT_AVAILABLE'); return }
      if (message.method !== 'bridge.ping') { this.reply(id, 'NOT_AVAILABLE'); return }
      if (message.payload !== null) { this.reply(id, 'INVALID_REQUEST'); return }
    } catch { this.reply(id, 'INVALID_REQUEST'); return }
    if (this.pending.size >= 4) { this.reply(id, 'LIMIT_EXCEEDED'); return }
    const controller = new AbortController()
    const entry: Pending = { event, controller, deadline: this.now() + 30_000,
      timer: setTimeout(() => this.finish(id, entry, 'TIMEOUT'), 30_000) }
    this.pending.set(id, entry)
    entry.work = Promise.resolve().then(() => {
      if (this.closed || this.pending.get(id) !== entry || this.options.authenticate(event) !== 'current') return null
      return this.options.dispatchPing ? this.options.dispatchPing(controller.signal) : null
    }).then(result => {
      if (result !== null) this.finish(id, entry, 'INTERNAL_ERROR')
      else this.finish(id, entry, this.now() > entry.deadline ? 'TIMEOUT' : undefined)
    }, () => this.finish(id, entry, 'INTERNAL_ERROR'))
  }

  revoke(): Promise<void> {
    if (this.closed) return this.closePromise ?? Promise.resolve()
    this.closed = true // Authority goes away synchronously, before any cooperative wait.
    clearTimeout(this.readyTimer)
    this.rejectReady(new Error('Web Plugin Bridge closed'))
    try { this.options.send(encodeMessage({ type: 'runtime-closed', protocolMajor: BRIDGE_MAJOR }, 'host')) } catch {}
    const work: Promise<void>[] = []
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer); entry.controller.abort()
      if (entry.work) work.push(entry.work)
    }
    this.pending.clear()
    if (!work.length) return this.closePromise = Promise.resolve()
    return this.closePromise = new Promise(resolve => {
      const timer = setTimeout(resolve, 2_000)
      void Promise.allSettled(work).then(() => { clearTimeout(timer); resolve() })
    })
  }

  private tryReady(): void {
    if (this.closed || this.accepted || !this.loaded || !this.hello) return
    if (this.now() >= this.readyDeadline || this.options.authenticate(this.hello) !== 'current') { this.fatal(); return }
    this.accepted = true
    clearTimeout(this.readyTimer)
    this.options.onReady() // Owner changes runtime state atomically before publishing ready.
    this.send({ type: 'ready', protocolMajor: BRIDGE_MAJOR, accepted: true })
    if (!this.closed) this.resolveReady()
  }
  private takeToken(): boolean {
    const now = this.now()
    this.tokens = Math.min(20, this.tokens + Math.max(0, now - this.refilledAt) * 10 / 1000)
    this.refilledAt = now
    if (this.tokens < 1) return false
    this.tokens--; return true
  }
  private finish(id: string, entry: Pending, error?: BridgeErrorCode): void {
    if (this.closed || this.pending.get(id) !== entry) return
    this.pending.delete(id); clearTimeout(entry.timer)
    if (error) entry.controller.abort()
    if (this.options.authenticate(entry.event) !== 'current') { this.fatal(); return }
    if (error) this.reply(id, error)
    else this.send({ type: 'response', protocolMajor: BRIDGE_MAJOR, requestId: id, ok: true, result: null })
  }
  private reply(id: string, code: BridgeErrorCode): void {
    this.send({ type: 'response', protocolMajor: BRIDGE_MAJOR, requestId: id, ok: false, error: { code, retryable: false } })
  }
  private send(message: HostMessage): void {
    if (this.closed) return
    try { this.options.send(encodeMessage(message, 'host')) } catch { this.fatal() }
  }
  private fatal(): void { if (this.closed) return; void this.revoke(); this.options.onFatal() }
}
