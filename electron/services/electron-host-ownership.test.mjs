import assert from 'node:assert/strict'
import test from 'node:test'
import { ElectronHostOwnership } from './electron-host-ownership.ts'

const snapshot = (revision, sessionIds = [], requests = []) => ({ revision, sessionIds, requests })
test('idle exit waits for an atomic ownership sync and preserves independent sessions', () => {
  const owner = new ElectronHostOwnership()
  assert.equal(owner.hasOwnership, true)
  owner.replace(snapshot(1, ['old', 'new']))
  owner.connected()
  owner.replace(snapshot(2, ['new']))
  assert.equal(owner.hasOwnership, true)
  owner.replace(snapshot(1, [])) // late release / stale snapshot
  assert.equal(owner.hasOwnership, true)
  owner.replace(snapshot(3))
  assert.equal(owner.hasOwnership, false)
  owner.disconnected()
  assert.equal(owner.hasOwnership, true)
  owner.replace(snapshot(4))
  assert.equal(owner.hasOwnership, true)
  owner.connected()
  assert.equal(owner.hasOwnership, false)
})

test('request ownership survives closing WPF and deduplicates delivery across a reconnect', async () => {
  const owner = new ElectronHostOwnership()
  owner.replace(snapshot(1, ['launcher']))
  owner.connected()
  owner.replace(snapshot(2, [], [{ requestId: 'one', state: 'queued' }]))
  let complete
  let calls = 0
  const action = () => { calls++; return new Promise(resolve => { complete = resolve }) }
  const first = owner.execute('one', action)
  owner.disconnected()
  owner.replace(snapshot(3, [], [{ requestId: 'one', state: 'delivered' }]))
  owner.connected()
  const retransmission = owner.execute('one', action)
  complete({ accepted: true })
  assert.deepEqual(await first, { accepted: true })
  assert.deepEqual(await retransmission, { accepted: true })
  assert.equal(calls, 1)
  assert.equal(owner.hasOwnership, true)
  owner.replace(snapshot(4))
  assert.equal(owner.hasOwnership, false)
})

test('failed requests are also deduplicated until NativeHost acknowledges completion', async () => {
  const owner = new ElectronHostOwnership()
  owner.replace(snapshot(1, [], [{ requestId: 'failed', state: 'queued' }]))
  owner.connected()
  let calls = 0
  const action = async () => { calls++; throw new Error('open failed') }
  await assert.rejects(owner.execute('failed', action), /open failed/)
  await assert.rejects(owner.execute('failed', action), /open failed/)
  assert.equal(calls, 1)
  owner.replace(snapshot(2))
  assert.equal(owner.hasOwnership, false)
})
