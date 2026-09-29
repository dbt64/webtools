import assert from 'node:assert/strict'
import test from 'node:test'
import { isNativeManagerOnly } from './native-manager-mode.ts'

test('Native Host manager-only mode is selected by its flag or explicit environment', () => {
  assert.equal(isNativeManagerOnly(['app', '--manager-only'], {}), true)
  assert.equal(isNativeManagerOnly(['app'], { WEBTOOLS_MANAGER_ONLY: '1' }), true)
  assert.equal(isNativeManagerOnly(['app', '--hidden'], {}), false)
  assert.equal(isNativeManagerOnly(['app'], { WEBTOOLS_MANAGER_ONLY: 'true' }), false)
})
