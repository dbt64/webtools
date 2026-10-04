import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ManagedFs } from './managed-fs.ts'
import { PluginStore } from './plugin-store.ts'
import { PluginRegistry } from './plugin-registry.ts'
import { parseManifest, LIMITS } from './manifest.ts'
import { manifest } from './fixtures.mjs'
async function setup(t) { const root = await mkdtemp(join(tmpdir(), 'webtools-plugin-store-')); t.after(() => rm(root, { recursive: true, force: true })); const fs = new ManagedFs(join(root, 'plugins')); await fs.initialize(); return { root, fs, store: new PluginStore(fs), registry: new PluginRegistry(fs) } }
const parsed = overrides => parseManifest(Buffer.from(JSON.stringify(manifest(overrides))), '0.1.0')
test('full storage envelope depth is checked before replacement', async t => {
  const { store } = await setup(t); const id = 'org.example.depth'
  await store.writeData(id, 'keep', 'original', () => true)
  let value = null; for (let i = 0; i < 16; i++) value = [value]
  await assert.rejects(() => store.writeData(id, 'nested', value, () => true))
  assert.equal(await store.readData(id, 'keep'), 'original')
  await store.writeData(id, 'nested', value[0], () => true)
  assert.deepEqual(await store.readData(id, 'nested'), value[0])
})
test('configuration total byte quota preserves the previous readable document', async t => {
  const { fs, store } = await setup(t)
  const settings = Array.from({ length: 36 }, (_, i) => ({ key: `k${i}`, label: `K${i}`, type: 'text', minLength: 0, maxLength: 50000, default: '' }))
  const m = parsed({ settings }); const saved = Object.fromEntries(settings.slice(0, 34).map(s => [s.key, '中'.repeat(50000)]))
  await fs.atomicJson(`config/${m.id}.json`, saved)
  await assert.rejects(() => store.writeConfig(m, 'k34', '中'.repeat(50000), () => true), error => error.code === 'STORAGE_LIMIT')
  assert.equal((await store.readConfig(m)).k34, ''); assert.equal((await store.readConfig(m)).k0.length, 50000)
})
test('registry refuses an oversized document without poisoning its reader', async t => {
  const { registry } = await setup(t); await registry.save({ registryVersion: 1, plugins: [] })
  const versions = Array.from({ length: 256 }, (_, i) => ({ version: `1.0.${i}`, hash: i.toString(16).padStart(64, '0') }))
  const plugins = Array.from({ length: 50 }, (_, i) => ({ id: `org.example.p${i}`, name: 'Test', current: versions[0], versions, enabled: false, requested: [], granted: [], status: 'installed-disabled' }))
  await assert.rejects(() => registry.save({ registryVersion: 1, plugins }), error => error.code === 'STORAGE_LIMIT')
  assert.deepEqual(await registry.load(), { registryVersion: 1, plugins: [] })
})
test('config defaults, validated atomic updates and schema incompatibility', async t => {
  const { store } = await setup(t); const m = parsed({ settings: [{ key: 'name', label: 'Name', type: 'text', minLength: 0, maxLength: 12, default: 'default' }] })
  assert.deepEqual(await store.readConfig(m), { name: 'default' }); await store.writeConfig(m, 'name', 'saved', () => true)
  assert.equal((await store.readConfig(m)).name, 'saved'); await assert.rejects(() => store.writeConfig(m, 'name', 42, () => true))
  await assert.rejects(() => store.readConfig(parsed({ settings: [{ ...m.settings[0], maxLength: 2, default: '' }] })))
  await assert.rejects(() => store.writeConfig(m, 'name', 'stale', () => false)); assert.equal((await store.readConfig(m)).name, 'saved')
})
test('private JSON scope, value/key/total quotas and concurrent writes', async t => {
  const { store } = await setup(t)
  await Promise.all([store.writeData('org.example.one', 'a', { ok: true }, () => true), store.writeData('org.example.one', 'b', 2, () => true)])
  assert.deepEqual(await store.readData('org.example.one', 'a'), { ok: true }); assert.equal(await store.readData('org.example.two', 'a'), null)
  await assert.rejects(() => store.writeData('org.example.one', '../other', 3, () => true))
  await assert.rejects(() => store.writeData('org.example.one', 'big', 'x'.repeat(LIMITS.value), () => true))
  for (let i = 0; i < 10; i++) await store.writeData('org.example.quota', `k${i}`, 'x'.repeat(LIMITS.value - 100), () => true)
  await assert.rejects(() => store.writeData('org.example.quota', 'extra', 'x'.repeat(5000), () => true))
  for (let i = 0; i < 200; i++) await store.writeData('org.example.keys', `k${i}`, i, () => true)
  await assert.rejects(() => store.writeData('org.example.keys', 'extra', 1, () => true))
})
test('rejects corrupt data instead of overwriting it and preserves defaults on missing file', async t => {
  const { fs, store } = await setup(t); const path = await fs.path('data', 'org.example.demo.json'); await writeFile(path, '{broken')
  await assert.rejects(() => store.writeData('org.example.demo', 'a', 2, () => true)); assert.equal(await readFile(path, 'utf8'), '{broken')
})
test('managed filesystem rejects escape and junctions without deleting their target', async t => {
  const { root, fs } = await setup(t); const outside = join(root, 'outside'); const { mkdir } = await import('node:fs/promises'); await mkdir(outside); await writeFile(join(outside, 'keep'), 'KEEP')
  await assert.rejects(() => fs.path('..', 'outside'))
  await symlink(outside, join(root, 'plugins', 'staging', 'evil'), 'junction')
  await assert.rejects(async () => fs.remove(await fs.path('staging', 'evil')))
  assert.equal(await readFile(join(outside, 'keep'), 'utf8'), 'KEEP')
})
test('registry atomically persists validated records, treats corrupt content as recovery-needed', async t => {
  const { registry, fs } = await setup(t)
  assert.equal(await registry.load(), null)
  const data = { registryVersion: 1, plugins: [] }; await registry.save(data); assert.deepEqual(await registry.load(), data)
  await fs.atomicJson('registry.json', { registryVersion: 99, plugins: [] }); assert.equal(await registry.load(), null)
  await writeFile(await fs.path('registry.json'), '{"registryVersion":1,"registryVersion":1,"plugins":[]}'); assert.equal(await registry.load(), null)
})
