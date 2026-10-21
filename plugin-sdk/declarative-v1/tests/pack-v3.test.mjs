import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { packPluginV3, validatePluginSourceV3 } from '../src/pack-v3.mjs'
import { validatePackageV3 } from '../runtime-v3/package-v3.mjs'

const pe = () => {
  const bytes = Buffer.alloc(0x100); bytes.write('MZ', 0, 'ascii'); bytes.writeUInt32LE(0x80, 0x3c); bytes.write('PE\0\0', 0x80, 'ascii'); bytes.writeUInt16LE(0x8664, 0x84); return bytes
}
const anyCpuManagedDll = () => {
  const bytes = Buffer.alloc(0x400)
  const peOffset = 0x80; const coff = peOffset + 4; const optional = coff + 20; const optionalSize = 224
  bytes.write('MZ', 0, 'ascii'); bytes.writeUInt32LE(peOffset, 0x3c); bytes.write('PE\0\0', peOffset, 'ascii')
  bytes.writeUInt16LE(0x14c, coff); bytes.writeUInt16LE(1, coff + 2); bytes.writeUInt16LE(optionalSize, coff + 16); bytes.writeUInt16LE(0x2102, coff + 18)
  bytes.writeUInt16LE(0x10b, optional); bytes.writeUInt32LE(16, optional + 92)
  const directories = optional + 96; const cli = directories + 14 * 8
  bytes.writeUInt32LE(0x2000, cli); bytes.writeUInt32LE(72, cli + 4)
  const section = optional + optionalSize
  bytes.write('.text', section, 'ascii'); bytes.writeUInt32LE(0x100, section + 8); bytes.writeUInt32LE(0x2000, section + 12)
  bytes.writeUInt32LE(0x100, section + 16); bytes.writeUInt32LE(0x200, section + 20)
  bytes.writeUInt32LE(72, 0x200); bytes.writeUInt32LE(1, 0x210)
  return bytes
}
const manifest = overrides => ({
  manifestVersion: 3, id: 'org.example.author-plugin', name: 'Author Plugin', description: '', author: { name: 'Example' }, version: '1.0.0',
  api: { apiMajor: 1, minHostVersion: '0.1.0' }, type: 'plugin', requestedCapabilities: [],
  runtime: { kind: 'node', preload: 'runtime/preload.cjs' },
  compatibility: { platforms: ['win32'], architectures: ['x64'], nodeAbi: '137' },
  features: [{ id: 'home', title: 'Home', entry: { kind: 'web-bundle', document: 'web/index.html' }, requiredCapabilities: [] }],
  runtimeFiles: [
    { path: 'web/index.html', role: 'web', mediaType: 'text/html' },
    { path: 'runtime/preload.cjs', role: 'node-preload', mediaType: 'text/javascript' },
    { path: 'bin/helper.exe', role: 'helper', mediaType: 'application/octet-stream' },
  ], dependencies: [], package: { format: 'wtplugin', packageVersion: 1 }, ...overrides,
})

async function write(root, file, content) {
  const destination = path.join(root, ...file.split('/'))
  await mkdir(path.dirname(destination), { recursive: true })
  await writeFile(destination, content)
}
async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webtools-v3-external-author-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const project = path.join(root, 'author project')
  const output = path.join(root, 'artifacts')
  await mkdir(project); await mkdir(output)
  await write(project, 'manifest.json', JSON.stringify(manifest()))
  await write(project, 'package.json', JSON.stringify({ name: 'author-project', version: '1.0.0', dependencies: { '@sample/rootdep': '1.0.0' } }))
  await write(project, 'web/index.html', '<!doctype html><html><body>v3</body></html>')
  await write(project, 'runtime/preload.cjs', "require('@sample/rootdep')\n")
  await write(project, 'bin/helper.exe', pe())
  await write(project, 'node_modules/@sample/rootdep/package.json', JSON.stringify({
    name: '@sample/rootdep', version: '1.0.0', exports: { '.': { require: './index.cjs' } }, dependencies: { nested: '2.0.0' },
  }))
  await write(project, 'node_modules/@sample/rootdep/index.cjs', "module.exports = require('nested')\n")
  await write(project, 'node_modules/@sample/rootdep/note.json', '{"ok":true}')
  await write(project, 'node_modules/@sample/rootdep/node_modules/nested/package.json', JSON.stringify({ name: 'nested', version: '2.0.0', main: 'index.cjs' }))
  await write(project, 'node_modules/@sample/rootdep/node_modules/nested/index.cjs', "module.exports = require('./data.json')\n")
  await write(project, 'node_modules/@sample/rootdep/node_modules/nested/data.json', '{"nested":true}')
  return { root, project, output }
}

test('build output is packed against the separate external project dependency root', async t => {
  const { root, project, output } = await setup(t)
  const dist = path.join(project, 'dist')
  await write(dist, 'manifest.json', JSON.stringify(manifest({ runtime: { kind: 'node', preload: 'preload/index.cjs' },
    runtimeFiles: [
      { path: 'web/index.html', role: 'web', mediaType: 'text/html' },
      { path: 'preload/index.cjs', role: 'node-preload', mediaType: 'text/javascript' },
    ] })))
  await write(dist, 'web/index.html', '<!doctype html><html><body>external dist</body></html>')
  await write(dist, 'preload/index.cjs', "require('@sample/rootdep')\n")
  const result = await packPluginV3(dist, path.join(output, 'dist-root.wtplugin'), '0.1.0', { projectRoot: project })
  assert.ok(result.manifest.dependencies.some(item => item.name === '@sample/rootdep'))
  assert.ok(result.manifest.runtimeFiles.some(file => file.path === 'preload/index.cjs'))
  assert.ok(!result.manifest.runtimeFiles.some(file => file.path === 'package.json'))
})

test('external Runtime v3 author project materializes scoped, nested, CommonJS, exports, and JSON dependencies', async t => {
  const { project, output } = await setup(t)
  const result = await validatePluginSourceV3(project, '0.1.0')
  assert.equal(result.valid, true)
  assert.deepEqual(result.manifest.dependencies.map(item => [item.name, item.version]), [
    ['@sample/rootdep', '1.0.0'], ['nested', '2.0.0'],
  ])
  const first = await packPluginV3(project, path.join(output, 'first.wtplugin'), '0.1.0')
  const second = await packPluginV3(project, path.join(output, 'second.wtplugin'), '0.1.0')
  assert.equal(first.sha256, second.sha256, 'archive output is deterministic')
  const bytes = await readFile(path.join(output, 'first.wtplugin'))
  assert.equal(first.sha256, createHash('sha256').update(bytes).digest('hex'))
  const host = await validatePackageV3(bytes, '0.1.0', { platform: 'win32', architecture: 'x64', nodeAbi: '137' })
  assert.equal(host.manifest.runtime.kind, 'node')
  assert.ok(host.manifest.runtimeFiles.some(file => file.path.endsWith('/node_modules/nested/index.cjs')))
  assert.ok(host.manifest.runtimeFiles.some(file => file.path.endsWith('/node_modules/nested/data.json')))
  assert.ok(host.manifest.runtimeFiles.some(file => file.path.endsWith('/helper.exe') && file.role === 'helper'))
})

test('author packer refuses missing runtime dependencies and never leaves a partial output', async t => {
  const { project, output } = await setup(t)
  await write(project, 'package.json', JSON.stringify({ name: 'author-project', version: '1.0.0', dependencies: { missing: '1.0.0' } }))
  await assert.rejects(() => packPluginV3(project, path.join(output, 'missing.wtplugin'), '0.1.0'), error => error.code === 'DEPENDENCY_NOT_FOUND')
  await assert.rejects(() => readFile(path.join(output, 'missing.wtplugin')), { code: 'ENOENT' })
})

test('author packer inventories dependencies whose package root has no exported entry point', async t => {
  const { project, output } = await setup(t)
  await write(project, 'package.json', JSON.stringify({ name: 'author-project', version: '1.0.0', dependencies: { 'no-root-entry': '1.0.0' } }))
  await write(project, 'runtime/preload.cjs', "require('no-root-entry/subpath')\n")
  await write(project, 'node_modules/no-root-entry/package.json', JSON.stringify({
    name: 'no-root-entry', version: '1.0.0', main: false,
    exports: { './subpath': './subpath.cjs', './package.json': './package.json' },
  }))
  await write(project, 'node_modules/no-root-entry/subpath.cjs', "module.exports = 'resolved by subpath'\n")

  const packed = await packPluginV3(project, path.join(output, 'no-root-entry.wtplugin'), '0.1.0')
  assert.deepEqual(packed.manifest.dependencies.map(item => [item.name, item.version]), [['no-root-entry', '1.0.0']])
  assert.ok(packed.manifest.runtimeFiles.some(file => file.path === 'node_modules/no-root-entry/subpath.cjs'))
})

test('author packer materializes a representative pnpm virtual-store dependency tree instead of copying its links', async t => {
  const { project, output } = await setup(t)
  const modules = path.join(project, 'node_modules')
  const virtual = path.join(modules, '.pnpm')
  const parent = path.join(virtual, '@sample+rootdep@1.0.0', 'node_modules', '@sample', 'rootdep')
  const nested = path.join(virtual, 'nested@2.0.0', 'node_modules', 'nested')
  await rm(path.join(modules, '@sample', 'rootdep'), { recursive: true, force: true })
  await mkdir(path.join(parent, 'node_modules'), { recursive: true })
  await mkdir(nested, { recursive: true })
  await writeFile(path.join(parent, 'package.json'), JSON.stringify({ name: '@sample/rootdep', version: '1.0.0', main: 'index.cjs', dependencies: { nested: '2.0.0' } }))
  await writeFile(path.join(parent, 'index.cjs'), "module.exports = require('nested')\n")
  await writeFile(path.join(nested, 'package.json'), JSON.stringify({ name: 'nested', version: '2.0.0', main: 'index.cjs' }))
  await writeFile(path.join(nested, 'index.cjs'), "module.exports = require('./data.json')\n")
  await writeFile(path.join(nested, 'data.json'), '{"pnpm":true}')
  await symlink(parent, path.join(modules, '@sample', 'rootdep'), 'junction')
  await symlink(nested, path.join(parent, 'node_modules', 'nested'), 'junction')

  const result = await packPluginV3(project, path.join(output, 'pnpm.wtplugin'), '0.1.0')
  const checked = await validatePackageV3(await readFile(path.join(output, 'pnpm.wtplugin')), '0.1.0')
  assert.ok(checked.manifest.dependencies.some(dependency => dependency.name === '@sample/rootdep' && dependency.version === '1.0.0'))
  assert.ok(result.manifest.runtimeFiles.some(file => file.path === 'node_modules/@sample/rootdep/node_modules/nested/data.json'))
  assert.ok(!result.manifest.runtimeFiles.some(file => file.path.includes('/.pnpm/')))
})

test('native addon target architecture mismatch has a direct developer diagnostic', async t => {
  const { project, output } = await setup(t)
  const x86 = Buffer.from(pe())
  x86.writeUInt16LE(0x14c, 0x84)
  await write(project, 'node_modules/@sample/rootdep/addon.node', x86)
  await assert.rejects(
    () => packPluginV3(project, path.join(output, 'wrong-arch.wtplugin'), '0.1.0', { host: { platform: 'win32', architecture: 'x64', nodeAbi: '137' } }),
    error => error.code === 'NATIVE_ARCH_MISMATCH' && error.path.endsWith('addon.node'),
  )
})

test('AnyCPU .NET DLL resources are accepted for an x64 plugin target', async t => {
  const { project, output } = await setup(t)
  await write(project, 'node_modules/@sample/rootdep/support.dll', anyCpuManagedDll())
  const result = await packPluginV3(project, path.join(output, 'any-cpu.wtplugin'), '0.1.0', {
    host: { platform: 'win32', architecture: 'x64', nodeAbi: '137' },
  })
  assert.ok(result.manifest.runtimeFiles.some(file => file.path.endsWith('/support.dll')))
})
