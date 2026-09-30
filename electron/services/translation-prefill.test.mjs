import assert from 'node:assert/strict'
import test from 'node:test'
import { isValidTranslationText } from './translation-prefill.ts'

test('accepts exact non-empty text through the limit and rejects invalid lengths', () => {
  assert.equal(isValidTranslationText(' text '), true)
  assert.equal(isValidTranslationText('x'.repeat(20_000)), true)
  assert.equal(isValidTranslationText(''), false)
  assert.equal(isValidTranslationText('x'.repeat(20_001)), false)
  assert.equal(isValidTranslationText(null), false)
})
