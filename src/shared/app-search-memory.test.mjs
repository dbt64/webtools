import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getRememberedAppId,
  normalizeAppSearchQuery,
  promoteRememberedAppResult,
  rememberAppSearchResult,
  sanitizeAppSearchMemory,
} from './app-search-memory.ts'

const firstAppId = 'a111111111111111'
const secondAppId = 'b222222222222222'

test('normalizes remembered queries case-insensitively and ignores overlong input', () => {
  assert.equal(normalizeAppSearchQuery('  Visual Studio Code  '), 'visualstudiocode')
  assert.equal(normalizeAppSearchQuery('x'.repeat(128)), 'x'.repeat(128))
  assert.equal(normalizeAppSearchQuery('x'.repeat(129)), '')
})

test('records and replaces the app remembered for a normalized query', () => {
  const first = rememberAppSearchResult({}, '  V.S. Code  ', firstAppId, 100)
  const replaced = rememberAppSearchResult(first, 'vs code', secondAppId, 200)

  assert.equal(getRememberedAppId(replaced, 'VS Code'), secondAppId)
  assert.deepEqual(replaced.vscode, { appId: secondAppId, lastUsedAt: 200 })
  assert.equal(Object.keys(replaced).length, 1)
})

test('does not record empty, overlong, or invalid application selections', () => {
  const memory = { orbit: { appId: firstAppId, lastUsedAt: 100 } }

  assert.equal(rememberAppSearchResult(memory, '', secondAppId, 200), memory)
  assert.equal(rememberAppSearchResult(memory, 'x'.repeat(129), secondAppId, 200), memory)
  assert.equal(rememberAppSearchResult(memory, 'orbit', 'not-an-app-id', 200), memory)
  assert.equal(getRememberedAppId(memory, 'no match'), null)
})

test('sanitizes malformed memory records and keeps the newest hundred valid queries', () => {
  const malformed = sanitizeAppSearchMemory({
    query: { appId: firstAppId, lastUsedAt: 10 },
    Query: { appId: secondAppId, lastUsedAt: 20 },
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

test('promotes the remembered application without changing other result order', () => {
  const results = [
    { entry: { id: 'website-1', kind: 'website' } },
    { entry: { id: firstAppId, kind: 'app' } },
    { entry: { id: secondAppId, kind: 'app' } },
  ]
  const promoted = promoteRememberedAppResult(results, secondAppId)

  assert.deepEqual(promoted.map(({ entry }) => entry.id), [secondAppId, 'website-1', firstAppId])
  assert.deepEqual(results.map(({ entry }) => entry.id), ['website-1', firstAppId, secondAppId])
  assert.equal(promoteRememberedAppResult(results, 'missing-app'), results)
  assert.equal(promoteRememberedAppResult(results, 'website-1'), results)
})
