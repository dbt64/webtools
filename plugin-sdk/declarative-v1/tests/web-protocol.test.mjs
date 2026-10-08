import test from 'node:test'
import assert from 'node:assert/strict'

const protocol = await import('../web/protocol.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null
  throw error
})

test('Bridge wire validates and produces independently specified canonical request bytes', () => {
  assert.ok(protocol, 'browser-neutral Bridge wire implementation is missing')
  assert.equal(protocol.encodeMessage({ payload: null, method: 'bridge.ping', requestId: '1', protocolMajor: 1, type: 'request' }, 'client'),
    '{"type":"request","protocolMajor":1,"requestId":"1","method":"bridge.ping","payload":null}')
  const raw = '{"type":"request","protocolMajor":1,"requestId":"2","method":"bridge.ping","payload":{"a":0,"z":[true,"中文"]}}'
  assert.equal(protocol.encodeMessage({ type: 'request', protocolMajor: 1, requestId: '2', method: 'bridge.ping', payload: { z: [true, '中文'], a: -0 } }, 'client'), raw)
  assert.deepEqual(protocol.parseMessage(raw, 'client').payload, { a: 0, z: [true, '中文'] })
})

test('Bridge wire rejects noncanonical, malformed and non-JSON values without invoking accessors', () => {
  assert.ok(protocol)
  for (const raw of ['{"type":"cancel","protocolMajor":1,"requestId":"1","extra":true}',
    '{"type":"cancel","protocolMajor":1,"requestId":"1","requestId":"2"}',
    '{ "type":"hello","protocolMajor":1}', '{"type":"request","protocolMajor":1,"requestId":"1","method":"bad-method","payload":null}']) {
    assert.throws(() => protocol.parseMessage(raw, 'client'), error => error.code === 'INVALID_REQUEST')
  }
  let invoked = false
  const accessor = Object.defineProperty({}, 'hidden', { enumerable: true, get() { invoked = true; return 1 } })
  for (const payload of [accessor, new Date(), new Map(), [undefined], [, 1], '\ud800', { constructor: 1 }, Infinity]) {
    assert.throws(() => protocol.encodeMessage({ type: 'request', protocolMajor: 1, requestId: '1', method: 'bridge.ping', payload }, 'client'))
  }
  assert.equal(invoked, false)
})

test('raw UTF-8 gate rejects large bodies before parsing and bounds scalar/depth validation', () => {
  assert.ok(protocol)
  assert.equal(protocol.measureUtf8('中😀'), 7)
  assert.throws(() => protocol.decodeRaw('x'.repeat(532481)), error => error.code === 'LIMIT_EXCEEDED')
  assert.throws(() => protocol.parseMessage('{"type":"cancel","protocolMajor":1,"requestId":"9007199254740992"}', 'client'))
  let payload = null
  for (let n = 0; n < 17; n++) payload = [payload]
  assert.throws(() => protocol.encodeMessage({ type: 'request', protocolMajor: 1, requestId: '1', method: 'bridge.ping', payload }, 'client'))
})
