import test from 'node:test'
import assert from 'node:assert/strict'
import { createBridgeConnection } from '../web/bridge-client.mjs'

function connection(capabilityNamespaces = ['ai', 'clipboard']) {
  const calls = []
  const facade = { capabilityNamespaces, getReady: async () => ({ accepted: true }), onClose: () => () => {},
    submit: (method, payload) => { calls.push({ method, payload }); return { response: Promise.resolve({ ok: true,
      result: method === 'context.current' ? { type: 'text', source: 'launcher-input', text: '中文 exact' }
        : method === 'config.get' ? { label: 'hello' } : method === 'ai.complete' ? { text: 'answer' } : method === 'storage.get' ? { saved: true } : null }), cancel: () => {} } } }
  return { client: createBridgeConnection(facade), calls }
}
test('public SDK exposes the five typed families; optional privileged namespaces reflect Host-provided availability', async () => {
  const { client, calls } = connection(); const api = client.publicClient; await api.ready
  assert.deepEqual(Object.keys(api).sort(), ['ai', 'clipboard', 'config', 'context', 'onClose', 'ready', 'storage'])
  assert.equal(api.request, undefined); assert.equal(api.external, undefined)
  const context = await api.context.current(); assert.equal(context.text, '中文 exact'); assert.equal(Object.isFrozen(context), true)
  assert.deepEqual(await api.config.get(), { label: 'hello' })
  assert.equal(await api.config.set('label', 'saved'), undefined)
  assert.deepEqual(await api.storage.get('note'), { saved: true })
  assert.equal(await api.storage.set('note', { saved: true }), undefined)
  assert.equal(await api.storage.delete('note'), undefined)
  assert.deepEqual(await api.ai.complete({ prompt: 'hello' }), { text: 'answer' })
  assert.equal(await api.clipboard.writeText('safe'), undefined)
  assert.deepEqual(calls.map(c => c.method), ['context.current', 'config.get', 'config.set', 'storage.get', 'storage.set', 'storage.delete', 'ai.complete', 'clipboard.write'])
  const denied = connection([]); assert.equal(denied.client.publicClient.ai, undefined); assert.equal(denied.client.publicClient.clipboard, undefined)
  client.dispose(); denied.client.dispose()
})
test('SDK closed schemas reject authority/provider fields, path keys, non-JSON, and byte excess before transport', async () => {
  const { client, calls } = connection(); const api = client.publicClient; await api.ready
  for (const run of [
    () => api.config.set('../other-plugin', 'forged'),
    () => api.config.set('label', { arbitrary: 'JSON' }),
    () => api.config.set('label', NaN),
    () => api.ai.complete({ prompt: 'safe', providerId: 'forged' }),
    () => api.ai.complete({ prompt: 'x'.repeat(32769) }),
    () => api.storage.get('../another-plugin'),
    () => api.storage.set('note', { __proto__: { forged: true } }),
    () => api.storage.set('note', 'x'.repeat(524288)),
    () => api.clipboard.writeText('x'.repeat(65537)),
  ]) await assert.rejects(run)
  assert.equal(calls.length, 0); client.dispose()
})
test('typed capability cancellation before readiness emits no request', async () => {
  const { client, calls } = connection(); const controller = new AbortController(); controller.abort()
  await assert.rejects(() => client.publicClient.ai.complete({ prompt: 'safe' }, { signal: controller.signal }), e => e.code === 'CANCELLED')
  assert.equal(calls.length, 0); client.dispose()
})
