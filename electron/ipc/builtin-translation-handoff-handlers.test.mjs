import test from 'node:test'
import assert from 'node:assert/strict'
import { IPC_CHANNELS } from '../../src/shared/ipc.ts'
import { createBuiltinTranslationHandoffHandlers, registerBuiltinTranslationHandoffHandlers } from './builtin-translation-handoff-handlers.ts'

function setup() {
  let allowed = true
  const calls = []
  const projection = { status: 'blocked', requestId: 'native-1', generation: 2, uiGeneration: 4, reason: 'disabled', hasPrefill: true }
  const handoff = {
    getProjection: () => projection,
    resolve: async action => { calls.push(action); return { status: 'none', uiGeneration: 4 } },
  }
  const handlers = createBuiltinTranslationHandoffHandlers({ getHandoff: () => handoff, isManagerMainFrame: () => allowed })
  return { handlers, handoff, calls, projection, setAllowed: value => { allowed = value } }
}

const sender = { sender: {}, senderFrame: {} }

test('handoff projection is main-frame guarded and accepts no renderer payload', async () => {
  const env = setup()
  const get = env.handlers[IPC_CHANNELS.builtinTranslationHandoffGet]
  assert.deepEqual(await get(sender), { ok: true, data: env.projection })
  assert.deepEqual((await get(sender, { text: 'forged' })).error.code, 'INVALID_INPUT')
  env.setAllowed(false)
  assert.equal((await get(sender)).error.code, 'PERMISSION_DENIED')
})

test('resolve accepts only a fixed token and disposition; renderer cannot supply text or identity', async () => {
  const env = setup()
  const resolve = env.handlers[IPC_CHANNELS.builtinTranslationHandoffResolve]
  assert.deepEqual(await resolve(sender, { requestId: 'native-1', generation: 2, uiGeneration: 4, disposition: 'gate-presented' }), { ok: true, data: { status: 'none', uiGeneration: 4 } })
  assert.deepEqual(env.calls, [{ requestId: 'native-1', generation: 2, uiGeneration: 4, disposition: 'gate-presented' }])
  for (const payload of [
    { requestId: 'native-1', generation: 2, uiGeneration: 4, disposition: 'enable-and-open', text: 'forged' },
    { requestId: 'native-1', generation: 2, uiGeneration: 4, disposition: 'unknown' },
    { requestId: 'native-1', generation: 2, uiGeneration: -1, disposition: 'cancel' },
    { requestId: 'native-1', generation: '2', uiGeneration: 4, disposition: 'cancel' },
  ]) assert.equal((await resolve(sender, payload)).ok, false)
})

test('resolve revalidates manager sender after async work and registration owns cleanup', async () => {
  const env = setup()
  const registrations = new Map()
  const ipc = { handle(channel, handler) { registrations.set(channel, handler) }, removeHandler(channel) { registrations.delete(channel) } }
  const dispose = registerBuiltinTranslationHandoffHandlers(ipc, { getHandoff: () => env.handoff, isManagerMainFrame: () => true })
  assert.equal(registrations.size, 2)
  dispose()
  assert.equal(registrations.size, 0)

  let allowed = true
  const delayed = createBuiltinTranslationHandoffHandlers({
    getHandoff: () => ({ getProjection: () => env.projection, resolve: async () => { allowed = false; return env.projection } }),
    isManagerMainFrame: () => allowed,
  })
  assert.equal((await delayed[IPC_CHANNELS.builtinTranslationHandoffResolve](sender, { requestId: 'native-1', generation: 2, uiGeneration: 4, disposition: 'cancel' })).error.code, 'SESSION_EXPIRED')
})
