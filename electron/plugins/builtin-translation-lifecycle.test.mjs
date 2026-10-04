import test from 'node:test'
import assert from 'node:assert/strict'

const implementation = await import('./builtin-translation-lifecycle.ts').catch(() => null)

function createLifecycle(store, cancelTranslation = () => {}) {
  assert.ok(implementation, 'built-in Translation lifecycle module must exist')
  return new implementation.BuiltinTranslationLifecycle(store, cancelTranslation)
}

const ready = enabled => ({ status: 'ready', enabled, source: 'stored' })

test('disable closes Main admission and cancels Translation only before persistent IO settles', async () => {
  let finishWrite
  let cancelled = 0
  const store = {
    load: async () => ready(true),
    setEnabled: () => new Promise(resolve => { finishWrite = resolve }),
    recoverToDefault: async () => ready(true),
  }
  const lifecycle = createLifecycle(store, () => { cancelled += 1 })
  await lifecycle.initialize()

  const operation = lifecycle.setEnabled(false)
  assert.equal(lifecycle.isEnabled(), false)
  assert.equal(lifecycle.snapshot().status, 'stopping')
  assert.equal(cancelled, 1)
  finishWrite(ready(false))

  assert.deepEqual(await operation, { status: 'disabled', enabled: false, generation: lifecycle.generation })
  assert.equal(lifecycle.isEnabled(), false)
})

test('failed disable persistence remains fail-closed and can be retried without claiming success', async () => {
  let fail = true
  let calls = 0
  const store = {
    load: async () => ready(true),
    setEnabled: async (_id, enabled) => { calls += 1; if (fail) throw Object.assign(new Error('private path'), { code: 'STATE_WRITE_FAILED' }); return ready(enabled) },
    recoverToDefault: async () => ready(true),
  }
  const lifecycle = createLifecycle(store)
  await lifecycle.initialize()

  await assert.rejects(lifecycle.setEnabled(false), { code: 'STATE_WRITE_FAILED' })
  assert.equal(lifecycle.isEnabled(), false)
  assert.equal(lifecycle.snapshot().status, 'faulted')
  assert.equal(lifecycle.snapshot().retryEnabled, false)

  fail = false
  assert.deepEqual(await lifecycle.setEnabled(false), { status: 'disabled', enabled: false, generation: lifecycle.generation })
  assert.equal(calls, 2)
})

test('newer enable supersedes stale disable and only current generation becomes available', async () => {
  let finishFirst
  const saved = []
  const store = {
    load: async () => ready(true),
    setEnabled: async (_id, enabled, mayCommit) => {
      if (enabled === false) {
        const value = await new Promise(resolve => { finishFirst = resolve })
        if (!mayCommit()) throw Object.assign(new Error(), { code: 'SESSION_EXPIRED' })
        saved.push(value)
      } else {
        if (!mayCommit()) throw Object.assign(new Error(), { code: 'SESSION_EXPIRED' })
        saved.push(true)
      }
      return ready(enabled)
    },
    recoverToDefault: async () => ready(true),
  }
  const lifecycle = createLifecycle(store)
  await lifecycle.initialize()

  const disabling = lifecycle.setEnabled(false)
  const enabling = lifecycle.setEnabled(true)
  finishFirst(false)

  await assert.rejects(disabling, { code: 'SESSION_EXPIRED' })
  assert.equal((await enabling).status, 'ready')
  assert.deepEqual(saved, [true])
  assert.equal(lifecycle.isEnabled(), true)
})

test('corrupt state cannot be toggled and explicit backup recovery re-enables only after durable success', async () => {
  let recovered = false
  const store = {
    load: async () => ({ status: 'unavailable', errorCode: 'STATE_INVALID' }),
    setEnabled: async () => { throw Object.assign(new Error(), { code: 'STATE_UNAVAILABLE' }) },
    recoverToDefault: async mayCommit => { if (!mayCommit()) throw Object.assign(new Error(), { code: 'SESSION_EXPIRED' }); recovered = true; return ready(true) },
  }
  const lifecycle = createLifecycle(store)
  await lifecycle.initialize()

  assert.equal(lifecycle.isEnabled(), false)
  await assert.rejects(lifecycle.setEnabled(true), { code: 'STATE_UNAVAILABLE' })
  assert.equal(lifecycle.snapshot().status, 'unavailable')
  assert.equal(lifecycle.isEnabled(), false)
  assert.deepEqual(await lifecycle.recoverToDefault(true), { status: 'ready', enabled: true, generation: lifecycle.generation })
  assert.equal(recovered, true)
  assert.equal(lifecycle.isEnabled(), true)
})

test('Manager session invalidation rejects an old toggle and does not change current state', async () => {
  let finishWrite
  const store = {
    load: async () => ready(true),
    setEnabled: () => new Promise(resolve => { finishWrite = resolve }),
    recoverToDefault: async () => ready(true),
  }
  const lifecycle = createLifecycle(store)
  await lifecycle.initialize()
  let currentSession = true
  const operation = lifecycle.setEnabled(false, () => currentSession)
  currentSession = false
  lifecycle.invalidateSession()
  finishWrite(ready(false))

  await assert.rejects(operation, { code: 'SESSION_EXPIRED' })
  assert.equal(lifecycle.isEnabled(), true)
  assert.equal(lifecycle.snapshot().status, 'ready')
})
