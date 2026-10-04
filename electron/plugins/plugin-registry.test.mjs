import test from 'node:test'
import assert from 'node:assert/strict'
import { validateRegistry } from './plugin-registry.ts'

const legacy = () => ({ registryVersion: 1, plugins: [{ id: 'org.example.old', name: 'Old', current: { version: '1.0.0', hash: 'a'.repeat(64) }, versions: [{ version: '1.0.0', hash: 'a'.repeat(64) }], enabled: false, requested: ['manager.page'], granted: [], status: 'installed-disabled' }] })

test('5C registry entries without 5D presentation metadata remain readable', () => {
  const data = validateRegistry(legacy())
  assert.equal(data.plugins[0].name, 'Old')
  assert.equal(data.plugins[0].description, undefined)
  assert.equal(data.plugins[0].author, undefined)
})

test('5D safe summary metadata validates and persists alongside the 5C registry contract', () => {
  const entry = legacy().plugins[0]
  const data = validateRegistry({ registryVersion: 1, plugins: [{ ...entry, description: 'Local package', author: { name: 'Author', url: 'https://example.org/' }, api: { apiMajor: 1, minHostVersion: '0.1.0' }, source: 'local-unsigned' }] })
  assert.deepEqual(data.plugins[0].author, { name: 'Author', url: 'https://example.org/' })
  assert.equal(data.plugins[0].source, 'local-unsigned')
  for (const invalid of [
    { description: 'x'.repeat(513) },
    { author: { name: 'Author', url: 'javascript:alert(1)' } },
    { api: { apiMajor: 2, minHostVersion: '0.1.0' } },
    { source: 'verified-publisher' },
  ]) assert.throws(() => validateRegistry({ registryVersion: 1, plugins: [{ ...entry, ...invalid }] }))
})
