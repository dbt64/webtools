import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseManifestV3 } from '../runtime-v3/manifest-v3.mjs'
import { parseManifestV3 as hostParse } from '../../../electron/plugins/manifest-v3.ts'
import { parseFeatureProjectionV2 } from '../../../src/shared/feature-contracts.ts'
import { acceptsInvocationContext } from '../web/invocation-context.mjs'
import { runtimeV3Manifest } from '../../../electron/plugins/fixtures.mjs'

const rule = { type: 'text', sources: ['selected-text'], textMatch: 'http-url' }
const manifest = context => {
  const value = runtimeV3Manifest()
  return { ...value, features: [{ ...value.features[0], acceptedContexts: [context] }] }
}
const bytes = value => Buffer.from(JSON.stringify(value))
const host = { platform: 'win32', architecture: 'x64', nodeAbi: '149' }
const corpus = JSON.parse(await readFile(new URL('../../../tests/fixtures/selected-text-matching.json', import.meta.url), 'utf8'))

test('SDK and authoritative Host preserve only the approved selected-text URL rule', () => {
  const sdk = parseManifestV3(bytes(manifest(rule)), '0.1.0', host).manifest
  const installed = hostParse(bytes(manifest(rule)), '0.1.0', host)
  assert.deepEqual(sdk.features[0].acceptedContexts, [rule])
  assert.deepEqual(installed.features[0].acceptedContexts, [rule])
  for (const invalid of [
    { ...rule, textMatch: 'english' }, { ...rule, textMatch: ['http-url'] },
    { ...rule, textMatch: null }, { ...rule, pattern: '.*' },
    { ...rule, type: 'none', sources: [] }, { ...rule, type: 'files', sources: ['explorer-selection'] },
    { ...rule, sources: ['clipboard'] }, { ...rule, sources: ['selected-text', 'launcher-input'] },
  ]) {
    assert.throws(() => parseManifestV3(bytes(manifest(invalid)), '0.1.0', host))
    assert.throws(() => hostParse(bytes(manifest(invalid)), '0.1.0', host))
  }
  const legacy = { type: 'text', sources: ['selected-text', 'clipboard'] }
  assert.deepEqual(hostParse(bytes(manifest(legacy)), '0.1.0', host).features[0].acceptedContexts,
    [{ type: 'text', sources: ['clipboard', 'selected-text'] }])
})

test('projection round trip contains matcher metadata and never selection values', () => {
  const projection = context => ({ projectionVersion: 2, hostSessionId: '2e83e777-81e5-47bb-8a5e-1f52e5d7bd34', revision: 2, generatedAtUnixMs: 1,
    features: [{ ref: { pluginId: 'org.example.actions', featureId: 'open-link' }, pluginName: 'Text Actions', title: 'Open link', commands: [],
      acceptedContexts: [context], iconToken: 'globe', featureKind: 'runtime-v3', presentation: 'command', group: 'plugin-features' }] })
  const parsed = parseFeatureProjectionV2(projection(rule))
  assert.ok(parsed)
  assert.deepEqual(parsed.features[0].acceptedContexts, [rule])
  assert.equal(parseFeatureProjectionV2(projection({ ...rule, textMatch: 'unknown' })), null)
  assert.equal(parseFeatureProjectionV2(projection({ ...rule, text: 'PRIVATE_SELECTION_SENTINEL' })), null)
  assert.equal(JSON.stringify(parsed).includes('PRIVATE_SELECTION_SENTINEL'), false)
})

test('local content matching refines selection while preserving general text and file behavior', () => {
  for (const item of corpus) {
    const context = { type: 'text', source: 'selected-text', text: item.text }
    assert.equal(acceptsInvocationContext([rule], context), item.matches, JSON.stringify(item.text))
    assert.equal(acceptsInvocationContext([{ type: 'text', sources: ['selected-text'] }], context), true)
  }
  assert.equal(acceptsInvocationContext([rule], { type: 'text', source: 'clipboard', text: 'https://example.com' }), false)
  assert.equal(acceptsInvocationContext([rule], { type: 'text', source: 'selected-text', text: 'https://example.com/\ud800' }), false)
  const prefix = 'https://example.com/?q='
  assert.equal(acceptsInvocationContext([rule], { type: 'text', source: 'selected-text', text: prefix + 'x'.repeat(3000 - prefix.length) }), true)
  assert.equal(acceptsInvocationContext([rule], { type: 'text', source: 'selected-text', text: prefix + 'x'.repeat(3001 - prefix.length) }), false)
  assert.equal(acceptsInvocationContext([{ type: 'files', sources: ['explorer-selection'], extensions: ['.txt'] }],
    { type: 'files', source: 'explorer-selection', items: [{ kind: 'file', path: 'D:\\example.txt' }] }), true)
})
