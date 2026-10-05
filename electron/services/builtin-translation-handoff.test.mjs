import test from 'node:test'
import assert from 'node:assert/strict'
import { BuiltinTranslationHandoff } from './builtin-translation-handoff.ts'

function createLifecycle(initial = { status: 'disabled', enabled: false, generation: 0 }) {
  let state = structuredClone(initial)
  const calls = []
  return {
    calls,
    snapshot: () => structuredClone(state),
    isEnabled: () => state.status === 'ready' && state.enabled,
    async setEnabled(enabled, mayCommit = () => true) {
      calls.push(enabled)
      if (!mayCommit()) throw Object.assign(new Error('SESSION_EXPIRED'), { code: 'SESSION_EXPIRED' })
      state = { status: enabled ? 'ready' : 'disabled', enabled, generation: state.generation + 1 }
      return structuredClone(state)
    },
    setState(next) { state = structuredClone(next) },
  }
}

function setup(options = {}) {
  const lifecycle = createLifecycle(options.state)
  const timers = new Map()
  let timerId = 0
  const service = new BuiltinTranslationHandoff(lifecycle, {
    timeoutMs: options.timeoutMs ?? 40_000,
    setTimer(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id },
    clearTimer(id) { timers.delete(id) },
  })
  return { service, lifecycle, timers }
}

const readyRenderer = service => { service.rendererStarting(); service.rendererReady() }

test('disabled Native translation is acknowledged when its gate is presented and exact text remains Main-owned', async () => {
  const { service, timers } = setup()
  const nativeAck = service.begin({ requestId: 'request-1', text: '  exact 原文\n🙂  ' })
  readyRenderer(service)
  const gate = service.getProjection()
  assert.deepEqual(gate, {
    status: 'blocked', requestId: 'request-1', generation: 1, uiGeneration: 1,
    reason: 'disabled', hasPrefill: true,
  })
  await service.resolve({ ...gate, disposition: 'gate-presented' })
  await nativeAck
  assert.equal(timers.size, 0, 'presented gate has no short user-decision deadline')
  const stillBlocked = service.getProjection()
  assert.equal(stillBlocked.status, 'blocked')
  assert.equal(stillBlocked.hasPrefill, true)
  assert.equal('text' in stillBlocked, false, 'blocked projection must not expose raw prefill text')
})

test('explicit enable opens Translation with the exact original text and rejects stale UI actions', async () => {
  const { service, lifecycle } = setup()
  const originalText = "  don't-stop 世界 日本語🙂—！？ \t\n"
  const nativeAck = service.begin({ requestId: 'request-2', text: originalText })
  readyRenderer(service)
  const blocked = service.getProjection()
  await service.resolve({ ...blocked, disposition: 'gate-presented' })
  await nativeAck
  const ready = await service.resolve({ ...blocked, disposition: 'enable-and-open' })
  assert.equal(ready.status, 'ready')
  assert.equal(ready.text, originalText)
  assert.equal(lifecycle.calls.length, 1)
  service.rendererStarting()
  service.rendererReady()
  assert.equal(service.getProjection().text, originalText)
  await assert.rejects(service.resolve({ ...ready, disposition: 'applied' }), error => error.code === 'STALE_HANDOFF')
  const reprojected = service.getProjection()
  await service.resolve({ ...reprojected, disposition: 'applied' })
  assert.equal(service.getProjection().status, 'none')
})

test('an enabled page-only handoff waits for page readiness and does not toggle state', async () => {
  const { service, lifecycle } = setup({ state: { status: 'ready', enabled: true, generation: 3 } })
  const nativeAck = service.begin({ requestId: 'request-3', text: null })
  readyRenderer(service)
  const ready = service.getProjection()
  assert.deepEqual(ready, { status: 'ready', requestId: 'request-3', generation: 1, uiGeneration: 1, text: null })
  await service.resolve({ ...ready, disposition: 'applied' })
  await nativeAck
  assert.equal(service.getProjection().status, 'none')
  assert.deepEqual(lifecycle.calls, [])
})

test('the next Native request replaces a retained gate and invalidates its prior identity', async () => {
  const { service } = setup()
  const firstAck = service.begin({ requestId: 'request-4', text: 'first' })
  readyRenderer(service)
  const oldGate = service.getProjection()
  await service.resolve({ ...oldGate, disposition: 'gate-presented' })
  await firstAck
  const secondAck = service.begin({ requestId: 'request-5', text: 'second' })
  const current = service.getProjection()
  assert.equal(current.requestId, 'request-5')
  await assert.rejects(service.resolve({ ...oldGate, disposition: 'cancel' }), error => error.code === 'STALE_HANDOFF')
  await service.resolve({ ...current, disposition: 'gate-presented' })
  await secondAck
})

test('new Native request rejects an unpresented request rather than acknowledging it', async () => {
  const { service } = setup()
  const firstAck = service.begin({ requestId: 'request-6', text: 'first' })
  const secondAck = service.begin({ requestId: 'request-7', text: 'second' })
  await assert.rejects(firstAck, error => error.code === 'INTENT_SUPERSEDED')
  readyRenderer(service)
  const gate = service.getProjection()
  await service.resolve({ ...gate, disposition: 'gate-presented' })
  await secondAck
})

test('renderer reload retains pending handoff but old UI generation cannot acknowledge it', async () => {
  const { service } = setup()
  const nativeAck = service.begin({ requestId: 'request-8', text: 'reload text' })
  readyRenderer(service)
  const old = service.getProjection()
  service.rendererStarting()
  service.rendererReady()
  const current = service.getProjection()
  assert.equal(current.status, 'blocked')
  assert.equal(current.requestId, old.requestId)
  assert.ok(current.uiGeneration > old.uiGeneration)
  await assert.rejects(service.resolve({ ...old, disposition: 'gate-presented' }), error => error.code === 'STALE_HANDOFF')
  await service.resolve({ ...current, disposition: 'gate-presented' })
  await nativeAck
})

test('unavailable state requires Manager-confirmed recovery outside the handoff action', async () => {
  const { service, lifecycle } = setup({ state: { status: 'unavailable', enabled: false, errorCode: 'STATE_INVALID', generation: 0 } })
  const nativeAck = service.begin({ requestId: 'request-9', text: 'keep me' })
  readyRenderer(service)
  const blocked = service.getProjection()
  assert.equal(blocked.reason, 'unavailable')
  await service.resolve({ ...blocked, disposition: 'gate-presented' })
  await nativeAck
  await assert.rejects(service.resolve({ ...blocked, disposition: 'enable-and-open' }), error => error.code === 'HANDOFF_RECOVERY_REQUIRED')
  assert.deepEqual(lifecycle.calls, [])
})

test('failed persistence keeps the gate fail-closed and retains the handoff for an explicit retry', async () => {
  const { service, lifecycle } = setup()
  lifecycle.setEnabled = async () => {
    lifecycle.setState({ status: 'faulted', enabled: false, errorCode: 'STATE_WRITE_FAILED', retryEnabled: true, generation: 1 })
    throw Object.assign(new Error('STATE_WRITE_FAILED'), { code: 'STATE_WRITE_FAILED' })
  }
  const nativeAck = service.begin({ requestId: 'request-13', text: 'preserved after write failure' })
  readyRenderer(service)
  const blocked = service.getProjection()
  await service.resolve({ ...blocked, disposition: 'gate-presented' })
  await nativeAck
  await assert.rejects(service.resolve({ ...blocked, disposition: 'enable-and-open' }), error => error.code === 'STATE_WRITE_FAILED')
  const faulted = service.getProjection()
  assert.equal(faulted.status, 'blocked')
  assert.equal(faulted.reason, 'faulted')
  assert.equal(faulted.retryEnabled, true)
  assert.equal(faulted.hasPrefill, true)
})

test('cancel is terminal and never enables Translation', async () => {
  const { service, lifecycle } = setup()
  const nativeAck = service.begin({ requestId: 'request-10', text: 'discard me' })
  readyRenderer(service)
  const blocked = service.getProjection()
  await service.resolve({ ...blocked, disposition: 'gate-presented' })
  await nativeAck
  await service.resolve({ ...blocked, disposition: 'cancel' })
  assert.equal(service.getProjection().status, 'none')
  assert.deepEqual(lifecycle.calls, [])
})

test('unpresented handoff expires within its bounded deadline and clears exact text', async () => {
  const { service, timers } = setup({ timeoutMs: 40_000 })
  const nativeAck = service.begin({ requestId: 'request-11', text: 'expire me' })
  const [timerId, timer] = [...timers.entries()][0]
  assert.equal(timer.delay, 40_000)
  timers.delete(timerId)
  timer.callback()
  await assert.rejects(nativeAck, error => error.code === 'HANDOFF_EXPIRED')
  readyRenderer(service)
  assert.equal(service.getProjection().status, 'none')
})

test('manager close clears retained text and rejects an unacknowledged request', async () => {
  const { service } = setup()
  const nativeAck = service.begin({ requestId: 'request-12', text: 'private text' })
  service.close()
  await assert.rejects(nativeAck, error => error.code === 'MANAGER_CLOSED')
  assert.equal(service.getProjection().status, 'none')
})
