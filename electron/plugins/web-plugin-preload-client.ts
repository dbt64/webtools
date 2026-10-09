import { BRIDGE_MAJOR, encodeMessage, parseMessage, type BridgeErrorCode, type JsonValue } from '../../plugin-sdk/declarative-v1/web/protocol.mjs'

type Outcome = { ok: true; result: JsonValue } | { ok: false; error: { code: BridgeErrorCode; retryable: false } }
type ReadyOutcome = { accepted: true } | { accepted: false; error: { code: BridgeErrorCode; retryable: false } }
interface Port { send(raw: string): void; listen(listener: (raw: unknown) => void): () => void }
const failure = (code: BridgeErrorCode): Outcome & { ok: false } => ({ ok: false, error: { code, retryable: false } })

/** Trusted preload owns IDs. The exposed cancel closure captures its ID privately. */
export function createPluginPreloadFacade(port: Port, capabilityNamespaces: readonly ('ai' | 'clipboard')[] = []) {
  let nextId = 1
  let accepted = false
  let closed = false
  let resolveReady!: (outcome: ReadyOutcome) => void
  const ready = new Promise<ReadyOutcome>(resolve => { resolveReady = resolve })
  const listeners = new Set<() => void>()
  const pending = new Map<string, { resolve: (value: Outcome) => void; timer: ReturnType<typeof setTimeout> }>()
  let unlisten = () => {}
  function finish(id: string, outcome: Outcome): boolean {
    const entry = pending.get(id)
    if (!entry) return false
    pending.delete(id); clearTimeout(entry.timer); entry.resolve(outcome)
    return true
  }
  function dispose(code: BridgeErrorCode = 'RUNTIME_CLOSED') {
    if (closed) return
    closed = true; accepted = false
    resolveReady({ accepted: false, error: { code, retryable: false } })
    unlisten()
    for (const id of pending.keys()) finish(id, failure(code))
    for (const listener of listeners) { try { listener() } catch { /* Plugin-local listener failure cannot retain the transport. */ } }
    listeners.clear()
  }
  unlisten = port.listen(raw => {
    if (closed) return
    try {
      const message = parseMessage(raw, 'host')
      if (message.protocolMajor !== BRIDGE_MAJOR) { dispose('NOT_AVAILABLE'); return }
      if (message.type === 'runtime-closed') { dispose(); return }
      if (message.type === 'ready') {
        if (!message.accepted) { dispose(message.error.code); return }
        accepted = true; resolveReady({ accepted: true })
      } else if (accepted && message.type === 'response') {
        finish(message.requestId, message.ok ? { ok: true, result: message.result } : failure(message.error.code))
      }
    } catch { dispose('INTERNAL_ERROR') }
  })
  const facade = Object.freeze({
    capabilityNamespaces: Object.freeze([...new Set(capabilityNamespaces.filter(name => name === 'ai' || name === 'clipboard'))]),
    getReady: () => ready,
    onClose: (listener: () => void) => {
      if (typeof listener !== 'function') throw new TypeError('Invalid close listener')
      if (closed) { listener(); return () => {} }
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    submit: (method: string, payload: JsonValue) => {
      const unavailable = (code: BridgeErrorCode) => Object.freeze({ response: Promise.resolve(failure(code)), cancel: () => {} })
      if (closed || !accepted) return unavailable(closed ? 'RUNTIME_CLOSED' : 'NOT_AVAILABLE')
      if (nextId > Number.MAX_SAFE_INTEGER) {
        // A post-ready handshake is rejected by Main and closes this generation.
        // No ID is reused and no new wire message type is introduced.
        try { port.send(encodeMessage({ type: 'hello', protocolMajor: BRIDGE_MAJOR }, 'client')) } catch {}
        dispose(); return unavailable('RUNTIME_CLOSED')
      }
      const id = String(nextId)
      let raw: string
      try { raw = encodeMessage({ type: 'request', protocolMajor: BRIDGE_MAJOR, requestId: id, method, payload }, 'client') }
      catch (error) { return unavailable(error && typeof error === 'object' && 'code' in error && error.code === 'LIMIT_EXCEEDED' ? 'LIMIT_EXCEEDED' : 'INVALID_REQUEST') }
      nextId++
      let resolve!: (outcome: Outcome) => void
      const response = new Promise<Outcome>(done => { resolve = done })
      const cancel = () => {
        if (!finish(id, failure('CANCELLED'))) return
        try { port.send(encodeMessage({ type: 'cancel', protocolMajor: BRIDGE_MAJOR, requestId: id }, 'client')) } catch { /* Best-effort cancellation never reopens the local call. */ }
      }
      const deadline = setTimeout(() => {
        if (!finish(id, failure('TIMEOUT'))) return
        try { port.send(encodeMessage({ type: 'cancel', protocolMajor: BRIDGE_MAJOR, requestId: id }, 'client')) } catch {}
      }, method === 'ai.complete' ? 60_000 : 30_000)
      pending.set(id, { resolve, timer: deadline })
      try { port.send(raw) } catch { finish(id, failure('INTERNAL_ERROR')) }
      return Object.freeze({ response, cancel })
    },
    dispose: () => dispose(),
  })
  try { port.send(encodeMessage({ type: 'hello', protocolMajor: BRIDGE_MAJOR }, 'client')) } catch { dispose('NOT_AVAILABLE') }
  return facade
}
