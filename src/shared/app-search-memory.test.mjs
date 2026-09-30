import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeAppSearchMemory } from './app-search-memory.ts'

const firstAppId = 'a111111111111111'
test('preserves only valid, normalized migration records and caps the legacy memory', () => {
  const malformed = sanitizeAppSearchMemory({
    query: { appId: firstAppId, lastUsedAt: 10 },
    Query: { appId: 'b222222222222222', lastUsedAt: 20 },
    invalidId: { appId: 'not-an-app-id', lastUsedAt: 30 },
    invalidTime: { appId: firstAppId, lastUsedAt: Number.NaN },
    ['x'.repeat(129)]: { appId: firstAppId, lastUsedAt: 40 },
  })
  const capacityInput = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [
    `query${index}`,
    { appId: index.toString(16).padStart(16, '0'), lastUsedAt: index },
  ]))
  const capped = sanitizeAppSearchMemory(capacityInput)

  assert.deepEqual(malformed, { query: { appId: firstAppId, lastUsedAt: 10 } })
  assert.equal(Object.keys(capped).length, 100)
  assert.equal(capped.query100.appId, '0000000000000064')
  assert.equal('query0' in capped, false)
})
