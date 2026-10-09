import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PluginManager } from './plugin-manager.ts'
import { webManifest, webPackage } from './fixtures.mjs'
import { WebHostCapabilities } from './web-host-capabilities.ts'

const caps = ['plugin.storage.read', 'plugin.storage.write', 'sharedAI.complete', 'clipboard.write']
async function setup(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'webtools-capability-')); t.after(() => rm(root, { recursive: true, force: true }))
  const base = webManifest(); const m = webManifest({ requestedCapabilities: caps,
    features: [{ ...base.features[0], requiredCapabilities: caps, acceptedContexts: [{ type: 'text', sources: ['launcher-input'] }] }] })
  const manager = new PluginManager({ userData: root, hostVersion: '0.1.0', confirm: async () => true,
    externalOpen: async () => {}, clipboardWrite: () => {}, ai: { complete: async () => ({ text: 'unused' }), getDefaultProviderInfo: async () => ({ providerName: 'test', model: 'test' }) } })
  await manager.initialize(); t.after(() => manager.close())
  await manager.install(webPackage(m), manager.session); await manager.setEnabled(m.id, true, manager.session)
  let authority; const ticket = await manager.authorizeWebFeature({ pluginId: m.id, featureId: m.features[0].id }, manager.session, async a => { authority = a }); await ticket.completion
  const writes = []; const prompts = []; let now = 0; let aiCalls = 0
  const effects = { confirm: async request => { prompts.push(request); return true }, hasForegroundGesture: () => true,
    isAIConfigured: async () => true, completeAI: async (_prompt, signal) => { aiCalls++; return { text: signal.aborted ? 'late' : 'answer', outputTokens: 1, providerId: 'NEVER EXPOSE' } },
    clipboardWrite: text => writes.push(text), ...overrides }
  const service = new WebHostCapabilities({ authority, store: manager.store, effects, isRuntimeCurrent: () => true,
    context: { type: 'text', source: 'launcher-input', text: ' 中文 exact 😀 ', ageMs: 0 }, now: () => now })
  t.after(() => service.dispose())
  const call = (method, payload, signal = new AbortController().signal) => service.dispatch({ method, payload }, signal)
  return { manager, authority, m, service, writes, prompts, call, setNow: n => { now = n }, aiCalls: () => aiCalls }
}
test('context exposes only immutable invocation text and expires; revoked context cannot be retrieved', async t => {
  const env = await setup(t)
  assert.deepEqual(await env.call('context.current', null), { type: 'text', source: 'launcher-input', text: ' 中文 exact 😀 ' })
  env.setNow(600000); await assert.rejects(() => env.call('context.current', null), e => e.code === 'CONTEXT_EXPIRED')
  env.authority.revoke(); await assert.rejects(() => env.call('context.current', null))
})
test('undelivered context expires at thirty seconds and revokes its Host-owned lifetime', async t => {
  const env = await setup(t); env.setNow(30000)
  await assert.rejects(() => env.call('context.current', null), e => e.code === 'CONTEXT_EXPIRED')
  assert.equal(env.authority.isCurrent(), false)
})
test('AI byte excess and raw provider failures are rejected without truncation or secret exposure', async t => {
  const oversized = await setup(t, { completeAI: async () => ({ text: 'x'.repeat(32769), outputTokens: 1 }) })
  await assert.rejects(() => oversized.call('ai.complete', { prompt: 'safe' }), e => e.code === 'LIMIT_EXCEEDED')
  const failure = await setup(t, { completeAI: async () => { throw new Error('TOKEN SECRET PROVIDER ENDPOINT') } })
  await assert.rejects(() => failure.call('ai.complete', { prompt: 'safe' }), e => e.code === 'INTERNAL_ERROR' && !e.message.includes('SECRET'))
  await assert.rejects(() => failure.call('ai.complete', { prompt: 'x'.repeat(32769) }), e => e.code === 'LIMIT_EXCEEDED')
})
test('AI output rejects token overflow even with short text, and missing token usage fails closed', async t => {
  const overflow = await setup(t, { completeAI: async () => ({ text: 'short', outputTokens: 1025 }) })
  await assert.rejects(() => overflow.call('ai.complete', { prompt: 'safe' }), e => e.code === 'LIMIT_EXCEEDED')
  const missing = await setup(t, { completeAI: async () => ({ text: 'short' }) })
  await assert.rejects(() => missing.call('ai.complete', { prompt: 'safe' }), e => e.code === 'NOT_AVAILABLE')
  const exact = await setup(t, { completeAI: async () => ({ text: 'short', outputTokens: 1024 }) })
  assert.deepEqual(await exact.call('ai.complete', { prompt: 'safe' }), { text: 'short' })
})
test('storage uses Main namespace, read/write/delete and rolling quota; no caller identity/path survives schema', async t => {
  const env = await setup(t)
  await env.call('storage.set', { key: 'note', value: { saved: true } })
  assert.deepEqual(await env.call('storage.get', { key: 'note' }), { saved: true })
  await env.call('storage.delete', { key: 'note' }); assert.equal(await env.call('storage.get', { key: 'note' }), null)
  await assert.rejects(() => env.call('storage.get', { key: 'note', pluginId: 'forged' }))
  for (let i = 4; i < 60; i++) await env.call('storage.get', { key: 'note' })
  await assert.rejects(() => env.call('storage.get', { key: 'note' }), e => e.code === 'LIMIT_EXCEEDED')
  env.setNow(60000); assert.equal(await env.call('storage.get', { key: 'note' }), null)
})
test('AI requires foreground intent plus confirmation on every call; returns text only, caps rates and safe errors', async t => {
  const env = await setup(t)
  for (let i = 0; i < 5; i++) assert.deepEqual(await env.call('ai.complete', { prompt: 'hello' }), { text: 'answer' })
  assert.equal(env.prompts.length, 5); assert.equal(env.aiCalls(), 5)
  await assert.rejects(() => env.call('ai.complete', { prompt: 'hello' }), e => e.code === 'LIMIT_EXCEEDED')
  const background = await setup(t, { hasForegroundGesture: () => false })
  await assert.rejects(() => background.call('ai.complete', { prompt: 'hello' }), e => e.code === 'USER_CANCELLED')
  assert.equal(background.prompts.length, 0); assert.equal(background.aiCalls(), 0)
  const unavailable = await setup(t, { isAIConfigured: async () => false })
  await assert.rejects(() => unavailable.call('ai.complete', { prompt: 'hello' }), e => e.code === 'NOT_AVAILABLE')
})
test('confirmation deny/cancel and revoke during asynchronous confirmation leave clipboard unchanged', async t => {
  const denied = await setup(t, { confirm: async () => false })
  await assert.rejects(() => denied.call('clipboard.write', { text: 'safe' }), e => e.code === 'USER_CANCELLED')
  assert.deepEqual(denied.writes, [])
  let resolve; const env = await setup(t, { confirm: () => new Promise(done => { resolve = done }) })
  const pending = env.call('clipboard.write', { text: 'safe' }); pending.catch(() => {})
  await new Promise(done => setImmediate(done)); env.authority.revoke(); resolve(true)
  await assert.rejects(pending); assert.deepEqual(env.writes, [])
})
test('capability confirmation receives the composed cancellation signal so Host modal and preview can close', async t => {
  let observed
  const env = await setup(t, { confirm: (_request, signal) => { observed = signal; return new Promise(() => {}) } })
  const controller = new AbortController(); const pending = env.call('clipboard.write', { text: 'safe' }, controller.signal); pending.catch(() => {})
  await new Promise(done => setImmediate(done))
  assert.ok(observed, 'Host confirmation must receive an AbortSignal')
  controller.abort(); await assert.rejects(pending, e => e.code === 'CANCELLED'); assert.equal(observed.aborted, true)
  assert.deepEqual(env.writes, [])
})
test('AI cancellation/revocation aborts pending local work; late response never returns and concurrent calls deny', async t => {
  let resolve; let observed
  const env = await setup(t, { completeAI: (_prompt, signal) => { observed = signal; return new Promise(done => { resolve = done }) } })
  const controller = new AbortController(); const pending = env.call('ai.complete', { prompt: 'hello' }, controller.signal); pending.catch(() => {})
  await new Promise(done => setImmediate(done))
  await assert.rejects(() => env.call('ai.complete', { prompt: 'second' }), e => e.code === 'LIMIT_EXCEEDED')
  controller.abort(); await assert.rejects(pending, e => e.code === 'CANCELLED'); assert.equal(observed.aborted, true)
  resolve({ text: 'late' })
})
test('clipboard successful bounded write, byte excess, consent quota, and storage revocation before commit', async t => {
  const env = await setup(t)
  await env.call('clipboard.write', { text: 'x'.repeat(65536) }); assert.equal(env.writes[0].length, 65536)
  await assert.rejects(() => env.call('clipboard.write', { text: 'x'.repeat(65537) }), e => e.code === 'LIMIT_EXCEEDED')
  for (let i = 1; i < 5; i++) await env.call('clipboard.write', { text: 'safe' })
  await assert.rejects(() => env.call('clipboard.write', { text: 'safe' }), e => e.code === 'LIMIT_EXCEEDED')
  const original = env.manager.store.fs.atomicJson.bind(env.manager.store.fs)
  env.manager.store.fs.atomicJson = async (...args) => { env.authority.revoke(); return original(...args) }
  await assert.rejects(() => env.call('storage.set', { key: 'note', value: 'stale' }))
  assert.equal(await env.manager.store.readData(env.m.id, 'note'), null)
})
