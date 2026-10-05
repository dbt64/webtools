import test from 'node:test'
import assert from 'node:assert/strict'
import { withManagerCdpProbe } from './manager-cdp-probe.mjs'

class FakeSocket extends EventTarget {
  closeCount = 0
  listeners = new Set()
  addEventListener(type, listener, options) {
    this.listeners.add(listener)
    super.addEventListener(type, listener, options)
  }
  removeEventListener(type, listener, options) {
    this.listeners.delete(listener)
    super.removeEventListener(type, listener, options)
  }
  emit(type, data) {
    const event = new Event(type)
    if (data !== undefined) Object.defineProperty(event, 'data', { value: data })
    this.dispatchEvent(event)
  }
  send() { this.onSend?.() }
  close() { this.closeCount++ }
}

const options = { expression: 'true', label: 'test Manager', timeoutMs: 10 }
async function boundedFailure(promise, pattern) {
  let timeout
  const outcome = await Promise.race([
    promise.then(() => ({ success: true }), error => ({ error })),
    new Promise(resolve => { timeout = setTimeout(() => resolve({ hung: true }), 80) }),
  ]).finally(() => clearTimeout(timeout))
  assert.equal(outcome.hung, undefined, 'probe must settle before the outer cleanup deadline')
  assert.ok(outcome.error, 'probe must fail')
  assert.match(outcome.error.message, pattern)
}

test('Manager CDP open timeout releases socket and listeners', async () => {
  const socket = new FakeSocket()
  await boundedFailure(withManagerCdpProbe(socket, options, () => assert.fail('not opened')), /open.*timed out/)
  assert.equal(socket.closeCount, 1)
  assert.equal(socket.listeners.size, 0)
})

for (const stage of ['open', 'evaluation']) {
  for (const event of ['error', 'close']) {
    test(`Manager CDP ${stage} ${event} reaches cleanup`, async () => {
      const socket = new FakeSocket()
      socket.onSend = () => socket.emit(event)
      const probe = withManagerCdpProbe(socket, options, () => assert.fail('no result'))
      socket.emit(stage === 'open' ? event : 'open')
      await boundedFailure(probe, new RegExp(event === 'error' ? 'socket error' : 'socket closed'))
      assert.equal(socket.closeCount, 1)
      assert.equal(socket.listeners.size, 0)
    })
  }
}

test('Manager CDP evaluation timeout releases socket and listeners', async () => {
  const socket = new FakeSocket()
  const probe = withManagerCdpProbe(socket, options, () => assert.fail('no result'))
  socket.emit('open')
  await boundedFailure(probe, /evaluation.*timed out/)
  assert.equal(socket.closeCount, 1)
  assert.equal(socket.listeners.size, 0)
})

test('Manager CDP assertion failure closes socket unconditionally', async () => {
  const socket = new FakeSocket()
  socket.onSend = () => socket.emit('message', JSON.stringify({ id: 1, result: { result: { value: false } } }))
  const probe = withManagerCdpProbe(socket, options, value => assert.equal(value, true))
  socket.emit('open')
  await boundedFailure(probe, /false !== true/)
  assert.equal(socket.closeCount, 1)
  assert.equal(socket.listeners.size, 0)
})

test('Manager CDP ignores unrelated responses and verifies matching result', async () => {
  const socket = new FakeSocket()
  socket.onSend = () => {
    socket.emit('message', JSON.stringify({ id: 2, result: { result: { value: false } } }))
    socket.emit('message', JSON.stringify({ id: 1, result: { result: { value: true } } }))
  }
  const probe = withManagerCdpProbe(socket, options, value => { assert.equal(value, true); return 'verified' })
  socket.emit('open')
  assert.equal(await probe, 'verified')
  assert.equal(socket.closeCount, 1)
  assert.equal(socket.listeners.size, 0)
})

for (const failure of ['malformed response', 'remote exception', 'send failure']) {
  test(`Manager CDP ${failure} closes socket and releases listeners`, async () => {
    const socket = new FakeSocket()
    socket.onSend = () => {
      if (failure === 'send failure') throw new Error('send failure')
      if (failure === 'malformed response') socket.emit('message', '{')
      else socket.emit('message', JSON.stringify({ id: 1, result: { exceptionDetails: { text: 'remote failure' } } }))
    }
    const probe = withManagerCdpProbe(socket, options, () => assert.fail('no result'))
    socket.emit('open')
    await boundedFailure(probe, failure === 'malformed response' ? /JSON|property/ : failure === 'remote exception' ? /remote failure/ : /send failure/)
    assert.equal(socket.closeCount, 1)
    assert.equal(socket.listeners.size, 0)
  })
}
