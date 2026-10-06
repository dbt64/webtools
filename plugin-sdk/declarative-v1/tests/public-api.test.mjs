import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import {
  ACTION_TYPES_V1,
  API_MAJOR_V1,
  BLOCK_TYPES_V1,
  CAPABILITIES_V1,
  LIMITS_V1,
  MANIFEST_VERSION_V1,
  PluginValidationError,
  packPluginV1,
  validatePluginArchiveV1,
  validatePluginSourceV1,
} from '@webtools/plugin-sdk'
import { manifest, packageBytes } from '../../../electron/plugins/fixtures.mjs'

test('package root preserves the v1 author contract and exposes only metadata authoring operations', async t => {
  assert.equal(MANIFEST_VERSION_V1, 1)
  assert.equal(API_MAJOR_V1, 1)
  assert.ok(CAPABILITIES_V1.includes('manager.page'))
  assert.ok(BLOCK_TYPES_V1.includes('paragraph'))
  assert.ok(ACTION_TYPES_V1.includes('plugin.storage.write'))
  assert.equal(LIMITS_V1.archive, 20 * 1024 * 1024)
  assert.equal(typeof validatePluginSourceV1, 'function')
  assert.equal(typeof validatePluginArchiveV1, 'function')
  assert.equal(typeof packPluginV1, 'function')
  assert.equal(typeof PluginValidationError, 'function')

  const root = await mkdtemp(path.join(tmpdir(), 'webtools-sdk-public-api-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'source')
  const output = path.join(root, 'dist')
  await mkdir(source)
  await mkdir(output)
  await writeFile(path.join(source, 'manifest.json'), JSON.stringify(manifest()))

  const checkedSource = await validatePluginSourceV1(source, '0.1.0')
  assert.equal(checkedSource.valid, true)
  assert.equal(checkedSource.manifest.id, 'org.example.demo')
  assert.ok(checkedSource.warnings.some(warning => warning.code === 'GENERIC_ICON'))
  assert.deepEqual(Object.keys(checkedSource).sort(), ['manifest', 'valid', 'warnings'])

  const bytes = packageBytes(manifest())
  const checkedArchive = await validatePluginArchiveV1(bytes, '0.1.0')
  assert.equal(checkedArchive.valid, true)
  assert.equal(checkedArchive.manifest.id, 'org.example.demo')
  assert.equal(checkedArchive.size, bytes.length)
  assert.equal(checkedArchive.sha256, createHash('sha256').update(bytes).digest('hex'))
  assert.deepEqual(Object.keys(checkedArchive).sort(), ['manifest', 'sha256', 'size', 'valid'])

  const packed = await packPluginV1(source, path.join(output, 'plugin.wtplugin'), '0.1.0')
  assert.equal(packed.valid, true)
  assert.equal(packed.manifest.id, 'org.example.demo')
  assert.equal(packed.size, (await readFile(path.join(output, 'plugin.wtplugin'))).length)
  assert.match(packed.sha256, /^[a-f0-9]{64}$/)
  assert.deepEqual(Object.keys(packed).sort(), ['manifest', 'sha256', 'size', 'valid'])
  assert.doesNotMatch(JSON.stringify([checkedSource, checkedArchive, packed]), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.equal('bytes' in checkedArchive, false)
  assert.equal('assets' in checkedArchive, false)
  await assert.rejects(() => packPluginV1(source, path.join(output, 'plugin.wtplugin'), '0.1.0'), error => error.code === 'OUTPUT_EXISTS')
})

test('public source validation rejects secret-like metadata and reports a known invalid field', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'webtools-sdk-public-errors-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'source')
  await mkdir(source)
  const secret = ['sk_live_', '1234567890', 'abcdefghijklmnop'].join('')
  await writeFile(path.join(source, 'manifest.json'), JSON.stringify(manifest({ description: `api_key=${secret}` })))
  await assert.rejects(() => validatePluginSourceV1(source, '0.1.0'), error => {
    assert.ok(error instanceof PluginValidationError)
    assert.equal(error.code, 'SENSITIVE_CONTENT')
    assert.equal(error.path, 'manifest.json')
    assert.equal(error.message.includes(secret), false)
    return true
  })

  await writeFile(path.join(source, 'manifest.json'), JSON.stringify(manifest({ id: 'not valid' })))
  await assert.rejects(() => validatePluginSourceV1(source, '0.1.0'), error => {
    assert.equal(error.code, 'INVALID_MANIFEST')
    assert.equal(error.path, 'manifest.json')
    assert.equal(error.field, 'id')
    return true
  })
})

test('archive summary hashes the exact snapshot that was validated if caller mutates its input', async () => {
  const original = packageBytes(manifest())
  const mutable = Buffer.from(original)
  const pending = validatePluginArchiveV1(mutable, '0.1.0')
  mutable.fill(0)
  const checked = await pending
  assert.equal(checked.valid, true)
  assert.equal(checked.size, original.length)
  assert.equal(checked.sha256, createHash('sha256').update(original).digest('hex'))
})

test('canonical manifest diagnostics retain unambiguous top-level field locations', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'webtools-sdk-public-fields-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'source')
  await mkdir(source)

  const invalidFields = [
    ['manifestVersion', { manifestVersion: 2 }, 'INVALID_MANIFEST'],
    ['type', { type: 'javascript' }, 'INVALID_MANIFEST'],
    ['id', { id: 'not valid' }, 'INVALID_MANIFEST'],
    ['version', { version: 'one' }, 'INVALID_MANIFEST'],
    ['api.apiMajor', { api: { apiMajor: 2, minHostVersion: '0.1.0' } }, 'INCOMPATIBLE_PLUGIN'],
    ['api.minHostVersion', { api: { apiMajor: 1, minHostVersion: 'bad' } }, 'INVALID_MANIFEST'],
    ['api.minHostVersion', { api: { apiMajor: 1, minHostVersion: '1.0.0' } }, 'INCOMPATIBLE_PLUGIN'],
    ['requestedCapabilities', { requestedCapabilities: ['filesystem.read'] }, 'INVALID_MANIFEST'],
    ['entry', { entry: {} }, 'INVALID_MANIFEST'],
    ['settings', { settings: 'invalid' }, 'INVALID_MANIFEST'],
    ['pages', { pages: 'invalid' }, 'INVALID_MANIFEST'],
    ['actions', { actions: 'invalid' }, 'INVALID_MANIFEST'],
    ['assets', { assets: 'invalid' }, 'INVALID_MANIFEST'],
  ]

  for (const [field, patch, code] of invalidFields) {
    await writeFile(path.join(source, 'manifest.json'), JSON.stringify(manifest(patch)))
    await assert.rejects(() => validatePluginSourceV1(source, '0.1.0'), error => {
      assert.equal(error.code, code, field)
      assert.equal(error.field, field, field)
      assert.equal(error.path, 'manifest.json', field)
      return true
    })
  }
})
