import test from 'node:test'
import assert from 'node:assert/strict'
import { NativeFeatureProjectionPublisher } from './native-feature-projection-publisher.ts'

function snapshot(revision, title = `Feature ${revision}`) {
  return {
    projectionVersion: 2,
    hostSessionId: '2e83e777-81e5-47bb-8a5e-1f52e5d7bd34',
    revision,
    generatedAtUnixMs: 1791296400000,
    features: [{
      ref: { pluginId: 'org.example.publisher', featureId: 'feature' },
      pluginName: 'Publisher',
      title,
      commands: [],
      acceptedContexts: [],
      iconToken: 'plugin',
      featureKind: 'declarative-compatibility',
      group: 'plugin-features',
    }],
  }
}

test('Feature projection publisher serializes complete snapshots and reads current state inside its queue', async () => {
  let release
  let current = snapshot(1)
  const sent = []
  const publisher = new NativeFeatureProjectionPublisher(async () => structuredClone(current), async (projection, serialized) => {
    sent.push({ projection, serialized })
    if (sent.length === 1) await new Promise(resolve => { release = resolve })
    return { hostSessionId: projection.hostSessionId, revision: projection.revision }
  })
  const first = publisher.sync()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(sent.length, 1)
  current = snapshot(2)
  const second = publisher.sync()
  current = snapshot(3)
  const third = publisher.sync()
  release()
  await Promise.all([first, second, third])
  assert.deepEqual(sent.map(item => JSON.parse(item.serialized).revision), [1, 3, 3])
  assert.deepEqual(sent[2].projection, snapshot(3))
})

test('Feature projection publisher validates before enqueue, recovers after failure, and suppresses late work after close', async () => {
  let failures = 0
  let accepted = 0
  let current = snapshot(1)
  const publisher = new NativeFeatureProjectionPublisher(async () => structuredClone(current), async projection => {
    if (failures > 0) { failures -= 1; throw new Error('queue unavailable') }
    accepted += 1
    return { hostSessionId: projection.hostSessionId, revision: projection.revision }
  })
  failures = 1
  await assert.rejects(publisher.sync(), /queue unavailable/)
  await publisher.sync()
  assert.equal(accepted, 1)
  current = { ...snapshot(2), featurePrivatePath: 'must-be-rejected' }
  await assert.rejects(publisher.sync(), /invalid Feature Projection/i)
  assert.equal(accepted, 1)
  current = snapshot(3)
  let release
  const late = new NativeFeatureProjectionPublisher(() => new Promise(resolve => { release = resolve }), async projection => {
    accepted += 1
    return { hostSessionId: projection.hostSessionId, revision: projection.revision }
  })
  const pending = late.sync()
  await new Promise(resolve => setImmediate(resolve))
  late.close()
  release(snapshot(4))
  await pending
  assert.equal(accepted, 1)
})

test('derived projection queue failures can be reported without changing Main authority results', async () => {
  let available = false
  let reports = 0
  const publisher = new NativeFeatureProjectionPublisher(async () => snapshot(1), async projection => {
    if (!available) throw new Error('not negotiated')
    return { hostSessionId: projection.hostSessionId, revision: projection.revision }
  })
  assert.equal(await publisher.trySync(() => { reports += 1 }), false)
  available = true
  assert.equal(await publisher.trySync(() => { reports += 1 }), true)
  assert.equal(reports, 1)
})

test('Feature projection publisher rejects acknowledgements for a different session or revision', async () => {
  let ack = { hostSessionId: snapshot(1).hostSessionId, revision: 0 }
  let reports = 0
  const publisher = new NativeFeatureProjectionPublisher(() => snapshot(1), async () => ack)
  assert.equal(await publisher.trySync(() => { reports += 1 }), false)
  ack = { hostSessionId: snapshot(1).hostSessionId, revision: 1 }
  assert.equal(await publisher.trySync(() => { reports += 1 }), true)
  assert.equal(reports, 1)
})
