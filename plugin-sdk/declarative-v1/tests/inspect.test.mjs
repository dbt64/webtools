import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { crc32 } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { LIMITS_V1 } from '../index.mjs'
import { manifest, packageBytes, png, zip } from '../../../electron/plugins/fixtures.mjs'

const bin = fileURLToPath(new URL('../bin/webtools-plugin.mjs', import.meta.url))
const hostVersion = '0.1.0'

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', windowsHide: true })
}

function textChunk(value) {
  const type = Buffer.from('text')
  const data = Buffer.concat([Buffer.from([0]), Buffer.from(value)])
  const body = Buffer.concat([type, data])
  const header = Buffer.alloc(4)
  header.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(body))
  return Buffer.concat([header, body, checksum])
}

function pngWithText(value) {
  const image = png()
  return Buffer.concat([image.subarray(0, image.length - 12), textChunk(value), image.subarray(image.length - 12)])
}

async function setup(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'wtplugin-inspect-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

async function writeArchive(root, name, bytes) {
  const file = path.join(root, name)
  await writeFile(file, bytes)
  return file
}

test('inspect reports validated manifest metadata, archive size and SHA-256 in JSON', async t => {
  const root = await setup(t)
  const value = manifest({
    id: 'org.example.inspect',
    name: 'Inspect Sample',
    description: 'Safe display text',
    author: { name: 'Example Author', url: 'https://example.test' },
    requestedCapabilities: ['manager.page', 'plugin.storage.read'],
  })
  const bytes = packageBytes(value)
  const archive = await writeArchive(root, 'inspect.wtplugin', bytes)
  const before = await readFile(archive)
  const result = run(['inspect', archive, '--host-version', hostVersion, '--json'], root)

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal(result.stderr, '')
  const envelope = JSON.parse(result.stdout)
  assert.deepEqual(Object.keys(envelope).sort(), ['command', 'ok', 'result'])
  assert.equal(envelope.command, 'inspect')
  assert.equal(envelope.ok, true)
  assert.equal(envelope.result.valid, true)
  assert.deepEqual(envelope.result.plugin, {
    id: value.id,
    name: value.name,
    description: value.description,
    author: value.author,
    version: value.version,
    manifestVersion: value.manifestVersion,
    apiMajor: value.api.apiMajor,
    minHostVersion: value.api.minHostVersion,
    capabilities: value.requestedCapabilities,
  })
  assert.equal(envelope.result.size, bytes.length)
  assert.equal(envelope.result.sha256, createHash('sha256').update(bytes).digest('hex'))
  assert.deepEqual(await readFile(archive), before)
  assert.deepEqual(await readdir(root), ['inspect.wtplugin'])
  assert.equal(result.stdout.includes(root), false)
  assert.equal(result.stdout.trim().split(/\r?\n/).length, 1)
})

test('inspect has a readable human mode for valid packages', async t => {
  const root = await setup(t)
  const archive = await writeArchive(root, 'human.wtplugin', packageBytes(manifest({ id: 'org.example.human', name: 'Human Sample' })))
  const result = run(['inspect', archive, '--host-version', hostVersion], root)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /org\.example\.human/)
  assert.match(result.stdout, /Human Sample/)
  assert.match(result.stdout, /Requested capabilities: manager\.page\./)
  assert.match(result.stdout, /VALID/)
  assert.match(result.stdout, /SHA-256 [a-f0-9]{64}/)
  assert.equal(result.stdout.includes(root), false)
})

test('inspect rejects non-wtplugin extensions and empty or truncated archives without changing files', async t => {
  const root = await setup(t)
  const valid = packageBytes()
  const files = [
    ['wrong.zip', valid],
    ['empty.wtplugin', Buffer.alloc(0)],
    ['truncated.wtplugin', valid.subarray(0, valid.length - 5)],
  ]
  for (const [name, bytes] of files) {
    const archive = await writeArchive(root, name, bytes)
    const before = await readFile(archive)
    const result = run(['inspect', archive, '--host-version', hostVersion, '--json'], root)
    assert.equal(result.status, 1, name)
    assert.equal(result.stderr, '', name)
    const envelope = JSON.parse(result.stdout)
    assert.equal(envelope.ok, false, name)
    assert.equal(envelope.error.code, 'INVALID_PACKAGE', name)
    assert.equal(result.stdout.includes(root), false, name)
    assert.deepEqual(await readFile(archive), before, name)
  }
  assert.deepEqual((await readdir(root)).sort(), files.map(([name]) => name).sort())
})

test('inspect rejects oversized files before parsing and does not create extraction output', async t => {
  const root = await setup(t)
  const archive = await writeArchive(root, 'oversized.wtplugin', Buffer.alloc(LIMITS_V1.archive + 1))
  const result = run(['inspect', archive, '--host-version', hostVersion, '--json'], root)
  assert.equal(result.status, 1)
  assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_PACKAGE')
  assert.deepEqual((await readdir(root)).sort(), ['oversized.wtplugin'])
})

test('inspect rejects malformed local and central ZIP records', async t => {
  const root = await setup(t)
  const valid = packageBytes()
  const malformedLocal = Buffer.from(valid)
  malformedLocal.writeUInt32LE(0, 0)
  const centralOffset = malformedLocal.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  assert.ok(centralOffset > 0)
  const malformedCentral = Buffer.from(valid)
  malformedCentral.writeUInt32LE(0, centralOffset)
  for (const [name, bytes] of [['local.wtplugin', malformedLocal], ['central.wtplugin', malformedCentral]]) {
    const archive = await writeArchive(root, name, bytes)
    const before = await readFile(archive)
    const result = run(['inspect', archive, '--host-version', hostVersion, '--json'], root)
    assert.equal(result.status, 1, name)
    assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_PACKAGE', name)
    assert.deepEqual(await readFile(archive), before, name)
  }
})

test('inspect rejects undeclared, duplicate and path-colliding archive entries without extraction', async t => {
  const root = await setup(t)
  const manifestBytes = JSON.stringify(manifest())
  const cases = [
    ['undeclared.wtplugin', zip([{ name: 'manifest.json', data: manifestBytes }, { name: 'assets/orphan.png', data: png() }])],
    ['duplicate.wtplugin', zip([{ name: 'manifest.json', data: manifestBytes }, { name: 'manifest.json', data: manifestBytes }])],
    ['collision.wtplugin', zip([{ name: 'manifest.json', data: manifestBytes }, { name: 'assets', data: 'file' }, { name: 'assets/orphan.png', data: png() }])],
  ]
  for (const [name, bytes] of cases) {
    const archive = await writeArchive(root, name, bytes)
    const before = await readFile(archive)
    const result = run(['inspect', archive, '--host-version', hostVersion, '--json'], root)
    assert.equal(result.status, 1, name)
    assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_PACKAGE', name)
    assert.deepEqual(await readFile(archive), before, name)
  }
  assert.deepEqual((await readdir(root)).sort(), cases.map(([name]) => name).sort())
})

test('inspect rejects credential-like manifest and asset content without echoing it', async t => {
  const root = await setup(t)
  const secret = ['api_key=', 'sensitive', '1234567890abcdefghijklmnop'].join('')
  const secretManifest = packageBytes(manifest({ description: secret }))
  const imagePath = 'assets/icon.png'
  const assetManifest = manifest({
    entry: { pageId: 'home', label: 'Demo', icon: imagePath },
    assets: [{ path: imagePath, type: 'image/png' }],
  })
  const secretAsset = packageBytes(assetManifest, [{ name: imagePath, data: pngWithText(secret) }])
  for (const [name, bytes] of [['secret-manifest.wtplugin', secretManifest], ['secret-asset.wtplugin', secretAsset]]) {
    const archive = await writeArchive(root, name, bytes)
    const before = await readFile(archive)
    const result = run(['inspect', archive, '--host-version', hostVersion, '--json'], root)
    assert.equal(result.status, 1, name)
    assert.equal(JSON.parse(result.stdout).error.code, 'SENSITIVE_CONTENT', name)
    assert.equal(`${result.stdout}${result.stderr}`.includes(secret), false, name)
    assert.deepEqual(await readFile(archive), before, name)
  }
})

test('inspect rejects a package requiring a newer Host', async t => {
  const root = await setup(t)
  const archive = await writeArchive(root, 'new-host.wtplugin', packageBytes(manifest({ api: { apiMajor: 1, minHostVersion: '9.0.0' } })))
  const before = await readFile(archive)
  const result = run(['inspect', archive, '--host-version', hostVersion, '--json'], root)
  assert.equal(result.status, 1)
  assert.equal(JSON.parse(result.stdout).error.code, 'INCOMPATIBLE_PLUGIN')
  assert.deepEqual(await readFile(archive), before)
})
