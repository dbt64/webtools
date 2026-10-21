import test from 'node:test'
import assert from 'node:assert/strict'
import { parseManifestV3 } from './manifest-v3.mjs'
import { runtimeV3Manifest } from '../../electron/plugins/fixtures.mjs'
import { resolveConfigurationValues } from '../declarative-v1/runtime-v3/configuration.mjs'

export const configuration = () => ({ schemaVersion: 1, settings: [
  { key: 'label', label: 'Label', type: 'text', minLength: 0, maxLength: 16, default: 'hello' },
  { key: 'locale', label: 'Locale', type: 'enum', options: ['en', 'zh'], default: 'en' },
  { key: 'compact', label: 'Compact', type: 'boolean', default: false },
  { key: 'limit', label: 'Limit', type: 'number', min: 1, max: 10, default: 4 },
] })
const parse = value => parseManifestV3(Buffer.from(JSON.stringify(value)), '0.1.0', { platform: 'win32', architecture: 'x64' }).manifest

test('v3 optional typed configuration is normalized into immutable package metadata', () => {
  const input = configuration()
  const result = parse(runtimeV3Manifest({ configuration: input }))
  assert.deepEqual(result.configuration, input)
  assert.ok(Object.isFrozen(result.configuration))
  assert.ok(Object.isFrozen(result.configuration.settings))
  assert.ok(Object.isFrozen(result.configuration.settings[1].options))
})

test('existing v3 manifests with config requests and no descriptor remain loadable', () => {
  assert.equal(parse(runtimeV3Manifest({ requestedCapabilities: ['plugin.config.read'] })).configuration, undefined)
})

test('configuration rejects schema version, unknown fields, duplicate keys and malformed defaults', () => {
  const valid = configuration()
  for (const invalid of [
    { ...valid, schemaVersion: 0 }, { ...valid, schemaVersion: 1.5 }, { ...valid, schemaVersion: 2147483648 },
    { ...valid, script: 'eval()' }, { ...valid, settings: [...valid.settings, valid.settings[0]] },
    { ...valid, settings: [{ ...valid.settings[0], default: 42 }] },
    { ...valid, settings: [{ ...valid.settings[1], options: ['en', 'en'] }] },
    { ...valid, settings: [{ ...valid.settings[3], min: 10, max: 1 }] },
    { ...valid, settings: [{ ...valid.settings[0], type: 'password' }] },
    { ...valid, settings: [{ ...valid.settings[0], key: '__proto__' }] },
  ]) assert.throws(() => parse(runtimeV3Manifest({ configuration: invalid })))
})

test('configuration descriptor count and default document are bounded', () => {
  const descriptor = configuration().settings[0]
  const settings = Array.from({ length: 64 }, (_, i) => ({ ...descriptor, key: `k${i}` }))
  assert.equal(parse(runtimeV3Manifest({ configuration: { schemaVersion: 1, settings } })).configuration.settings.length, 64)
  assert.throws(() => parse(runtimeV3Manifest({ configuration: { schemaVersion: 1, settings: [...settings, { ...descriptor, key: 'extra' }] } })))
})

test('v3 configuration accepts Unicode scalars but rejects unpaired surrogates before runtime transport', () => {
  const valid = configuration()
  for (const text of ['\ud800', '\udfff', 'broken\ud800x']) {
    assert.throws(() => parse(runtimeV3Manifest({ configuration: { ...valid, settings: [{ ...valid.settings[0], default: text }] } })))
    assert.throws(() => parse(runtimeV3Manifest({ configuration: { ...valid, settings: [{ ...valid.settings[1], options: ['en', text] }] } })))
    assert.throws(() => resolveConfigurationValues(valid, { label: text }))
  }
  const manifest = parse(runtimeV3Manifest({ configuration: { ...valid, settings: [{ ...valid.settings[0], default: '中文🙂' }] } }))
  assert.deepEqual(resolveConfigurationValues(manifest.configuration, {}), { label: '中文🙂' })
})
