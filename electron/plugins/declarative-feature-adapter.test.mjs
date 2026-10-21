import test from 'node:test'
import assert from 'node:assert/strict'
import { manifest } from './fixtures.mjs'
import { parseManifest } from './manifest.ts'

const loaded = await Promise.all([
  import('./feature-contracts.ts').then(module => ({ module }), error => ({ error })),
  import('./declarative-feature-adapter.ts').then(module => ({ module }), error => ({ error })),
])

function featureContracts() {
  assert.ok(loaded[0].module, `feature-contracts.ts should load: ${loaded[0].error?.message ?? 'missing module'}`)
  return loaded[0].module
}

function adapter() {
  assert.ok(loaded[1].module, `declarative-feature-adapter.ts should load: ${loaded[1].error?.message ?? 'missing module'}`)
  return loaded[1].module
}

function validated(value) {
  return parseManifest(Buffer.from(JSON.stringify(value)), '0.1.0')
}

test('built-in Translation has the frozen FeatureRef without owning lifecycle state', () => {
  const { BUILTIN_TRANSLATION_FEATURE } = featureContracts()
  assert.deepEqual(BUILTIN_TRANSLATION_FEATURE.ref, { pluginId: 'webtools.translation', featureId: 'translate-text' })
  assert.equal(BUILTIN_TRANSLATION_FEATURE.sourceKind, 'built-in')
  assert.deepEqual(BUILTIN_TRANSLATION_FEATURE.resolvedEntry, { kind: 'built-in', key: 'translation' })
  assert.deepEqual(BUILTIN_TRANSLATION_FEATURE.requiredCapabilities, [])
  assert.deepEqual(BUILTIN_TRANSLATION_FEATURE.acceptedContexts, [])
  assert.equal(Object.hasOwn(BUILTIN_TRANSLATION_FEATURE, 'enabled'), false)
  assert.equal(Object.hasOwn(BUILTIN_TRANSLATION_FEATURE, 'granted'), false)
})

test('Manifest v1 maps deterministically to one Main-only compatibility Feature', () => {
  const { adaptDeclarativeV1Feature } = adapter()
  const source = validated(manifest({ id: 'org.example.notes', name: '  Cafe\u0301   Notes  ', entry: { pageId: 'home', label: 'Private Notes' } }))
  const before = structuredClone(source)
  const first = adaptDeclarativeV1Feature(source)
  const second = adaptDeclarativeV1Feature(source)

  assert.deepEqual(first, {
    ref: { pluginId: 'org.example.notes', featureId: 'legacy-manager-page' },
    sourceKind: 'declarative',
    title: 'Private Notes',
    commands: ['Café Notes', 'Private Notes'],
    icon: 'plugin',
    requiredCapabilities: ['manager.page'],
    acceptedContexts: [],
    resolvedEntry: { kind: 'declarative-compatibility', pageId: 'home' },
  })
  assert.deepEqual(second, first)
  assert.equal(Object.hasOwn(first, 'enabled'), false)
  assert.equal(Object.hasOwn(first, 'granted'), false)
  assert.deepEqual(source, before)
})

test('adapter refuses a missing page or a source without manager.page instead of inventing a Feature', () => {
  const { adaptDeclarativeV1Feature } = adapter()
  const missingPage = manifest({ entry: { pageId: 'missing', label: 'Missing' } })
  const noCapability = manifest({ requestedCapabilities: [] })
  assert.equal(adaptDeclarativeV1Feature(missingPage), null)
  assert.equal(adaptDeclarativeV1Feature(noCapability), null)
})

test('adapter normalizes and deduplicates existing names, bounds aliases, and retains only a safe icon token', () => {
  const { adaptDeclarativeV1Feature } = adapter()
  const source = validated(manifest({
    id: 'org.example.aliases',
    name: '  Cafe\u0301   Notes  ',
    entry: { pageId: 'home', label: 'Café Notes' },
  }))
  const result = adaptDeclarativeV1Feature(source)
  assert.deepEqual(result.commands, ['Café Notes'])
  assert.equal(result.icon, 'plugin')
  assert.equal(JSON.stringify(result).includes('iconDataUrl'), false)
  assert.equal(JSON.stringify(result).includes('assets/'), false)

  const longName = validated(manifest({ id: 'org.example.longname', name: 'x'.repeat(49), entry: { pageId: 'home', label: 'Home' } }))
  const bounded = adaptDeclarativeV1Feature(longName)
  assert.deepEqual(bounded.commands, ['Home'])
  assert.ok(bounded.commands.every(command => Array.from(command).length <= 48))
})

test('an unusable optional plugin-name alias does not suppress a valid Feature', () => {
  const { adaptDeclarativeV1Feature } = adapter()
  const whitespaceName = validated(manifest({ name: '   ', entry: { pageId: 'home', label: 'Home' } }))
  const normalizationExpansion = validated(manifest({ name: '\u0344'.repeat(41), entry: { pageId: 'home', label: 'Home' } }))

  for (const source of [whitespaceName, normalizationExpansion]) {
    const result = adaptDeclarativeV1Feature(source)
    assert.ok(result)
    assert.equal(result.title, 'Home')
    assert.deepEqual(result.commands, ['Home'])
  }
})

test('different plugin IDs remain distinct and a same-ID declarative Feature does not collide with Translation', () => {
  const { BUILTIN_TRANSLATION_FEATURE } = featureContracts()
  const { adaptDeclarativeV1Feature } = adapter()
  const first = adaptDeclarativeV1Feature(validated(manifest({ id: 'org.example.one' })))
  const second = adaptDeclarativeV1Feature(validated(manifest({ id: 'org.example.two' })))
  const samePluginIdAsBuiltin = adaptDeclarativeV1Feature(validated(manifest({ id: 'webtools.translation' })))

  assert.deepEqual(first.ref, { pluginId: 'org.example.one', featureId: 'legacy-manager-page' })
  assert.deepEqual(second.ref, { pluginId: 'org.example.two', featureId: 'legacy-manager-page' })
  assert.notDeepEqual(first.ref, second.ref)
  assert.deepEqual(samePluginIdAsBuiltin.ref, { pluginId: 'webtools.translation', featureId: 'legacy-manager-page' })
  assert.notDeepEqual(samePluginIdAsBuiltin.ref, BUILTIN_TRANSLATION_FEATURE.ref)
})
