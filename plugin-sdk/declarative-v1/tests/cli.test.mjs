import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { packageBytes, manifest as fixtureManifest } from '../../../electron/plugins/fixtures.mjs'

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
