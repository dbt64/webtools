import test from 'node:test'
import assert from 'node:assert/strict'
import { parseManifestV3, ManifestV3ValidationError } from './manifest-v3.mjs'

const base = overrides => ({
  manifestVersion: 3,
  id: 'org.example.runtime',
  name: 'Runtime Example',
  description: 'Runtime fixture',
  author: { name: 'WebTools' },
  version: '1.0.0',
  api: { apiMajor: 1, minHostVersion: '0.1.0' },
  type: 'plugin',
  requestedCapabilities: [],
  runtime: { kind: 'web' },
  compatibility: { platforms: ['win32'], architectures: ['x64'] },
  features: [{ id: 'home', title: 'Home', entry: { kind: 'web-bundle', document: 'web/index.html' }, requiredCapabilities: [] }],
  runtimeFiles: [{ path: 'web/index.html', role: 'web', mediaType: 'text/html' }],
  dependencies: [],
  package: { format: 'wtplugin', packageVersion: 1 },
  ...overrides,
})

const parse = value => parseManifestV3(Buffer.from(JSON.stringify(value)), '0.1.0', { platform: 'win32', architecture: 'x64', nodeAbi: '137' })

test('window blurBehavior defaults to temporary-hide and only accepts the two window policies', () => {
  const withPresentation = presentation => base({ features: [{ ...base().features[0], ...(presentation ? { presentation } : {}) }] })
  assert.equal(parse(withPresentation()).manifest.features[0].presentation.blurBehavior, 'temporary-hide')
  for (const blurBehavior of ['temporary-hide', 'background']) {
    assert.equal(parse(withPresentation({ type: 'window', blurBehavior })).manifest.features[0].presentation.blurBehavior, blurBehavior)
  }
  for (const presentation of [{ type: 'window', blurBehavior: 'close' }, { type: 'window', blurBehavior: null }, { type: 'command', blurBehavior: 'background' }]) {
    assert.throws(() => parse(withPresentation(presentation)), ManifestV3ValidationError)
  }
})

test('Manifest v3 normalizes a standard web plugin and keeps the closed immutable contract', () => {
  const parsed = parse(base())
  assert.equal(parsed.manifest.manifestVersion, 3)
  assert.equal(parsed.manifest.runtime.kind, 'web')
  assert.equal(parsed.manifest.compatibility.platforms[0], 'win32')
  assert.equal(parsed.manifest.features[0].entry.document, 'web/index.html')
  assert.equal(Object.isFrozen(parsed.manifest), true)
  assert.equal(Object.isFrozen(parsed.manifest.runtimeFiles), true)
  assert.equal('network' in parsed.manifest, false)
  assert.equal('executionRequirements' in parsed.manifest.features[0], false)
})

test('Manifest v3 accepts declared Node preload, npm inventory, native addon and helper resources', () => {
  const value = base({
    runtime: { kind: 'node', preload: 'runtime/preload.cjs' },
    compatibility: { platforms: ['win32'], architectures: ['x64'], nodeAbi: '137' },
    runtimeFiles: [
      { path: 'web/index.html', role: 'web', mediaType: 'text/html' },
      { path: 'runtime/preload.cjs', role: 'node-preload', mediaType: 'text/javascript' },
      { path: 'node_modules/@scope/pkg/package.json', role: 'dependency', mediaType: 'application/json', dependency: '@scope/pkg' },
      { path: 'node_modules/@scope/pkg/index.cjs', role: 'dependency', mediaType: 'text/javascript', dependency: '@scope/pkg' },
      { path: 'node_modules/@scope/pkg/build/Release/addon.node', role: 'native-addon', mediaType: 'application/octet-stream', dependency: '@scope/pkg' },
      { path: 'bin/helper.exe', role: 'helper', mediaType: 'application/octet-stream' },
      { path: 'bin/support.dll', role: 'library', mediaType: 'application/octet-stream' },
    ],
    dependencies: [{ name: '@scope/pkg', version: '2.3.4', files: ['node_modules/@scope/pkg/package.json', 'node_modules/@scope/pkg/index.cjs', 'node_modules/@scope/pkg/build/Release/addon.node'] }],
  })
  const parsed = parse(value)
  assert.equal(parsed.manifest.runtime.preload, 'runtime/preload.cjs')
  assert.ok(parsed.manifest.runtimeFiles.some(file => file.role === 'native-addon'))
  assert.ok(parsed.manifest.runtimeFiles.some(file => file.role === 'helper'))
  assert.equal(parsed.manifest.dependencies[0].name, '@scope/pkg')
})

test('Manifest v3 allows nested versions of the same npm package when they have distinct package roots', () => {
  const value = base({
    runtime: { kind: 'node', preload: 'runtime/preload.cjs' },
    compatibility: { platforms: ['win32'], architectures: ['x64'] },
    runtimeFiles: [
      { path: 'web/index.html', role: 'web', mediaType: 'text/html' },
      { path: 'runtime/preload.cjs', role: 'node-preload', mediaType: 'text/javascript' },
      { path: 'node_modules/pkg/package.json', role: 'dependency', mediaType: 'application/json', dependency: 'pkg' },
      { path: 'node_modules/pkg/index.cjs', role: 'dependency', mediaType: 'text/javascript', dependency: 'pkg' },
      { path: 'node_modules/parent/package.json', role: 'dependency', mediaType: 'application/json', dependency: 'parent' },
      { path: 'node_modules/parent/node_modules/pkg/package.json', role: 'dependency', mediaType: 'application/json', dependency: 'pkg' },
      { path: 'node_modules/parent/node_modules/pkg/index.cjs', role: 'dependency', mediaType: 'text/javascript', dependency: 'pkg' },
    ],
    dependencies: [
      { name: 'pkg', version: '1.0.0', files: ['node_modules/pkg/package.json', 'node_modules/pkg/index.cjs'] },
      { name: 'parent', version: '1.0.0', files: ['node_modules/parent/package.json'] },
      { name: 'pkg', version: '2.0.0', files: ['node_modules/parent/node_modules/pkg/package.json', 'node_modules/parent/node_modules/pkg/index.cjs'] },
    ],
  })
  assert.equal(parse(value).manifest.dependencies.filter(item => item.name === 'pkg').length, 2)
})

test('Manifest v3 rejects unknown legacy web restriction fields and malformed closed fields', () => {
  for (const value of [
    base({ network: { mode: 'none', domains: [] } }),
    base({ runtime: { kind: 'web', preload: 'runtime/preload.cjs' } }),
    base({ runtime: { kind: 'node', preload: '../preload.cjs' } }),
    base({ runtimeFiles: [...base().runtimeFiles, { path: 'web/index.html', role: 'web', mediaType: 'text/html' }] }),
    base({ compatibility: { platforms: ['linux'], architectures: ['x64'] } }),
    base({ package: { format: 'wtplugin', packageVersion: 1, extra: true } }),
    base({ dependencies: [{ name: 'pkg', version: 'latest', files: ['node_modules/pkg/index.js'] }], runtimeFiles: [...base().runtimeFiles, { path: 'node_modules/pkg/index.js', role: 'dependency', mediaType: 'text/javascript', dependency: 'pkg' }] }),
  ]) assert.throws(() => parse(value), ManifestV3ValidationError)
})

test('Manifest v3 reports stable error codes for malformed JSON, limits and invalid paths', () => {
  assert.throws(() => parseManifestV3(Buffer.from('{"manifestVersion":3,"manifestVersion":3}'), '0.1.0'), error => error.code === 'INVALID_MANIFEST')
  assert.throws(() => parseManifestV3(Buffer.alloc(257 * 1024), '0.1.0'), error => error.code === 'PACKAGE_LIMIT_EXCEEDED')
  const invalid = base({ runtimeFiles: [{ path: 'web/../../outside.html', role: 'web', mediaType: 'text/html' }] })
  assert.throws(() => parse(invalid), error => error.code === 'INVALID_PATH')
})
