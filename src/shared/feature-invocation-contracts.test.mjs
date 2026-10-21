import assert from 'node:assert/strict'
import test from 'node:test'
import { parseFeatureInvocationRequest, parseFeatureInvocationResult } from './feature-invocation-contracts.ts'

const requestId = '6528d127-0182-4a60-9e4b-8c89070c50f0'
const ref = { pluginId: 'org.example.private-notes', featureId: 'legacy-manager-page' }
test('panel dismissal is an optional completed-only Host disposition with an exact true value', () => {
  const value = { requestId, status: 'completed', reasonCode: 'completed', dismissPanel: true }
  assert.deepEqual(parseFeatureInvocationResult(value), value)
  for (const bad of [{ ...value, dismissPanel: false }, { ...value, dismissPanel: 'true' },
    { ...value, status: 'accepted', reasonCode: 'accepted' }, { ...value, status: 'cancelled', reasonCode: 'cancelled' },
    { ...value, status: 'failed', reasonCode: 'command-failed' }, { ...value, text: 'must not leak selection' }]) {
    assert.equal(parseFeatureInvocationResult(bad), null)
  }
})
test('typed Launcher context preserves exact text and rejects generic payload, clipboard source, excess and malformed timestamp', () => {
  const context = { type: 'text', source: 'launcher-input', text: ' 中文 exact 😀 ', capturedAtUnixMs: 123456 }
  const value = { requestId, ref, source: 'launcher', context }
  assert.deepEqual(parseFeatureInvocationRequest(value), value)
  for (const bad of [{ ...context, pluginId: 'forged' }, { ...context, source: 'clipboard' }, { ...context, text: 'x'.repeat(301) },
    { ...context, capturedAtUnixMs: -1 }, { ...context, capturedAtUnixMs: Infinity }]) {
    assert.equal(parseFeatureInvocationRequest({ ...value, context: bad }), null)
  }
  assert.ok(parseFeatureInvocationRequest({ ...value, context: { ...context, text: 'x'.repeat(300) } }))
})

test('Feature invocation request accepts bounded closed launcher and Super Panel requests', () => {
  assert.deepEqual(parseFeatureInvocationRequest({ requestId, ref, source: 'launcher' }), { requestId, ref, source: 'launcher' })
  assert.deepEqual(parseFeatureInvocationRequest({ requestId, ref, source: 'super-panel' }), { requestId, ref, source: 'super-panel' })
  for (const value of [
    null,
    { requestId: 'not-a-uuid', ref, source: 'launcher' },
    { requestId, ref, source: 'unsupported' },
    { requestId, ref: { ...ref, pageId: 'home' }, source: 'launcher' },
    { requestId, ref, source: 'launcher', pageId: 'home' },
    { requestId, ref: { pluginId: 'webtools.translation', featureId: 'translate-text', path: 'C:\\secret' }, source: 'launcher' },
  ]) assert.equal(parseFeatureInvocationRequest(value), null)

  assert.equal(parseFeatureInvocationRequest({ requestId, ref: { pluginId: 'a'.repeat(5000), featureId: 'legacy-manager-page' }, source: 'launcher' }), null)
})

test('Feature invocation response has bounded status-specific reason codes and exact correlation', () => {
  assert.deepEqual(parseFeatureInvocationResult({ requestId, status: 'accepted', reasonCode: 'accepted' }), {
    requestId, status: 'accepted', reasonCode: 'accepted',
  })
  assert.deepEqual(parseFeatureInvocationResult({ requestId, status: 'rejected', reasonCode: 'plugin-disabled' }), {
    requestId, status: 'rejected', reasonCode: 'plugin-disabled',
  })
  assert.deepEqual(parseFeatureInvocationResult({ requestId, status: 'failed', reasonCode: 'manager-timeout' }), {
    requestId, status: 'failed', reasonCode: 'manager-timeout',
  })
  for (const value of [
    { requestId: 'bad', status: 'accepted', reasonCode: 'accepted' },
    { requestId, status: 'accepted', reasonCode: 'plugin-disabled' },
    { requestId, status: 'rejected', reasonCode: 'manager-timeout' },
    { requestId, status: 'failed', reasonCode: 'plugin-disabled' },
    { requestId, status: 'accepted', reasonCode: 'accepted', message: 'extra' },
  ]) assert.equal(parseFeatureInvocationResult(value), null)
})
