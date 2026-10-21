import { ERROR_CODES, validateRequestInput } from './protocol.mjs'
import { validateCapabilityRequest, validateCapabilityResult } from './capability-methods.mjs'

function safeError(code) {
  const error = new Error(code === 'CANCELLED' ? 'WebTools call cancelled' : 'WebTools bridge unavailable')
  error.name = 'WebToolsError'
  error.code = ERROR_CODES.includes(code) ? code : 'INTERNAL_ERROR'
  error.retryable = false
  return error
}

// Internal transport seam, deliberately absent from package exports/public client.
export function createBridgeConnection(facade) {
  const available = facade && typeof facade.getReady === 'function' && typeof facade.submit === 'function' && typeof facade.onClose === 'function'
  const listeners = new Set()
  const pending = new Set()
  let closed = false
  let unsubscribe = () => {}
  function dispose() {
    if (closed) return
    closed = true
    unsubscribe()
    for (const cancel of [...pending]) cancel('RUNTIME_CLOSED')
    for (const listener of [...listeners]) { try { listener() } catch { /* Keep SDK cleanup independent of Plugin callback errors. */ } }
    listeners.clear()
  }
  if (available) unsubscribe = facade.onClose(dispose)
  const ready = Promise.resolve().then(async () => {
    if (!available) throw safeError('NOT_AVAILABLE')
    const outcome = await facade.getReady()
    if (outcome?.accepted !== true) throw safeError(outcome?.error?.code ?? 'NOT_AVAILABLE')
    if (closed) throw safeError('RUNTIME_CLOSED')
  }).catch(error => { throw safeError(error?.code ?? 'NOT_AVAILABLE') })
  ready.catch(() => {}) // Connection may be created before the caller awaits ready.
  const namespaces = Array.isArray(facade?.capabilityNamespaces) ? facade.capabilityNamespaces : []
  async function capability(method, payload, options) {
    try { validateCapabilityRequest(method, payload) } catch (error) { throw safeError(error.code ?? 'INVALID_REQUEST') }
    const result = await request(method, payload, options)
    try { validateCapabilityResult(method, result) } catch { throw safeError('INTERNAL_ERROR') }
    if (method === 'context.current') return result === null ? null : Object.freeze({ ...result })
    return ['config.set', 'storage.set', 'storage.delete', 'clipboard.write'].includes(method) ? undefined : result
  }
  const publicClient = Object.freeze({ ready,
    context: Object.freeze({ current: options => capability('context.current', null, options) }),
    config: Object.freeze({ get: options => capability('config.get', null, options),
      set: (key, value, options) => capability('config.set', { key, value }, options) }),
    storage: Object.freeze({ get: (key, options) => capability('storage.get', { key }, options),
      set: (key, value, options) => capability('storage.set', { key, value }, options),
      delete: (key, options) => capability('storage.delete', { key }, options) }),
    ...(namespaces.includes('ai') ? { ai: Object.freeze({ complete: (input, options) => capability('ai.complete', input, options) }) } : {}),
    ...(namespaces.includes('clipboard') ? { clipboard: Object.freeze({ writeText: (text, options) => capability('clipboard.write', { text }, options) }) } : {}),
    onClose(listener) {
    if (typeof listener !== 'function') throw new TypeError('Invalid close listener')
    if (closed) { listener(); return () => {} }
    if (listeners.size >= 4) throw safeError('LIMIT_EXCEEDED')
    const subscription = () => listener()
    listeners.add(subscription)
    return () => { listeners.delete(subscription) }
  } })
  function request(method, payload, { signal } = {}) {
    return new Promise((resolve, reject) => {
      let settled = false
      let handle
      function finish(error, value) {
        if (settled) return
        settled = true; pending.delete(cancel); signal?.removeEventListener('abort', aborted)
        if (error) reject(safeError(error)); else resolve(value)
      }
      function cancel(code) { finish(code); if (handle) { try { handle.cancel() } catch {} } }
      const aborted = () => cancel('CANCELLED')
      if (signal?.aborted) { finish('CANCELLED'); return }
      if (closed) { finish('RUNTIME_CLOSED'); return }
      try { validateRequestInput(method, payload) } catch (error) { finish(error.code ?? 'INVALID_REQUEST'); return }
      pending.add(cancel)
      signal?.addEventListener('abort', aborted, { once: true })
      ready.then(() => {
        if (settled) return
        if (closed || signal?.aborted) { cancel(closed ? 'RUNTIME_CLOSED' : 'CANCELLED'); return }
        try {
          handle = facade.submit(method, payload)
          Promise.resolve(handle.response).then(outcome => {
            if (outcome?.ok === true) finish(null, outcome.result)
            else finish(outcome?.error?.code ?? 'INTERNAL_ERROR')
          }, () => finish('INTERNAL_ERROR'))
        } catch { finish('INTERNAL_ERROR') }
      }, error => finish(error.code))
    })
  }
  return Object.freeze({ publicClient, request, dispose })
}
