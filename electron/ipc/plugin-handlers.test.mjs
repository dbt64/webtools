import test from 'node:test'
import assert from 'node:assert/strict'
import { createPluginHandlers } from './plugin-handlers.ts'
import { IPC_CHANNELS } from '../../src/shared/ipc.ts'
function setup() {
  const calls = []; let current = true; let session = 'session'
  const manager = { get session() { return session }, isSession: value => value === session, list: async () => [], install: async () => ({ outcome: 'installed' }), setEnabled: async (...args) => { calls.push(args); return {} }, setGrants: async () => ({}), getPages: async () => ({}), invoke: async () => ({ status: 'success', value: null }), prepareAIReview: async request => ({ reviewId: 'review', request }), confirmAIReview: async reviewId => ({ status: 'success', value: reviewId }), cancelAIReview: async reviewId => ({ cancelled: reviewId === 'review' }), uninstall: async () => ({ removed: true }) }
  const deps = { getManager: () => manager, isManagerMainFrame: () => current, choosePackage: async () => null }
  return { handlers: createPluginHandlers(deps), deps, calls, setCurrent: value => { current = value }, changeSession: () => { session = 'new' } }
}
test('all plugin IPC calls deny non-manager or subframe senders before touching core', async () => {
  const env = setup(); env.setCurrent(false)
  for (const handler of Object.values(env.handlers)) assert.equal((await handler({})).error.code, 'PERMISSION_DENIED')
  assert.equal(env.calls.length, 0)
})
test('closed IPC shapes deny paths/extra arguments, malformed IDs and grant fields', async () => {
  const env = setup()
  for (const [channel, args] of [[IPC_CHANNELS.pluginList, ['extra']], [IPC_CHANNELS.pluginInstall, ['C:/arbitrary.wtplugin']], [IPC_CHANNELS.pluginSetEnabled, ['../bad', true]], [IPC_CHANNELS.pluginSetEnabled, ['org.example.demo', 'yes']], [IPC_CHANNELS.pluginSetGrants, ['org.example.demo', ['filesystem.read']]], [IPC_CHANNELS.pluginInvoke, [{ pluginId: 'org.example.demo', version: '1.0.0', hash: '0'.repeat(64), actionId: 'a', input: null, path: 'C:/secret' }]]]) assert.equal((await env.handlers[channel]({}, ...args)).ok, false)
  assert.equal(env.calls.length, 0)
})
test('picker cancellation is safe and stale sender/session cannot import selected bytes', async () => {
  const env = setup(); assert.deepEqual(await env.handlers[IPC_CHANNELS.pluginInstall]({}), { ok: true, data: { outcome: 'cancelled' } })
  env.deps.choosePackage = async () => { env.changeSession(); return new Uint8Array([1]) }
  assert.equal((await env.handlers[IPC_CHANNELS.pluginInstall]({})).error.code, 'SESSION_EXPIRED')
})
test('safe errors and unavailable core never leak raw paths or credentials', async () => {
  const env = setup(); env.deps.getManager = () => null
  const result = await env.handlers[IPC_CHANNELS.pluginList]({}); assert.equal(result.ok, false); assert.equal(JSON.stringify(result).includes('C:'), false)
})
test('AI review IPC is narrow, sender-checked and rejects caller-supplied confirmation fields', async () => {
  const env = setup(); const request = { pluginId: 'org.example.demo', version: '1.0.0', hash: 'a'.repeat(64), actionId: 'ai', input: { messages: [{ role: 'user', content: 'hello' }] } }
  assert.equal((await env.handlers[IPC_CHANNELS.pluginAIReviewPrepare]({}, request)).ok, true)
  assert.equal((await env.handlers[IPC_CHANNELS.pluginAIReviewPrepare]({}, { ...request, confirmed: true })).ok, false)
  assert.equal((await env.handlers[IPC_CHANNELS.pluginAIReviewConfirm]({}, 'review')).ok, true)
  assert.deepEqual(await env.handlers[IPC_CHANNELS.pluginAIReviewCancel]({}, 'review'), { ok: true, data: { cancelled: true } })
  env.setCurrent(false)
  assert.equal((await env.handlers[IPC_CHANNELS.pluginAIReviewConfirm]({}, 'review')).error.code, 'PERMISSION_DENIED')
})
