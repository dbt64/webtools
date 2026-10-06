import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { packageBytes, manifest as fixtureManifest } from '../../../electron/plugins/fixtures.mjs'
import { errorRecord } from '../src/diagnostics.mjs'

const bin = fileURLToPath(new URL('../bin/webtools-plugin.mjs', import.meta.url))
const manifest = { manifestVersion: 1, id: 'org.example.cli-test', name: 'CLI Test', description: '', author: { name: 'Example' }, version: '1.0.0', api: { apiMajor: 1, minHostVersion: '0.1.0' }, type: 'declarative-manager', entry: { pageId: 'home', label: 'CLI Test' }, requestedCapabilities: ['manager.page'], settings: [], pages: [{ id: 'home', title: 'Home', blocks: [{ type: 'paragraph', text: 'CLI test' }] }], actions: [], assets: [] }

function run(args, cwd) { return spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', windowsHide: true }) }

test('validate accepts a valid source directory read-only and reports safe metadata', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'wtplugin-cli-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest))
  const before = await readFile(path.join(root, 'manifest.json'))
  const result = run(['validate', root, '--host-version', '0.1.0'], tmpdir())
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /INFO.*org\.example\.cli-test/)
  assert.match(result.stdout, /VALID/)
  assert.deepEqual(await readFile(path.join(root, 'manifest.json')), before)
})

test('validate rejects unknown fields without leaking absolute source paths', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'wtplugin-cli-bad-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, installPath: 'private' }))
  const result = run(['validate', root, '--host-version', '0.1.0'], tmpdir())
  assert.equal(result.status, 1)
  assert.match(result.stderr, /ERROR.*INVALID_MANIFEST/)
  assert.equal(result.stderr.includes(root), false)
})

test('validate reports host incompatibility and corrupt archive failures with safe codes', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'wtplugin-cli-host-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, api: { apiMajor: 1, minHostVersion: '9.0.0' } }))
  const incompatible = run(['validate', root, '--host-version', '0.1.0'], tmpdir())
  assert.equal(incompatible.status, 1)
  assert.match(incompatible.stderr, /ERROR.*INCOMPATIBLE_PLUGIN/)
  assert.equal(incompatible.stderr.includes(root), false)

  const archive = path.join(root, 'damaged.wtplugin')
  await writeFile(archive, 'not a zip')
  const damaged = run(['validate', archive, '--host-version', '0.1.0'], tmpdir())
  assert.equal(damaged.status, 1)
  assert.match(damaged.stderr, /ERROR.*INVALID_PACKAGE/)
  assert.equal(damaged.stderr.includes(root), false)
  assert.equal(await readFile(archive, 'utf8'), 'not a zip')
})

test('validate rejects credential-like content in source and package without echoing it', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'wtplugin-cli-secret-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const secret = ['sk_live_', '1234567890', 'abcdefghijklmnop'].join('')
  const source = path.join(root, 'source')
  await mkdir(source)
  await writeFile(path.join(source, 'manifest.json'), JSON.stringify({ ...manifest, description: `api_key=${secret}` }))

  const sourceResult = run(['validate', source, '--host-version', '0.1.0'], tmpdir())
  assert.equal(sourceResult.status, 1)
  assert.match(sourceResult.stderr, /ERROR.*SENSITIVE_CONTENT/)
  assert.equal(`${sourceResult.stdout}${sourceResult.stderr}`.includes(secret), false)
  assert.equal(`${sourceResult.stdout}${sourceResult.stderr}`.includes(root), false)

  const archive = path.join(root, 'secret.wtplugin')
  await writeFile(archive, packageBytes(fixtureManifest({ description: `api_key=${secret}` })))
  const archiveResult = run(['validate', archive, '--host-version', '0.1.0'], tmpdir())
  assert.equal(archiveResult.status, 1)
  assert.match(archiveResult.stderr, /ERROR.*SENSITIVE_CONTENT/)
  assert.equal(`${archiveResult.stdout}${archiveResult.stderr}`.includes(secret), false)
  assert.equal(`${archiveResult.stdout}${archiveResult.stderr}`.includes(root), false)
})

test('help shows the supported public command surface without writing an error', () => {
  const result = run(['--help'], tmpdir())
  assert.equal(result.status, 0)
  assert.equal(result.stderr, '')
  assert.match(result.stdout, /create <directory>/)
  assert.match(result.stdout, /validate <directory\|file\.wtplugin>/)
  assert.match(result.stdout, /pack <directory>/)
  assert.match(result.stdout, /inspect <file\.wtplugin>/)
})

test('each command rejects unknown, repeated, missing and inappropriate options with usage exit status', () => {
  const cases = [
    [],
    ['unknown', 'plugin', '--host-version', '0.1.0'],
    ['validate', '.', '--host-version'],
    ['validate', '.', '--host-version', '0.1.0', '--host-version', '0.1.0'],
    ['validate', '.', '--host-version', '0.1.0', '--out', 'ignored.wtplugin'],
    ['pack', '.', '--host-version', '0.1.0'],
    ['pack', '.', '--host-version', '0.1.0', '--out', 'x.wtplugin', '--out', 'y.wtplugin'],
    ['inspect', 'x.wtplugin', '--host-version', '0.1.0', '--out', 'x'],
    ['create', 'x', '--host-version', '0.1.0', '--surprise', 'x'],
  ]
  for (const args of cases) {
    const result = run(args, tmpdir())
    assert.equal(result.status, 2, args.join(' '))
    assert.match(result.stderr, /ERROR.*CLI_USAGE/, args.join(' '))
    assert.equal(result.stderr.includes(process.cwd()), false)
  }
})

test('JSON validation emits a single machine-readable success envelope including warnings', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'wtplugin-cli-json-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest))
  const result = run(['validate', root, '--host-version', '0.1.0', '--json'], tmpdir())
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  const envelope = JSON.parse(result.stdout)
  assert.deepEqual(Object.keys(envelope).sort(), ['command', 'ok', 'result'])
  assert.equal(envelope.ok, true)
  assert.equal(envelope.command, 'validate')
  assert.equal(envelope.result.valid, true)
  assert.equal(envelope.result.plugin.id, 'org.example.cli-test')
  assert.ok(envelope.result.warnings.some(warning => warning.code === 'GENERIC_ICON'))
  assert.equal(result.stdout.trim().split(/\r?\n/).length, 1)
  assert.equal(result.stdout.includes(root), false)
})

test('JSON errors preserve safe Unicode paths and omit absolute paths, stacks and source contents', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'wtplugin-cli-json-error-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'source')
  await mkdir(source)
  const value = { ...manifest, entry: { pageId: 'home', label: 'CLI Test', icon: 'assets/图标.png' }, assets: [{ path: 'assets/图标.png', type: 'image/png' }] }
  await writeFile(path.join(source, 'manifest.json'), JSON.stringify(value))
  const result = run(['validate', source, '--host-version', '0.1.0', '--json'], tmpdir())
  assert.equal(result.status, 1)
  assert.equal(result.stderr, '')
  const envelope = JSON.parse(result.stdout)
  assert.deepEqual(Object.keys(envelope).sort(), ['command', 'error', 'ok'])
  assert.equal(envelope.ok, false)
  assert.equal(envelope.command, 'validate')
  assert.equal(envelope.error.code, 'SOURCE_IO')
  assert.equal(envelope.error.path, 'assets/图标.png')
  assert.equal(envelope.error.field, undefined)
  assert.equal(result.stdout.includes(root), false)
  assert.equal(result.stdout.includes('stack'), false)
  assert.equal(result.stdout.includes(JSON.stringify(value)), false)
})

test('diagnostic records preserve package-relative Unicode and suppress absolute or traversing paths', () => {
  assert.deepEqual(errorRecord({ code: 'SOURCE_IO', path: 'assets/图标.png', field: 'assets.path' }), {
    code: 'SOURCE_IO', path: 'assets/图标.png', field: 'assets.path',
    message: 'A source file could not be safely read as a regular file.',
    suggestion: 'Check the plugin source and retry.',
  })
  assert.equal(errorRecord({ code: 'SOURCE_IO', path: 'C:\\Users\\Private\\secret.txt' }).path, 'manifest.json')
  assert.equal(errorRecord({ code: 'SOURCE_IO', path: '../outside.txt' }).path, 'manifest.json')
  const unsafeSuggestion = errorRecord({ code: 'SOURCE_IO', path: 'manifest.json', suggestion: 'C:\\Users\\Private\\token' })
  assert.equal(unsafeSuggestion.suggestion, 'Check the plugin source and retry.')
})

test('pack preserves the existing command syntax while reporting a relative output location', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'wtplugin-cli-pack-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'source')
  const output = path.join(root, 'dist', 'cli.wtplugin')
  await mkdir(source)
  await mkdir(path.dirname(output))
  await writeFile(path.join(source, 'manifest.json'), JSON.stringify(manifest))
  const result = run(['pack', source, '--out', output, '--host-version', '0.1.0'], root)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.includes(root), false)
  assert.match(result.stdout, /dist\/cli\.wtplugin/)
  assert.equal((await readFile(output)).length > 0, true)
})
