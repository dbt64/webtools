import test from 'node:test'
import assert from 'node:assert/strict'
import { parseManifest, parseStrictJson, compareVersions, validateSettingValue } from './manifest.ts'

import { manifest } from './fixtures.mjs'
const parse = value => parseManifest(Buffer.from(JSON.stringify(value)), '0.1.0')

test('validates the declarative draft and rejects incompatible host versions', () => {
  assert.equal(parse(manifest()).id, 'org.example.demo')
  assert.throws(() => parse(manifest({ api: { apiMajor: 2, minHostVersion: '0.1.0' } })))
  assert.throws(() => parse(manifest({ api: { apiMajor: 1, minHostVersion: '0.2.0' } })))
})
test('strict JSON rejects duplicate decoded keys, prototype keys, depth and trailing tokens', () => {
  for (const source of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"__proto__":{}}', '{"a":1} {}', '['.repeat(17) + '0' + ']'.repeat(17)]) assert.throws(() => parseStrictJson(source))
  assert.deepEqual(parseStrictJson('{"x":[true,null,1,"hello"]}'), { x: [true, null, 1, 'hello'] })
})
test('rejects unsupported manifest/API versions and fields that could claim host privileges', () => {
  for (const value of [
    manifest({ manifestVersion: 2 }),
    manifest({ api: { apiMajor: 2, minHostVersion: '0.1.0' } }),
    manifest({ builtin: true }),
    manifest({ trusted: true }),
    manifest({ secretStore: true }),
    manifest({ ipcChannel: 'native:invoke' }),
  ]) assert.throws(() => parse(value))
})
test('strict manifest rejects missing/unknown fields, identities, SemVer and closed types', () => {
  const missing = manifest(); delete missing.name
  const cases = [missing, manifest({ mystery: true }), manifest({ id: '../evil' }), manifest({ version: '01.0.0' }), manifest({ requestedCapabilities: ['filesystem.read'] }), manifest({ type: 'javascript' }), manifest({ author: { name: 'A', extra: true } }), manifest({ pages: [{ id: 'home', title: 'H', blocks: [{ type: 'html', text: '<script>' }] }] }), manifest({ actions: [{ id: 'a', type: 'eval' }] })]
  for (const value of cases) assert.throws(() => parse(value))
})
test('strict manifest rejects case-insensitive NFC-equivalent declared asset paths', () => {
  const assets = ['assets/café.png', 'assets/cafe\u0301.png'].map(path => ({ path, type: 'image/png' }))
  assert.throws(() => parse(manifest({ assets })), error => error.code === 'INVALID_MANIFEST')
})
test('rejects unresolved, duplicate or undeclared-capability references and resource bounds', () => {
  for (const value of [manifest({ entry: { pageId: 'absent', label: 'A' } }), manifest({ requestedCapabilities: [] }), manifest({ assets: [{ path: '../x.png', type: 'image/png' }] }), manifest({ entry: { pageId: 'home', label: 'A', icon: 'assets/missing.png' } }), manifest({ actions: [{ id: 'open', type: 'external.open', url: 'http://example.org' }] }), manifest({ requestedCapabilities: ['manager.page', 'external.open'], actions: [{ id: 'a', type: 'external.open', url: 'https://example.org' }, { id: 'a', type: 'external.open', url: 'https://example.org' }] }), manifest({ pages: Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, title: 'P', blocks: [] })) }), manifest({ name: 'x'.repeat(81) })]) assert.throws(() => parse(value))
})
test('setting schemas, defaults and matching UI/action targets are validated', () => {
  const settings = [{ key: 'text', label: 'Text', type: 'text', minLength: 0, maxLength: 20, default: '' }, { key: 'choice', label: 'Choice', type: 'enum', options: ['a', 'b'], default: 'a' }, { key: 'flag', label: 'Flag', type: 'boolean', default: true }, { key: 'amount', label: 'Amount', type: 'number', min: 0, max: 10, default: 3 }]
  const value = manifest({ settings, requestedCapabilities: ['manager.page', 'plugin.config.read', 'plugin.config.write'], actions: [{ id: 'save', type: 'plugin.config.write', key: 'text' }, { id: 'saveChoice', type: 'plugin.config.write', key: 'choice' }, { id: 'saveFlag', type: 'plugin.config.write', key: 'flag' }], pages: [{ id: 'home', title: 'H', blocks: [{ type: 'text-input', settingKey: 'text' }, { type: 'select', settingKey: 'choice' }, { type: 'checkbox', settingKey: 'flag' }, { type: 'button', label: 'Save', actionId: 'save' }] }] })
  assert.equal(parse(value).settings.length, 4)
  assert.throws(() => validateSettingValue(settings[0], 'x'.repeat(21)))
  assert.throws(() => validateSettingValue(settings[1], 'c'))
  assert.throws(() => validateSettingValue(settings[3], Infinity))
  assert.throws(() => parse({ ...value, settings: [{ ...settings[0], default: 7 }] }))
  assert.throws(() => parse({ ...value, actions: [{ id: 'save', type: 'plugin.config.write', key: 'text' }] }))
})
test('SemVer precedence handles prerelease, numeric identifiers and build metadata', () => {
  assert.equal(compareVersions('1.0.0+one', '1.0.0+two'), 0)
  assert.ok(compareVersions('1.0.0-alpha.9', '1.0.0-alpha.10') < 0)
  assert.ok(compareVersions('1.0.0-rc.1', '1.0.0') < 0)
  assert.ok(compareVersions('10.0.0', '2.0.0') > 0)
})
