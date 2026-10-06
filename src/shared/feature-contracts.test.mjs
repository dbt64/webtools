import test from 'node:test'
import assert from 'node:assert/strict'

const loaded = await import('./feature-contracts.ts').then(
  module => ({ module }),
  error => ({ error }),
)

function contracts() {
  assert.ok(loaded.module, `feature-contracts.ts should load: ${loaded.error?.message ?? 'missing module'}`)
  return loaded.module
}

test('FeatureRef accepts closed composite identities with the frozen feature ID grammar', () => {
  const { isFeatureRef, isFeatureId } = contracts()
  assert.equal(isFeatureId('legacy-manager-page'), true)
  assert.equal(isFeatureId('translate-text'), true)
  assert.equal(isFeatureId('a'.repeat(64)), true)
  assert.equal(isFeatureId('a'.repeat(65)), false)
  for (const id of ['', 'Uppercase', 'two words', 'with/slash', 'with.dot', '-leading', 'trailing-', 'double--dash']) {
    assert.equal(isFeatureId(id), false, `unexpectedly accepted ${JSON.stringify(id)}`)
  }

  assert.equal(isFeatureRef({ pluginId: 'org.example.editor', featureId: 'legacy-manager-page' }), true)
  assert.equal(isFeatureRef({ pluginId: 'webtools.translation', featureId: 'translate-text' }), true)
  assert.equal(isFeatureRef({ pluginId: 'org.example.editor', featureId: 'legacy-manager-page', extra: true }), false)
  assert.equal(isFeatureRef({ pluginId: 'org.example.editor' }), false)
  assert.equal(isFeatureRef({ pluginId: 'bad plugin', featureId: 'legacy-manager-page' }), false)
  assert.equal(isFeatureRef({ pluginId: 'a'.repeat(129), featureId: 'legacy-manager-page' }), false)
  assert.equal(isFeatureRef({ pluginId: 'constructor', featureId: 'legacy-manager-page' }), false)
  const symbolField = { pluginId: 'org.example.editor', featureId: 'legacy-manager-page' }
  symbolField[Symbol('extra')] = true
  assert.equal(isFeatureRef(symbolField), false)
  let getterRead = false
  const accessorField = { featureId: 'legacy-manager-page' }
  Object.defineProperty(accessorField, 'pluginId', { enumerable: true, get() { getterRead = true; return 'org.example.editor' } })
  assert.equal(isFeatureRef(accessorField), false)
  assert.equal(getterRead, false)
  assert.equal(isFeatureRef(null), false)
  assert.equal(isFeatureRef([]), false)
})

test('Feature presentation text normalizes Unicode and enforces scalar-value bounds', () => {
  const { normalizeFeatureText } = contracts()
  assert.equal(normalizeFeatureText('  Cafe\u0301\t  Editor  ', 80), 'Café Editor')
  assert.equal(normalizeFeatureText('😀'.repeat(80), 80), '😀'.repeat(80))
  assert.equal(normalizeFeatureText('😀'.repeat(81), 80), null)
  assert.equal(normalizeFeatureText('x'.repeat(49), 48), null)
  assert.equal(normalizeFeatureText('  \t  ', 80), null)
  assert.equal(normalizeFeatureText(42, 80), null)
  assert.equal(normalizeFeatureText('\uD800', 80), null)
})
