import test from 'node:test'
import assert from 'node:assert/strict'
import { TranslationRequestGate } from './translation-request-gate.ts'

test('a newer translation request prevents an older response from becoming current', () => {
  const gate = new TranslationRequestGate()
  const older = gate.begin('request-a')
  const newer = gate.begin('request-b')
  assert.equal(gate.isCurrent(older), false)
  assert.equal(gate.isCurrent(newer), true)
  assert.equal(gate.finish(older), false)
  assert.equal(gate.isCurrent(newer), true)
})

test('editing or changing languages invalidates an in-flight result immediately', () => {
  const gate = new TranslationRequestGate()
  const token = gate.begin('request-a')
  assert.equal(gate.invalidate(), 'request-a')
  assert.equal(gate.isCurrent(token), false)
  assert.equal(gate.currentRequestId, null)
})

test('completed request results stay copyable until new input changes the generation', () => {
  const gate = new TranslationRequestGate()
  const token = gate.begin('request-a')
  assert.equal(gate.finish(token), true)
  assert.equal(gate.isGenerationCurrent(token.generation), true)
  gate.invalidate()
  assert.equal(gate.isGenerationCurrent(token.generation), false)
})
