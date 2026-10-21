import assert from 'node:assert/strict'
import test from 'node:test'
import { parseFeatureTextResult, parseFeatureQuickResultPayload, parseFeatureResultControl, parseQuickResultJson } from './feature-quick-result-contracts.ts'

test('whitespace uses the same explicit ECMAScript trim semantics as Native', () => {
  assert.equal(parseFeatureTextResult({ kind: 'text', text: '\ufeff' }), null)
  assert.deepEqual(parseFeatureTextResult({ kind: 'text', text: '\u0085' }), { kind: 'text', text: '\u0085' })
})
import { parseFeatureInvocationRequest } from './feature-invocation-contracts.ts'

const requestId = '6528d127-0182-4a60-9e4b-8c89070c50f0'
const ref = { pluginId: 'org.example.result', featureId: 'quick-text' }
const payload = text => ({ resultVersion: 1, requestId, ref, text })

test('text result accepts exact scalar/UTF8 boundaries and normalizes only line endings', () => {
  for (const text of ['a'.repeat(8192), '😀'.repeat(8192), ' 中文  😀\r\nnext\rlast ']) {
    assert.deepEqual(parseFeatureTextResult({ kind: 'text', text }), { kind: 'text', text: text.replace(/\r\n?/g, '\n') })
  }
  for (const text of ['a'.repeat(8193), '😀'.repeat(8193), '\ud800', '\udfff', 'x\0', 'x\u0001', ' \n\t']) {
    assert.equal(parseFeatureTextResult({ kind: 'text', text }), null)
  }
})

test('result parser rejects getters, forged metadata, extra fields and non-data values', () => {
  let read = false
  for (const value of [null, [], { kind: 'html', text: 'x' }, { kind: 'text', text: 1 },
    { kind: 'text', text: 'x', requestId }, { kind: 'text', get text() { read = true; return 'x' } }]) {
    assert.equal(parseFeatureTextResult(value), null)
  }
  assert.equal(read, false)
  assert.deepEqual(parseFeatureQuickResultPayload(payload('exact')), payload('exact'))
  for (const value of [{ ...payload('x'), requestId: 'bad' }, { ...payload('x'), ref: { ...ref, path: 'forged' } },
    { ...payload('x'), resultVersion: 2 }, { ...payload('x'), extra: true }]) assert.equal(parseFeatureQuickResultPayload(value), null)
  assert.deepEqual(parseFeatureResultControl({ requestId, ref }), { requestId, ref })
  assert.equal(parseFeatureResultControl({ requestId, ref, text: 'forged' }), null)
})

test('raw JSON rejects duplicate and escaped duplicate keys, malformed JSON and excessive envelope', () => {
  assert.deepEqual(parseQuickResultJson(JSON.stringify(payload('😀'))), payload('😀'))
  for (const raw of ['{"text":"a","text":"b"}', '{"text":"a","\\u0074ext":"b"}',
    '{"ref":{"id":1,"id":2}}', '{', ' '.repeat(66000) + '{}']) assert.equal(parseQuickResultJson(raw), null)
})

test('Quick Result request is negotiated separately and only fits selected-text Super Panel shape', () => {
  const context = { type: 'text', source: 'selected-text', text: 'selected', capturedAtUnixMs: 1 }
  const value = { requestId, ref, source: 'super-panel', context, quickResult: { version: 1 } }
  assert.deepEqual(parseFeatureInvocationRequest(value), value)
  for (const bad of [{ ...value, quickResult: { version: 2 } }, { ...value, quickResult: { version: 1, target: 'forged' } },
    { ...value, context: undefined }, { ...value, source: 'launcher', context: { ...context, source: 'launcher-input' } }]) {
    assert.equal(parseFeatureInvocationRequest(bad), null)
  }
})
