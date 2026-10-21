import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validatePackageV3ForRuntime } from '../../../electron/plugins/package-validator.ts'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const sdkDirectory = path.join(repository, 'plugin-sdk', 'declarative-v1')

function psQuote(value) { return `'${String(value).replaceAll("'", "''")}'` }

function runPnpm(args, cwd, timeout = 180_000) {
  const result = process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `& pnpm.cmd ${args.map(psQuote).join(' ')}; exit $LASTEXITCODE`],
      { cwd, windowsHide: true, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 })
    : spawnSync('pnpm', args, { cwd, windowsHide: true, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 })
  if (result.error || result.status !== 0) {
    throw new Error(`pnpm ${args[0]} failed (${result.status ?? result.error?.code ?? 'unknown'}):\n${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  }
  return result.stdout
}

test('external author installs the SDK tarball, packs a Node plugin, and Host-validates the package', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'webtools-external-sdk-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const artifacts = path.join(root, 'sdk artifacts')
  const author = path.join(root, 'external developer', 'sample-node-plugin')
  const fixtureDependency = path.join(root, 'fixture-dependencies', 'scoped')
  const output = path.join(author, 'dist', 'external-node.wtplugin')
  await mkdir(artifacts, { recursive: true })
  await mkdir(fixtureDependency, { recursive: true })
  await mkdir(path.dirname(output), { recursive: true })
  await mkdir(path.join(author, 'runtime'), { recursive: true })
  await mkdir(path.join(author, 'web'), { recursive: true })

  const sdkPackage = JSON.parse(await readFile(path.join(sdkDirectory, 'package.json'), 'utf8'))
  const tarballName = `webtools-plugin-sdk-${sdkPackage.version}.tgz`
  runPnpm(['pack', '--pack-destination', artifacts], sdkDirectory)
  const tarball = path.join(artifacts, tarballName)
  await readFile(tarball)

  await writeFile(path.join(fixtureDependency, 'package.json'), JSON.stringify({
    name: '@example/scoped-fixture', version: '1.0.0', type: 'commonjs', exports: { '.': './index.cjs' },
  }, null, 2))
  await writeFile(path.join(fixtureDependency, 'index.cjs'), "module.exports = { value: 'external-tarball-runtime-dependency' }\n")
  const manifest = {
    manifestVersion: 3,
    id: 'org.example.externalnode',
    name: 'External Node Fixture',
    description: 'External local SDK tarball author workflow',
    author: { name: 'WebTools acceptance' },
    version: '1.0.0',
    api: { apiMajor: 1, minHostVersion: '0.1.0' },
    type: 'plugin',
    requestedCapabilities: [],
    runtime: { kind: 'node', preload: 'runtime/preload.cjs' },
    compatibility: { platforms: ['win32'], architectures: ['x64'] },
    features: [{ id: 'home', title: 'External Node', entry: { kind: 'web-bundle', document: 'web/index.html' }, requiredCapabilities: [] }],
    runtimeFiles: [
      { path: 'runtime/preload.cjs', role: 'node-preload', mediaType: 'text/javascript' },
      { path: 'web/index.html', role: 'web', mediaType: 'text/html' },
    ],
    dependencies: [],
    package: { format: 'wtplugin', packageVersion: 1 },
  }
  await writeFile(path.join(author, 'manifest.json'), JSON.stringify(manifest, null, 2))
  await writeFile(path.join(author, 'package.json'), JSON.stringify({
    name: 'external-node-plugin', version: '1.0.0', private: true, type: 'module', packageManager: 'pnpm@9.15.9',
    devDependencies: { '@webtools/plugin-sdk': `file:../../sdk artifacts/${tarballName}` },
    dependencies: { '@example/scoped-fixture': 'file:../../fixture-dependencies/scoped' },
  }, null, 2))
  await writeFile(path.join(author, 'web', 'index.html'), '<!doctype html><html><body><main id="app">Node Plugin</main></body></html>\n')
  await writeFile(path.join(author, 'runtime', 'preload.cjs'), [
    "const fs = require('node:fs')",
    "const path = require('node:path')",
    "const { contextBridge } = require('electron')",
    "const fixture = require('@example/scoped-fixture')",
    "contextBridge.exposeInMainWorld('externalFixture', {",
    "  verify() {",
    "    const localData = process.env.WEBTOOLS_PLUGIN_DATA",
    "    const file = path.join(localData, 'state.json')",
    "    fs.mkdirSync(localData, { recursive: true })",
    "    fs.writeFileSync(file, JSON.stringify({ value: fixture.value }))",
    "    return { value: JSON.parse(fs.readFileSync(file, 'utf8')).value, localDataIsAbsolute: path.isAbsolute(localData) }",
    "  },",
    "})",
  ].join('\n') + '\n')

  runPnpm(['install', '--offline', '--ignore-scripts'], author)
  runPnpm(['install', '--offline', '--frozen-lockfile', '--ignore-scripts'], author)
  const installedThemeCss = await readFile(path.join(author, 'node_modules', '@webtools', 'plugin-sdk', 'web', 'theme.css'), 'utf8')
  assert.match(installedThemeCss, /--webtools-color-background/u)
  const packed = JSON.parse(runPnpm(['exec', 'webtools-plugin', 'pack', '.', '--out', output, '--host-version', '0.1.0', '--json'], author).trim())
  assert.equal(packed.ok, true)
  assert.equal(packed.result.plugin.manifestVersion, 3)
  assert.equal(packed.result.plugin.runtime, 'node')

  const host = await validatePackageV3ForRuntime(await readFile(output), '0.1.0')
  assert.equal(host.manifest.id, manifest.id)
  assert.equal(host.manifest.runtime.kind, 'node')
  assert.ok(host.snapshot.getResource('runtime/preload.cjs'))
  assert.ok(host.snapshot.getResource('node_modules/@example/scoped-fixture/index.cjs'))
  assert.ok(host.manifest.dependencies.some(item => item.name === '@example/scoped-fixture' && item.version === '1.0.0'))
})
