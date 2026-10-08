import test from 'node:test'
import assert from 'node:assert/strict'
const module = await import('./web-plugin-bridge.ts').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null
  throw error
})
function harness(dispatchPing) {
  assert.ok(module, 'Main Plugin Bridge is missing')
  const event = {}; const sent = []; let ready = 0; let fatal = 0
  const bridge = new module.WebPluginBridge({ authenticate: e => e === event ? 'current' : 'unrelated', now: () => 0, send: raw => sent.push(JSON.parse(raw)), onReady: () => ready++, onFatal: () => fatal++, ...(dispatchPing ? { dispatchPing } : {}) })
  const receive = raw => bridge.receive(event, raw)
  const handshake = async () => { receive('{"type":"hello","protocolMajor":1}'); bridge.documentLoaded(); await bridge.ready }
  return { bridge, sent, receive, handshake, ready: () => ready, fatal: () => fatal }
}
const request = id => `{"type":"request","protocolMajor":1,"requestId":"${id}","method":"bridge.ping","payload":null}`
test('Main requires hello plus load, then returns correlated ping and safe unavailable errors', async () => {
  const h = harness()
  h.bridge.documentLoaded()
  assert.equal(h.ready(), 0)
  h.receive('{"type":"hello","protocolMajor":1}')
  await h.bridge.ready
  assert.equal(h.ready(), 1)
  h.receive(request('1'))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(h.sent.at(-1), { type: 'response', protocolMajor: 1, requestId: '1', ok: true, result: null })
  h.receive('{"type":"request","protocolMajor":1,"requestId":"2","method":"unknown.call","payload":null}')
  assert.deepEqual(h.sent.at(-1).error, { code: 'NOT_AVAILABLE', retryable: false })
  await h.bridge.revoke()
})
test('cancel before admission is stateless and cannot cancel a later same-ID request', async () => {
  const h = harness(); await h.handshake()
  h.receive('{"type":"cancel","protocolMajor":1,"requestId":"5"}')
  h.receive(request('5'))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(h.sent.at(-1), { type: 'response', protocolMajor: 1, requestId: '5', ok: true, result: null })
  await h.bridge.revoke()
})
test('revoke is synchronous, aborts pending work and ignores late results and unrelated senders', async () => {
  let release; let signal
  const h = harness(s => { signal = s; return new Promise(resolve => { release = resolve }) }); await h.handshake()
  h.bridge.receive({}, request('9'))
  h.receive(request('1')); await new Promise(resolve => setImmediate(resolve))
  const closing = h.bridge.revoke()
  assert.equal(signal.aborted, true)
  h.receive(request('2'))
  release(null); await closing
  assert.equal(h.sent.filter(message => message.type === 'response' && message.ok).length, 0)
  assert.equal(h.sent.at(-1).type, 'runtime-closed')
})
test('malformed fake cancel is charged while unknown valid cancel remains token-free', async () => {
  const h = harness(); await h.handshake()
  h.receive('{"type":"cancel","protocolMajor":1,"requestId":"1","fake":true}')
  for (let i = 1; i <= 20; i++) h.receive('{"type":"cancel","protocolMajor":1,"requestId":"99"}')
  for (let i = 1; i <= 19; i++) { h.receive(request(String(i))); await new Promise(resolve => setImmediate(resolve)) }
  h.receive(request('20'))
  assert.deepEqual(h.sent.at(-1).error, { code: 'LIMIT_EXCEEDED', retryable: false })
  h.receive('{"type":"request","protocolMajor":1,"requestId":"21","method":"bad-method","payload":null}')
  assert.ok(h.sent.every(message => !JSON.stringify(message).includes('stack')))
  await h.bridge.revoke()
})
