import assert from 'node:assert/strict'
import test from 'node:test'
import { isValidTranslationText, TranslationPrefillQueue } from './translation-prefill.ts'

test('keeps only the latest translation until the manager renderer is ready', () => {
  const queue = new TranslationPrefillQueue()
  queue.enqueue({ id: 'first', text: 'first text' })
  queue.enqueue({ id: 'latest', text: 'latest text' })

  assert.equal(queue.getReadyRequest(), null)
  assert.deepEqual(queue.markReady(), { id: 'latest', text: 'latest text' })
})

test('only the matching acknowledgement clears the pending request', () => {
  const queue = new TranslationPrefillQueue()
  queue.enqueue({ id: 'current', text: 'current text' })
  queue.markReady()

  assert.equal(queue.acknowledge('stale'), false)
  assert.deepEqual(queue.getReadyRequest(), { id: 'current', text: 'current text' })
  assert.equal(queue.acknowledge('current'), true)
  assert.equal(queue.getReadyRequest(), null)
})

test('keeps pending input across manager renderer reload and redelivers after readiness', () => {
  const queue = new TranslationPrefillQueue()
  const request = { id: 'reload-safe', text: 'exact source' }
  queue.enqueue(request)
  assert.deepEqual(queue.markReady(), request)

  queue.resetReadiness()
  assert.equal(queue.getReadyRequest(), null)
  assert.deepEqual(queue.markReady(), request)
})

test('a stale acknowledgement cannot clear a newer replacement request', () => {
  const queue = new TranslationPrefillQueue()
  queue.enqueue({ id: 'old', text: 'old text' })
  queue.markReady()
  queue.enqueue({ id: 'new', text: 'new text' })

  assert.equal(queue.acknowledge('old'), false)
  assert.deepEqual(queue.getReadyRequest(), { id: 'new', text: 'new text' })
})

test('failed manager creation can discard only the request that failed', () => {
  const queue = new TranslationPrefillQueue()
  queue.enqueue({ id: 'failed', text: 'failed text' })
  queue.enqueue({ id: 'replacement', text: 'replacement text' })

  assert.equal(queue.discard('failed'), false)
  assert.equal(queue.discard('replacement'), true)
  assert.equal(queue.markReady(), null)
})

test('accepts exact non-empty text through the limit and rejects invalid lengths', () => {
  assert.equal(isValidTranslationText(' text '), true)
  assert.equal(isValidTranslationText('x'.repeat(20_000)), true)
  assert.equal(isValidTranslationText(''), false)
  assert.equal(isValidTranslationText('x'.repeat(20_001)), false)
  assert.equal(isValidTranslationText(null), false)
})
