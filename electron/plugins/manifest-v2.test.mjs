import test from 'node:test'
import assert from 'node:assert/strict'
import { parseManifestV2 } from '../../plugin-sdk/declarative-v1/runtime/manifest-v2.mjs'
import { parseStrictJsonV1 } from '../../plugin-sdk/declarative-v1/runtime/manifest-v1.mjs'
import { webManifest } from './fixtures.mjs'

function parse(value, hostVersion = '0.1.0', reserved) {
  const source = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))
  return parseManifestV2(source, hostVersion, reserved)
}

test('Manifest v2 accepts minimal metadata and returns a deeply frozen normalized descriptor', () => {
  const result = parse(webManifest())
  assert.equal(result.manifest.manifestVersion, 2)
  assert.deepEqual(result.manifest.features[0].commands, [])
  assert.deepEqual(result.manifest.features[0].acceptedContexts, [])
  assert.deepEqual(result.manifest.features[0].requiredCapabilities, [])
  assert.deepEqual(result.manifest.features[0].executionRequirements, { wasm: false })
  assert.equal(result.networkRuntimeSupport, 'not-requested')
  assert.equal(Object.isFrozen(result), true)
  assert.equal(Object.isFrozen(result.manifest), true)
  assert.equal(Object.isFrozen(result.manifest.features[0].entry), true)
  assert.equal(Object.isFrozen(result.manifest.webBundle.files[0]), true)
})

test('Manifest v2 accepts local assets, WASM, contexts, and multiple Features within bounds', () => {
  const value = webManifest({
    requestedCapabilities: ['plugin.storage.read', 'plugin.storage.write'],
    features: [
      { id: 'first', title: '第一', commands: ['hello'], acceptedContexts: [{ type: 'text', sources: ['launcher-input', 'clipboard'] }], entry: { kind: 'web-bundle', document: 'web/index.html' }, requiredCapabilities: ['plugin.storage.read'], executionRequirements: { wasm: true } },
      { id: 'second', title: 'Second', entry: { kind: 'web-bundle', document: 'web/second.html' } },
    ],
    webBundle: { files: [
      { path: 'web/index.html', mediaType: 'text/html' }, { path: 'web/app.js', mediaType: 'text/javascript' },
      { path: 'web/app.css', mediaType: 'text/css' }, { path: 'web/data.json', mediaType: 'application/json' },
      { path: 'web/module.wasm', mediaType: 'application/wasm' }, { path: 'web/second.html', mediaType: 'text/html' },
    ] },
    assets: [
      { path: 'assets/icon.png', mediaType: 'image/png' }, { path: 'assets/photo.jpg', mediaType: 'image/jpeg' },
      { path: 'assets/photo.webp', mediaType: 'image/webp' }, { path: 'assets/font.woff2', mediaType: 'font/woff2' },
    ],
  })
  const result = parse(value)
  assert.equal(result.manifest.features.length, 2)
  assert.deepEqual(result.manifest.features[0].acceptedContexts[0].sources, ['clipboard', 'launcher-input'])
  assert.equal(result.manifest.features[0].executionRequirements.wasm, true)
})

test('Manifest v2 accepts structurally valid domains but marks network execution unavailable', () => {
  const result = parse(webManifest({ requestedCapabilities: ['network.domains'], network: { mode: 'domains', domains: [
    { host: 'status.example.com', protocol: 'https' }, { host: 'xn--bcher-kva.example', protocol: 'wss' },
  ] } }))
  assert.equal(result.manifest.network.mode, 'domains')
  assert.equal(result.networkRuntimeSupport, 'unavailable')
  assert.equal(result.manifest.network.domains[1].host, 'xn--bcher-kva.example')
})

test('Manifest v2 rejects malformed UTF-8, malformed JSON, duplicate keys, and strict-parser depth overflow', () => {
  for (const bytes of [Buffer.from([0xff]), Buffer.from('{'), Buffer.from('{"manifestVersion":2,"manifestVersion":2}')]) {
    assert.throws(() => parseManifestV2(bytes, '0.1.0'))
  }
  assert.doesNotThrow(() => parseStrictJsonV1('['.repeat(16) + '0' + ']'.repeat(16), 16))
  assert.throws(() => parseStrictJsonV1('['.repeat(17) + '0' + ']'.repeat(17), 16))
})

test('Manifest v2 rejects unknown fields and invalid closed object shapes', () => {
  const cases = [
    webManifest({ extra: true }),
    webManifest({ author: { name: 'Example', extra: true } }),
    webManifest({ api: { apiMajor: 1, minHostVersion: '0.1.0', extra: true } }),
    webManifest({ features: [{ id: 'hello', title: 'Hello', entry: { kind: 'web-bundle', document: 'web/index.html' }, extra: true }] }),
    webManifest({ webBundle: { files: [{ path: 'web/index.html', mediaType: 'text/html', extra: true }] } }),
    webManifest({ webBundle: { files: [{ path: 'web/index.html', mediaType: 'text/html' }], extra: true } }),
    webManifest({ assets: [{ path: 'assets/icon.png', mediaType: 'image/png', extra: true }] }),
    webManifest({ network: { mode: 'none', domains: [], extra: true } }),
    webManifest({ features: [{ id: 'hello', title: 'Hello', entry: { kind: 'web-bundle', document: 'web/index.html', extra: true } }] }),
    webManifest({ features: [{ id: 'hello', title: 'Hello', icon: { kind: 'host', key: 'document', extra: true }, entry: { kind: 'web-bundle', document: 'web/index.html' } }] }),
    webManifest({ features: [{ id: 'hello', title: 'Hello', acceptedContexts: [{ type: 'text', sources: ['launcher-input'], extra: true }], entry: { kind: 'web-bundle', document: 'web/index.html' } }] }),
    webManifest({ features: [{ id: 'hello', title: 'Hello', entry: { kind: 'web-bundle', document: 'web/index.html' }, executionRequirements: null }] }),
    webManifest({ assets: null }),
  ]
  for (const value of cases) assert.throws(() => parse(value))
})

test('Manifest v2 enforces version, identity, Feature, capability, and API constraints', () => {
  const cases = [
    [webManifest({ manifestVersion: 1 }), 'UNSUPPORTED_MANIFEST_VERSION'],
    [webManifest({ manifestVersion: 3 }), 'UNSUPPORTED_MANIFEST_VERSION'],
    [webManifest({ id: 'webtools.translation' }), 'RESERVED_IDENTITY'],
    [webManifest({ id: 'bad id' }), 'INVALID_PLUGIN_ID'],
    [webManifest({ features: [] }), 'INVALID_FIELD'],
    [webManifest({ features: Array.from({ length: 17 }, (_, i) => ({ id: `feature-${i}`, title: 'Feature', entry: { kind: 'web-bundle', document: 'web/index.html' } })) }), 'INVALID_FIELD'],
    [webManifest({ features: [{ id: 'bad_id', title: 'Feature', entry: { kind: 'web-bundle', document: 'web/index.html' } }] }), 'INVALID_FIELD'],
    [webManifest({ features: [{ id: 'hello', title: 'First', entry: { kind: 'web-bundle', document: 'web/index.html' } }, { id: 'hello', title: 'Second', entry: { kind: 'web-bundle', document: 'web/index.html' } }] }), 'DUPLICATE_FEATURE'],
    [webManifest({ requestedCapabilities: Array(13).fill('external.open') }), 'INVALID_FIELD'],
    [webManifest({ requestedCapabilities: ['manager.page'] }), 'INVALID_CAPABILITY'],
    [webManifest({ api: { apiMajor: 2, minHostVersion: '0.1.0' } }), 'INCOMPATIBLE_HOST'],
    [webManifest({ api: { apiMajor: 1, minHostVersion: '1.0.0' } }), 'INCOMPATIBLE_HOST'],
    [webManifest({ features: [{ id: 'hello', title: 'Feature', entry: { kind: 'web-bundle', document: 'web/index.html' }, commands: Array(9).fill('alias') }] }), 'INVALID_FIELD'],
    [webManifest({ features: [{ id: 'hello', title: 'Feature', entry: { kind: 'web-bundle', document: 'web/index.html' }, acceptedContexts: Array.from({ length: 5 }, () => ({ type: 'text', sources: ['launcher-input'] })) }] }), 'INVALID_FIELD'],
  ]
  for (const [value, code] of cases) assert.throws(() => parse(value), error => error.code === code)
})

test('Manifest v2 enforces reserved composite Feature identities without relying only on plugin namespace', () => {
  const reserved = ['org.example.tools\0translate-text']
  assert.throws(() => parse(webManifest({ id: 'org.example.tools', features: [{ id: 'translate-text', title: 'Translate', entry: { kind: 'web-bundle', document: 'web/index.html' } }] }), '0.1.0', reserved), error => error.code === 'RESERVED_IDENTITY')
})

test('Manifest v2 rejects bad references, icons, MIME mappings, and malformed package paths', () => {
  const badPaths = ['../outside.html', '/web/index.html', 'C:/web/index.html', 'web\\index.html', 'web//index.html', 'web/%2e%2e/out.html', 'web/%252e%252e/out.html', 'web/%2fout.html', 'web/%zz.html', 'web/a#b.html', 'web/cafe\u0301.html']
  for (const path of badPaths) assert.throws(() => parse(webManifest({ webBundle: { files: [{ path, mediaType: 'text/html' }] }, features: [{ id: 'hello', title: 'Hello', entry: { kind: 'web-bundle', document: path } }] })))
  const invalid = [
    webManifest({ webBundle: { files: [{ path: 'web/index.html', mediaType: 'text/javascript' }] } }),
    webManifest({ webBundle: { files: [{ path: 'web/index.svg', mediaType: 'image/svg+xml' }] } }),
    webManifest({ webBundle: { files: [{ path: 'web/index.js.map', mediaType: 'text/javascript' }] } }),
    webManifest({ features: [{ id: 'hello', title: 'Hello', entry: { kind: 'web-bundle', document: 'https://example.com/' } }] }),
    webManifest({ features: [{ id: 'hello', title: 'Hello', icon: { kind: 'host', key: 'filesystem' }, entry: { kind: 'web-bundle', document: 'web/index.html' } }] }),
    webManifest({ features: [{ id: 'hello', title: 'Hello', icon: { kind: 'asset', path: 'assets/icon.svg' }, entry: { kind: 'web-bundle', document: 'web/index.html' } }] }),
    webManifest({ webBundle: { files: [{ path: 'web/index.html', mediaType: 'text/html' }, { path: 'web/Index.html', mediaType: 'text/html' }] } }),
    webManifest({ webBundle: { files: [{ path: 'web/café.js', mediaType: 'text/javascript' }, { path: 'web/cafe\u0301.js', mediaType: 'text/javascript' }] } }),
  ]
  for (const value of invalid) assert.throws(() => parse(value))
  for (const reservedManifestPath of ['manifest.json', 'Manifest.json']) {
    assert.throws(() => parse(webManifest({
      webBundle: { files: [{ path: 'web/index.html', mediaType: 'text/html' }, { path: reservedManifestPath, mediaType: 'application/json' }] },
    })), error => error.code === 'INVALID_PATH')
  }
})

test('Manifest v2 enforces capability subsets, network structure, and WASM declaration rules', () => {
  const cases = [
    webManifest({ network: { mode: 'none', domains: [{ host: 'api.example.com', protocol: 'https' }] } }),
    webManifest({ requestedCapabilities: ['network.domains'], network: { mode: 'none', domains: [] } }),
    webManifest({ network: { mode: 'domains', domains: [{ host: '*.example.com', protocol: 'https' }] } }),
    webManifest({ network: { mode: 'domains', domains: [{ host: '127.0.0.1', protocol: 'https' }] } }),
    webManifest({ network: { mode: 'domains', domains: [{ host: '2130706433', protocol: 'https' }] } }),
    webManifest({ network: { mode: 'domains', domains: [{ host: '127.1', protocol: 'https' }] } }),
    webManifest({ network: { mode: 'domains', domains: [{ host: '0x7f000001', protocol: 'https' }] } }),
    webManifest({ network: { mode: 'domains', domains: [{ host: '0177.0.0.1', protocol: 'https' }] } }),
    webManifest({ network: { mode: 'domains', domains: [{ host: 'api.example.com:8443', protocol: 'https' }] } }),
    webManifest({ network: { mode: 'domains', domains: [{ host: 'api.example.com/path', protocol: 'https' }] } }),
    webManifest({ network: { mode: 'domains', domains: [{ host: 'api.example.com', protocol: 'http' }] } }),
    webManifest({ requestedCapabilities: ['network.domains'], network: { mode: 'domains', domains: [
      { host: 'api.example.com', protocol: 'https' }, { host: 'api.example.com', protocol: 'https' },
    ] } }),
    webManifest({ requestedCapabilities: ['plugin.storage.read'], features: [{ id: 'hello', title: 'Hello', entry: { kind: 'web-bundle', document: 'web/index.html' }, requiredCapabilities: ['plugin.storage.write'] }] }),
    webManifest({ features: [{ id: 'hello', title: 'Hello', entry: { kind: 'web-bundle', document: 'web/index.html' }, executionRequirements: { wasm: true } }] }),
    webManifest({ webBundle: { files: [{ path: 'web/index.html', mediaType: 'text/html' }, { path: 'web/module.wasm', mediaType: 'text/javascript' }] }, features: [{ id: 'hello', title: 'Hello', entry: { kind: 'web-bundle', document: 'web/index.html' }, executionRequirements: { wasm: true } }] }),
  ]
  for (const value of cases) assert.throws(() => parse(value))
  assert.throws(() => parse(webManifest({ features: [{ id: 'hello', title: 'Hello', entry: { kind: 'web-bundle', document: 'web/index.html' }, requiredCapabilities: ['manager.page'] }] })), error => error.code === 'INVALID_CAPABILITY')
})

test('Manifest v2 accepts every scalar bound exactly and rejects one scalar beyond it', () => {
  for (const [field, maximum] of [['name', 80], ['description', 512], ['author.name', 128]]) {
    const value = webManifest()
    if (field === 'author.name') value.author.name = 'a'.repeat(maximum)
    else value[field] = 'a'.repeat(maximum)
    assert.doesNotThrow(() => parse(value))
    if (field === 'author.name') value.author.name += 'a'
    else value[field] += 'a'
    assert.throws(() => parse(value))
  }
  const feature = { id: 'hello', title: 'a'.repeat(80), description: 'b'.repeat(240), commands: ['c'.repeat(48)], entry: { kind: 'web-bundle', document: 'web/index.html' } }
  assert.doesNotThrow(() => parse(webManifest({ features: [feature] })))
  feature.title += 'a'
  assert.throws(() => parse(webManifest({ features: [feature] })))
})

test('Manifest v2 accepts maximum valid Features, commands, context variants, capabilities, and network tuples', () => {
  const requestedCapabilities = [
    'plugin.config.read', 'plugin.config.write', 'plugin.storage.read', 'plugin.storage.write',
    'external.open', 'clipboard.write', 'clipboard.read', 'sharedAI.complete', 'network.domains',
  ]
  const acceptedContexts = [
    { type: 'text', sources: ['launcher-input'] },
    { type: 'text', sources: ['clipboard'] },
    { type: 'text', sources: ['launcher-input', 'clipboard'] },
  ]
  const value = webManifest({
    requestedCapabilities,
    features: Array.from({ length: 16 }, (_, index) => ({
      id: `feature-${index + 1}`,
      title: `Feature ${index + 1}`,
      ...(index === 0 ? { commands: Array.from({ length: 8 }, (_, alias) => `alias-${alias + 1}`), acceptedContexts } : {}),
      entry: { kind: 'web-bundle', document: 'web/index.html' },
      ...(index === 0 ? { requiredCapabilities: requestedCapabilities } : {}),
    })),
    network: { mode: 'domains', domains: Array.from({ length: 16 }, (_, index) => ({ host: `api-${index + 1}.example.com`, protocol: index % 2 ? 'wss' : 'https' })) },
  })
  const result = parse(value)
  assert.equal(result.manifest.features.length, 16)
  assert.equal(result.manifest.features[0].commands.length, 8)
  assert.equal(result.manifest.features[0].acceptedContexts.length, 3)
  assert.equal(result.manifest.requestedCapabilities.length, 9)
  assert.equal(result.manifest.network.domains.length, 16)
  assert.equal(result.networkRuntimeSupport, 'unavailable')

  // With the frozen type/source domain there are only three unique context
  // pairs; the schema's maximum of four is an upper ceiling, not a reachable
  // cardinality. Duplicate pairs are rejected rather than treated as distinct.
  const duplicatePair = webManifest({ features: [{
    id: 'hello', title: 'Hello', acceptedContexts: [acceptedContexts[0], acceptedContexts[0]],
    entry: { kind: 'web-bundle', document: 'web/index.html' },
  }] })
  assert.throws(() => parse(duplicatePair), error => error.code === 'INVALID_FIELD')
  const seventeenDomains = webManifest({
    requestedCapabilities: ['network.domains'],
    network: { mode: 'domains', domains: Array.from({ length: 17 }, (_, index) => ({ host: `api-${index + 1}.example.com`, protocol: 'https' })) },
  })
  assert.throws(() => parse(seventeenDomains), error => error.code === 'INVALID_FIELD')
})
