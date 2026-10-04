import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink, lstat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import yauzl from 'yauzl'
import { packPlugin } from '../src/pack.mjs'
import { cleanupOwnedTempFile } from '../src/owned-temp.mjs'
import { validatePackageV1 } from '../runtime/package-v1.mjs'
import { manifest, png } from '../../../electron/plugins/fixtures.mjs'

async function setup(t, value = manifest()) {
  const root = await mkdtemp(path.join(tmpdir(), 'wtplugin-pack-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify(value))
  return root
}

test('packer creates a deterministic host-valid UTF-8 archive from declared files only', async t => {
  const value = manifest({ id: 'org.example.unicode', entry: { pageId: 'home', label: 'Icon', icon: 'assets/图标.png' }, assets: [{ path: 'assets/图标.png', type: 'image/png' }] })
  const root = await setup(t, value)
  await mkdir(path.join(root, 'assets'))
  await writeFile(path.join(root, 'assets', '图标.png'), png())
  await writeFile(path.join(root, '.env'), 'do-not-package-secret=sample-secret-value')
  await mkdir(path.join(root, '.git'))
  await writeFile(path.join(root, '.git', 'config'), 'do not package')
  const out = path.join(root, 'dist')
  await mkdir(out)
  const first = await packPlugin(root, path.join(out, 'one.wtplugin'), '0.1.0')
  const second = await packPlugin(root, path.join(out, 'two.wtplugin'), '0.1.0')
  const firstBytes = await readFile(first.output)
  const secondBytes = await readFile(second.output)
  assert.deepEqual(firstBytes, secondBytes)
  assert.equal(first.sha256, createHash('sha256').update(firstBytes).digest('hex'))
  const checked = await validatePackageV1(firstBytes, '0.1.0')
  assert.equal(checked.manifest.id, value.id)
  assert.deepEqual([...checked.assets.keys()], ['assets/图标.png'])
  assert.equal(firstBytes.includes(Buffer.from('sample-secret-value')), false)
  assert.equal(first.size, firstBytes.length)
})

test('packer never overwrites an existing output', async t => {
  const root = await setup(t)
  const output = path.join(root, 'existing.wtplugin')
  await writeFile(output, 'keep-existing')
  await assert.rejects(() => packPlugin(root, output, '0.1.0'), error => error.code === 'OUTPUT_EXISTS')
  assert.equal(await readFile(output, 'utf8'), 'keep-existing')
})

test('temporary cleanup removes only the file identity owned by the packer', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'wtplugin-temp-owner-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const tempPath = path.join(root, '.webtools-plugin-owned.tmp')
  await writeFile(tempPath, 'owned')
  const ownedIdentity = await lstat(tempPath)
  await unlink(tempPath)
  await writeFile(tempPath, 'replacement')

  await cleanupOwnedTempFile(tempPath, ownedIdentity)

  assert.equal(await readFile(tempPath, 'utf8'), 'replacement')
})

test('packer rejects a declared asset reached through a directory junction', async t => {
  const value = manifest({ assets: [{ path: 'assets/icon.png', type: 'image/png' }] })
  const root = await setup(t, value)
  const outside = await mkdtemp(path.join(tmpdir(), 'wtplugin-outside-'))
  t.after(() => rm(outside, { recursive: true, force: true }))
  await writeFile(path.join(outside, 'icon.png'), png())
  await symlink(outside, path.join(root, 'assets'), 'junction')
  await assert.rejects(() => packPlugin(root, path.join(root, 'escape.wtplugin'), '0.1.0'), error => error.code === 'SOURCE_IO')
  assert.deepEqual((await readdir(root)).sort(), ['assets', 'manifest.json'])
})

test('packer rejects credential-like manifest content without printing the secret', async t => {
  const secret = ['sk_live_', '1234567890', 'abcdefghijklmnop'].join('')
  const root = await setup(t, manifest({ description: `api_key=${secret}` }))
  const output = path.join(root, 'secret.wtplugin')
  await assert.rejects(() => packPlugin(root, output, '0.1.0'), error => {
    assert.equal(error.code, 'SENSITIVE_CONTENT')
    assert.equal(error.message.includes(secret), false)
    return true
  })
  await assert.rejects(() => readFile(output))
  assert.deepEqual((await readdir(root)).sort(), ['manifest.json'])
})

test('packer leaves no partial package when the destination cannot be resolved', async t => {
  const root = await setup(t)
  const output = path.join(root, 'missing-directory', 'partial.wtplugin')
  await assert.rejects(() => packPlugin(root, output, '0.1.0'), error => error.code === 'OUTPUT_IO')
  assert.deepEqual((await readdir(root)).sort(), ['manifest.json'])
})
