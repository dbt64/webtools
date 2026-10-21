import test from 'node:test'
import assert from 'node:assert/strict'
const module = await import('./web-plugin-preload-client.ts').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null
  throw error
})
function harness() {
  assert.ok(module, 'dedicated Plugin preload client is missing')
  const sent = []; let receive; let disposed = false
  const facade = module.createPluginPreloadFacade({ send: raw => sent.push(raw), listen: listener => { receive = listener; return () => { disposed = true } } })
  const deliver = raw => receive(raw)
  return { facade, sent, deliver, disposed: () => disposed }
}
test('preload waits for Host ready and correlates opaque calls without exposing IDs', async () => {
  const h = harness()
  assert.deepEqual(h.sent, ['{"type":"hello","protocolMajor":1}'])
  h.deliver('{"type":"ready","protocolMajor":1,"accepted":true}')
  assert.deepEqual(await h.facade.getReady(), { accepted: true })
  const call = h.facade.submit('bridge.ping', null)
  assert.deepEqual(Object.keys(call).sort(), ['cancel', 'response'])
  assert.equal(h.sent[1], '{"type":"request","protocolMajor":1,"requestId":"1","method":"bridge.ping","payload":null}')
  h.deliver('{"type":"response","protocolMajor":1,"requestId":"1","ok":true,"result":null}')
  assert.deepEqual(await call.response, { ok: true, result: null })
  h.facade.dispose()
})
test('preload local cancel removes correlation and ignores a late Host response', async () => {
  const h = harness()
  h.deliver('{"type":"ready","protocolMajor":1,"accepted":true}')
  const call = h.facade.submit('bridge.ping', null)
  call.cancel(); call.cancel()
  assert.deepEqual(await call.response, { ok: false, error: { code: 'CANCELLED', retryable: false } })
  h.deliver('{"type":"response","protocolMajor":1,"requestId":"1","ok":true,"result":null}')
  assert.equal(h.sent.filter(raw => JSON.parse(raw).type === 'cancel').length, 1)
  const next = h.facade.submit('bridge.ping', null)
  h.deliver('{"type":"response","protocolMajor":1,"requestId":"2","ok":true,"result":null}')
  assert.deepEqual(await next.response, { ok: true, result: null })
  h.facade.dispose()
})
test('runtime close resolves pending transport outcomes and removes its IPC listener', async () => {
  const h = harness(); let closeCount = 0
  h.facade.onClose(() => closeCount++)
  h.deliver('{"type":"ready","protocolMajor":1,"accepted":true}')
  const pending = h.facade.submit('bridge.ping', null)
  h.deliver('{"type":"runtime-closed","protocolMajor":1}')
  assert.deepEqual(await pending.response, { ok: false, error: { code: 'RUNTIME_CLOSED', retryable: false } })
  assert.equal(h.disposed(), true)
  assert.equal(closeCount, 1)
  h.facade.dispose()
})

test('preload local thirty-second expiry cancels once, ignores late response and keeps later calls usable', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness()
  h.deliver('{"type":"ready","protocolMajor":1,"accepted":true}')
  const call = h.facade.submit('bridge.ping', null)
  let settled = false
  call.response.then(() => { settled = true })
  t.mock.timers.tick(29999); await Promise.resolve(); assert.equal(settled, false)
  t.mock.timers.tick(1)
  assert.deepEqual(await call.response, { ok: false, error: { code: 'TIMEOUT', retryable: false } })
  call.cancel()
  h.deliver('{"type":"response","protocolMajor":1,"requestId":"1","ok":true,"result":null}')
  assert.equal(h.sent.filter(raw => JSON.parse(raw).type === 'cancel').length, 1)
  const next = h.facade.submit('bridge.ping', null)
  h.deliver('{"type":"response","protocolMajor":1,"requestId":"2","ok":true,"result":null}')
  assert.deepEqual(await next.response, { ok: true, result: null })
  h.facade.dispose()
})

test('preload dispose clears timers/correlation/subscriptions and stale delivery cannot reopen it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness(); let closes = 0
  const unsubscribe = h.facade.onClose(() => closes++)
  unsubscribe()
  h.facade.onClose(() => { closes++ })
  h.deliver('{"type":"ready","protocolMajor":1,"accepted":true}')
  const call = h.facade.submit('bridge.ping', null)
  h.facade.dispose(); h.facade.dispose()
  assert.equal(closes, 1); assert.equal(h.disposed(), true)
  assert.equal((await call.response).error.code, 'RUNTIME_CLOSED')
  const sent = h.sent.length
  t.mock.timers.tick(60000)
  h.deliver('{"type":"ready","protocolMajor":1,"accepted":true}')
  h.deliver('{"type":"response","protocolMajor":1,"requestId":"1","ok":true,"result":null}')
  assert.equal((await h.facade.submit('bridge.ping', null).response).error.code, 'RUNTIME_CLOSED')
  assert.equal(h.sent.length, sent)
})
