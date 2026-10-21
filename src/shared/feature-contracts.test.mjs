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

function projectionRow(overrides = {}) {
  return {
    ref: { pluginId: 'org.example.editor', featureId: 'legacy-manager-page' },
    pluginName: 'Editor Tools',
    title: 'Editor',
    commands: ['editor'],
    acceptedContexts: [],
    iconToken: 'plugin',
    featureKind: 'declarative-compatibility',
    group: 'plugin-features',
    ...overrides,
  }
}

function projection(features = []) {
  return {
    projectionVersion: 2,
    hostSessionId: '2e83e777-81e5-47bb-8a5e-1f52e5d7bd34',
    revision: 1,
    generatedAtUnixMs: 1791296400000,
    features,
  }
}

function projectionParser() {
  const parse = contracts().parseFeatureProjectionV2
  assert.equal(typeof parse, 'function', 'Feature Projection v2 parser must be exported')
  return parse
}

test('Feature Projection v2 accepts a closed snapshot and returns a defensive normalized copy', () => {
  const parse = projectionParser()
  const source = projection([projectionRow({ title: '  Cafe\u0301  Editor ', commands: ['  edit\ttext  '] })])
  const parsed = parse(source)
  assert.deepEqual(parsed?.features[0].title, 'Café Editor')
  assert.deepEqual(parsed?.features[0].commands, ['edit text'])
  assert.notEqual(parsed, source)
  parsed.features[0].commands.push('mutated')
  assert.deepEqual(source.features[0].commands, ['  edit\ttext  '])
})

test('Feature Projection v2 rejects malformed identities, unknown fields, duplicate refs, and invalid enums', () => {
  const parse = projectionParser()
  assert.equal(parse({ ...projection(), projectionVersion: 1 }), null)
  assert.equal(parse({ ...projection(), extra: true }), null)
  assert.equal(parse(projection([projectionRow({ ref: { pluginId: 'org.example.editor', featureId: 'bad id' } })])), null)
  assert.equal(parse(projection([projectionRow(), projectionRow()])), null)
  assert.equal(parse(projection([projectionRow({ featureKind: 'web' })])), null)
  assert.equal(parse(projection([projectionRow({ iconToken: 'C:/private/icon.png' })])), null)
  assert.equal(parse({ ...projection(), revision: 0 }), null)
  assert.equal(parse({ ...projection(), hostSessionId: 'not-a-session' }), null)
})

test('Feature Projection v2 rejects overlong and duplicate text plus malformed contexts', () => {
  const parse = projectionParser()
  assert.equal(parse(projection([projectionRow({ pluginName: '😀'.repeat(81) })])), null)
  assert.equal(parse(projection([projectionRow({ title: '😀'.repeat(81) })])), null)
  assert.equal(parse(projection([projectionRow({ commands: ['x'.repeat(49)] })])), null)
  assert.equal(parse(projection([projectionRow({ commands: ['Edit', ' edit '] })])), null)
  assert.equal(parse(projection([projectionRow({ commands: Array(9).fill('command') })])), null)
  assert.equal(parse(projection([projectionRow({ acceptedContexts: [{ type: 'clipboard', sources: ['clipboard'] }] })])), null)
  assert.equal(parse(projection([projectionRow({ acceptedContexts: [{ type: 'text', sources: ['filesystem'] }] })])), null)
  assert.equal(parse(projection([projectionRow({ acceptedContexts: [{ type: 'text', sources: [] }] })])), null)
})

test('Feature Projection v2 enforces per-plugin and global feature-count limits', () => {
  const parse = projectionParser()
  const perPlugin = Array.from({ length: 64 }, (_, index) => projectionRow({
    ref: { pluginId: 'org.example.editor', featureId: `feature-${index}` },
  }))
  assert.notEqual(parse(projection(perPlugin)), null)
  const tooManyForPlugin = [...perPlugin, projectionRow({ ref: { pluginId: 'org.example.editor', featureId: 'feature-64' } })]
  assert.equal(parse(projection(tooManyForPlugin)), null)
  const globalLimit = Array.from({ length: 2000 }, (_, index) => projectionRow({
    ref: { pluginId: `org.example.p${index}`, featureId: 'feature' },
  }))
  assert.notEqual(parse(projection(globalLimit)), null)
  assert.equal(parse(projection([...globalLimit, projectionRow({ ref: { pluginId: 'org.example.over', featureId: 'feature' } })])), null)
})

test('Feature Projection v2 measures the exact 3 MiB UTF-8 boundary, including multibyte text', () => {
  const parse = projectionParser()
  const maxBytes = 3 * 1024 * 1024
  let exact = null
  for (let repeatedEmoji = 47; repeatedEmoji >= 0 && !exact; repeatedEmoji -= 1) {
    const features = Array.from({ length: 2000 }, (_, index) => projectionRow({
      ref: { pluginId: `org.example.p${index}`, featureId: 'feature' },
      commands: Array.from({ length: 8 }, (_, alias) => `${String.fromCharCode(97 + alias)}${'😀'.repeat(repeatedEmoji)}`),
    }))
    const candidate = projection(features)
    const bytes = Buffer.byteLength(JSON.stringify(candidate), 'utf8')
    if (bytes > maxBytes) continue
    let remaining = maxBytes - bytes
    for (const row of candidate.features) {
      const added = Math.min(remaining, 80 - row.pluginName.length)
      if (added > 0) { row.pluginName += 'p'.repeat(added); remaining -= added }
      if (remaining === 0) break
    }
    if (remaining === 0 && Buffer.byteLength(JSON.stringify(candidate), 'utf8') === maxBytes) exact = candidate
  }
  assert.ok(exact, 'test fixture must land exactly on the UTF-8 byte cap')
  assert.ok(Buffer.byteLength(JSON.stringify(exact), 'utf8') === maxBytes)
  assert.notEqual(parse(exact), null)
  const oneByteOver = structuredClone(exact)
  oneByteOver.generatedAtUnixMs = 17912964000000
  assert.equal(Buffer.byteLength(JSON.stringify(oneByteOver), 'utf8'), maxBytes + 1)
  assert.equal(parse(oneByteOver), null)
})

test('Feature Projection content identity ignores diagnostics, session and revision fields', () => {
  const { featureProjectionContentIdentity } = contracts()
  const one = projection([projectionRow()])
  const two = { ...one, hostSessionId: '1e83e777-81e5-47bb-8a5e-1f52e5d7bd34', revision: 9, generatedAtUnixMs: 1791296401000 }
  assert.equal(featureProjectionContentIdentity(one), featureProjectionContentIdentity(two))
  assert.notEqual(featureProjectionContentIdentity(one), featureProjectionContentIdentity(projection([projectionRow({ title: 'Changed' })])))
})
