import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePackageV3, validatePackageV3ForRuntime } from './package-v3.mjs'
import { zip } from '../../electron/plugins/fixtures.mjs'
import { isValidatedPluginRuntimeSnapshot, validateIncomingPackage } from '../../electron/plugins/package-validator.ts'

const pe = machine => {
  const bytes = Buffer.alloc(0x100)
  bytes.write('MZ', 0, 'ascii')
  bytes.writeUInt32LE(0x80, 0x3c)
  bytes.write('PE\0\0', 0x80, 'ascii')
  bytes.writeUInt16LE(machine, 0x84)
  return bytes
}

const manifest = overrides => ({
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

const makePackage = (value, files = [{ name: 'web/index.html', data: '<html><body>runtime</body></html>' }]) => zip([
  { name: 'manifest.json', data: JSON.stringify(value) },
  ...files,
])
const host = { platform: 'win32', architecture: 'x64', nodeAbi: '137' }

test('Runtime v3 validator accepts an exact standard web package and returns its validated resources', async () => {
  const archive = makePackage(manifest())
  const validated = await validatePackageV3(archive, '0.1.0', host)
  assert.equal(validated.manifest.manifestVersion, 3)
  assert.equal(validated.runtimeSupport, 'runtime-v3')
  assert.match(validated.hash, /^[a-f0-9]{64}$/u)
  assert.equal('resources' in validated, false)

  const runtime = await validatePackageV3ForRuntime(archive, '0.1.0', host)
  const html = runtime.resources.find(resource => resource.canonicalPath === 'web/index.html')
  assert.equal(html.bytes.toString(), '<html><body>runtime</body></html>')
  assert.equal(runtime.expandedSize, Buffer.byteLength(JSON.stringify(manifest())) + Buffer.byteLength('<html><body>runtime</body></html>'))
})

test('Host package router creates an opaque immutable v3 snapshot from the authoritative validation pass', async () => {
  const archive = makePackage(manifest())
  const incoming = await validateIncomingPackage(archive, '0.1.0')
  assert.equal(incoming.kind, 'v3')
  if (incoming.kind !== 'v3') return
  assert.equal(isValidatedPluginRuntimeSnapshot(incoming.package.snapshot), true)
  const original = incoming.package.snapshot.getResource('web/index.html')
  assert.ok(original)
  original.bytes[0] = 0
  assert.equal(incoming.package.snapshot.getResource('web/index.html')?.bytes[0], 0x3c)
})

test('Runtime v3 validator accepts materialized scoped CommonJS dependencies, a native addon and helper PE', async () => {
  const files = [
    { name: 'web/index.html', data: '<html>node plugin</html>' },
    { name: 'runtime/preload.cjs', data: 'module.exports = {}' },
    { name: 'node_modules/@scope/pkg/package.json', data: JSON.stringify({ name: '@scope/pkg', version: '2.3.4', main: 'index.cjs' }) },
    { name: 'node_modules/@scope/pkg/index.cjs', data: 'module.exports = require("./data.json")' },
    { name: 'node_modules/@scope/pkg/data.json', data: '{"ok":true}' },
    { name: 'node_modules/@scope/pkg/build/Release/addon.node', data: pe(0x8664) },
    { name: 'bin/helper.exe', data: pe(0x8664) },
    { name: 'bin/dependency.dll', data: pe(0x8664) },
  ]
  const value = manifest({
    runtime: { kind: 'node', preload: 'runtime/preload.cjs' },
    compatibility: { platforms: ['win32'], architectures: ['x64'], nodeAbi: '137' },
    runtimeFiles: [
      { path: 'web/index.html', role: 'web', mediaType: 'text/html' },
      { path: 'runtime/preload.cjs', role: 'node-preload', mediaType: 'text/javascript' },
      { path: 'node_modules/@scope/pkg/package.json', role: 'dependency', mediaType: 'application/json', dependency: '@scope/pkg' },
      { path: 'node_modules/@scope/pkg/index.cjs', role: 'dependency', mediaType: 'text/javascript', dependency: '@scope/pkg' },
      { path: 'node_modules/@scope/pkg/data.json', role: 'dependency', mediaType: 'application/json', dependency: '@scope/pkg' },
      { path: 'node_modules/@scope/pkg/build/Release/addon.node', role: 'native-addon', mediaType: 'application/octet-stream', dependency: '@scope/pkg' },
      { path: 'bin/helper.exe', role: 'helper', mediaType: 'application/octet-stream' },
      { path: 'bin/dependency.dll', role: 'library', mediaType: 'application/octet-stream' },
    ],
    dependencies: [{ name: '@scope/pkg', version: '2.3.4', files: [
      'node_modules/@scope/pkg/package.json', 'node_modules/@scope/pkg/index.cjs',
      'node_modules/@scope/pkg/data.json', 'node_modules/@scope/pkg/build/Release/addon.node',
    ] }],
  })
  const validated = await validatePackageV3ForRuntime(makePackage(value, files), '0.1.0', host)
  assert.equal(validated.manifest.dependencies[0].name, '@scope/pkg')
  assert.equal(validated.resources.find(resource => resource.canonicalPath.endsWith('.node')).bytes.toString('ascii', 0, 2), 'MZ')
  assert.equal(validated.resources.find(resource => resource.canonicalPath.endsWith('.exe')).bytes.readUInt16LE(0x84), 0x8664)
})

test('Runtime v3 validator accepts nested dependency versions and binds each package.json to its own declared version', async () => {
  const paths = [
    'node_modules/pkg/package.json', 'node_modules/pkg/index.cjs',
    'node_modules/parent/package.json', 'node_modules/parent/node_modules/pkg/package.json', 'node_modules/parent/node_modules/pkg/index.cjs',
  ]
  const contents = [
    JSON.stringify({ name: 'pkg', version: '1.0.0', main: 'index.cjs' }), 'module.exports = 1',
    JSON.stringify({ name: 'parent', version: '1.0.0' }),
    JSON.stringify({ name: 'pkg', version: '2.0.0', main: 'index.cjs' }), 'module.exports = 2',
  ]
  const runtimeFiles = paths.map((path, index) => ({ path, role: 'dependency', mediaType: index === 0 || index === 2 || index === 3 ? 'application/json' : 'text/javascript', dependency: index === 2 ? 'parent' : 'pkg' }))
  const value = manifest({
    runtime: { kind: 'node', preload: 'runtime/preload.cjs' },
    compatibility: { platforms: ['win32'], architectures: ['x64'] },
    runtimeFiles: [
      { path: 'web/index.html', role: 'web', mediaType: 'text/html' },
      { path: 'runtime/preload.cjs', role: 'node-preload', mediaType: 'text/javascript' }, ...runtimeFiles,
    ],
    dependencies: [
      { name: 'pkg', version: '1.0.0', files: paths.slice(0, 2) },
      { name: 'parent', version: '1.0.0', files: [paths[2]] },
      { name: 'pkg', version: '2.0.0', files: paths.slice(3) },
    ],
  })
  const entries = [
    { name: 'web/index.html', data: '<html/>' }, { name: 'runtime/preload.cjs', data: 'module.exports = {}' },
    ...paths.map((name, index) => ({ name, data: contents[index] })),
  ]
  const checked = await validatePackageV3ForRuntime(makePackage(value, entries), '0.1.0', host)
  assert.equal(checked.manifest.dependencies.filter(item => item.name === 'pkg').length, 2)
  const mismatched = entries.map(entry => entry.name === paths[3] ? { ...entry, data: JSON.stringify({ name: 'pkg', version: '9.9.9' }) } : entry)
  await assert.rejects(() => validatePackageV3(makePackage(value, mismatched), '0.1.0', host), error => error.code === 'INVENTORY_MISMATCH')
})

test('Runtime v3 validator rejects undeclared files, corrupted native metadata and dependency identity mismatch', async () => {
  const extra = makePackage(manifest(), [
    { name: 'web/index.html', data: '<html/>' }, { name: 'web/extra.js', data: 'unexpected' },
  ])
  await assert.rejects(() => validatePackageV3(extra, '0.1.0', host), error => error.code === 'INVENTORY_MISMATCH')

  const nodeManifest = manifest({
    runtime: { kind: 'node', preload: 'runtime/preload.cjs' },
    compatibility: { platforms: ['win32'], architectures: ['x64'], nodeAbi: '137' },
    runtimeFiles: [
      { path: 'web/index.html', role: 'web', mediaType: 'text/html' },
      { path: 'runtime/preload.cjs', role: 'node-preload', mediaType: 'text/javascript' },
      { path: 'bin/helper.exe', role: 'helper', mediaType: 'application/octet-stream' },
    ],
  })
  await assert.rejects(() => validatePackageV3(makePackage(nodeManifest, [
    { name: 'web/index.html', data: '<html/>' }, { name: 'runtime/preload.cjs', data: '' }, { name: 'bin/helper.exe', data: 'not PE' },
  ]), '0.1.0', host), error => error.code === 'UNSUPPORTED_FILE_TYPE')

  const dependency = manifest({
    runtime: { kind: 'node', preload: 'runtime/preload.cjs' },
    compatibility: { platforms: ['win32'], architectures: ['x64'] },
    runtimeFiles: [
      { path: 'web/index.html', role: 'web', mediaType: 'text/html' },
      { path: 'runtime/preload.cjs', role: 'node-preload', mediaType: 'text/javascript' },
      { path: 'node_modules/pkg/package.json', role: 'dependency', mediaType: 'application/json', dependency: 'pkg' },
    ],
    dependencies: [{ name: 'pkg', version: '1.0.0', files: ['node_modules/pkg/package.json'] }],
  })
  await assert.rejects(() => validatePackageV3(makePackage(dependency, [
    { name: 'web/index.html', data: '<html/>' }, { name: 'runtime/preload.cjs', data: '' },
    { name: 'node_modules/pkg/package.json', data: JSON.stringify({ name: 'pkg', version: '9.9.9' }) },
  ]), '0.1.0', host), error => error.code === 'INVENTORY_MISMATCH')
})
