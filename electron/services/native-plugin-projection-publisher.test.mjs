import test from 'node:test'
import assert from 'node:assert/strict'
import { NativePluginProjectionPublisher } from './native-plugin-projection-publisher.ts'

test('projection updates serialize across asynchronous sends and capture current authority inside the queue', async () => {
  let release; let version = 1
  const sent = []
  const publisher = new NativePluginProjectionPublisher(async () => ({ projectionVersion: 1, plugins: [{ version }] }), async projection => {
    sent.push(projection.plugins[0].version)
    if (sent.length === 1) await new Promise(resolve => { release = resolve })
  })
  const first = publisher.sync()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(sent, [1])
  version = 2; const second = publisher.sync(); version = 3; const third = publisher.sync()
  release(); await Promise.all([first, second, third])
  assert.deepEqual(sent, [1, 3, 3], 'queued refreshes must not hold an obsolete snapshot')
})
test('a failed transport does not poison future synchronization; close prevents late sends', async () => {
  let calls = 0
  const publisher = new NativePluginProjectionPublisher(async () => ({ projectionVersion: 1, plugins: [] }), async () => { if (++calls === 1) throw new Error('disconnected') })
  await assert.rejects(publisher.sync(), /disconnected/)
  await publisher.sync(); assert.equal(calls, 2)
  publisher.close(); await publisher.sync(); assert.equal(calls, 2)
  let complete
  const late = new NativePluginProjectionPublisher(() => new Promise(resolve => { complete = resolve }), async () => { throw new Error('late send') })
  const pending = late.sync(); await new Promise(resolve => setImmediate(resolve)); late.close()
  complete({ projectionVersion: 1, plugins: [] }); await pending
})

test('derived cache failure is reported but cannot reject authoritative Manager initialization/mutations', async () => {
  let available = false; let reports = 0
  const publisher = new NativePluginProjectionPublisher(async () => ({ projectionVersion: 1, plugins: [] }), async () => { if (!available) throw new Error('cache unavailable') })
  assert.equal(await publisher.trySync(() => { reports += 1 }), false)
  assert.equal(reports, 1)
  available = true; assert.equal(await publisher.trySync(() => { reports += 1 }), true)
  assert.equal(reports, 1)
})
