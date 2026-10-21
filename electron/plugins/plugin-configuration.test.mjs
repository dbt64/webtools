import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ManagedFs } from './managed-fs.ts'
import { PluginStore } from './plugin-store.ts'
import { runtimeV3Manifest } from './fixtures.mjs'

const descriptor = () => ({ schemaVersion: 1, settings: [
  { key: 'label', label: 'Label', type: 'text', minLength: 0, maxLength: 16, default: 'hello' },
  { key: 'compact', label: 'Compact', type: 'boolean', default: false },
] })
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'webtools-config-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fs = new ManagedFs(join(root, 'plugins')); await fs.initialize()
  return { root, fs, store: new PluginStore(fs), manifest: runtimeV3Manifest({ configuration: descriptor() }) }
}

test('v3 config defaults do not create a file or read v1 config for the same id', async t => {
  const env = await setup(t)
  await env.fs.atomicJson(`config/${env.manifest.id}.json`, { label: 'legacy' })
  assert.ok(env.store.configuration, 'the Host config seam must exist')
  const state = await env.store.configuration.inspect(env.manifest)
  assert.equal(state.status, 'ready'); assert.equal(state.revision, 'missing')
  assert.deepEqual(state.values, { label: 'hello', compact: false })
  await assert.rejects(() => env.fs.read(`config/v3/${env.manifest.id}.json`, 1000), { code: 'ENOENT' })
})

test('validated v3 writes persist, serialize, and reject stale manager revisions', async t => {
  const { store, manifest } = await setup(t)
  assert.ok(store.configuration)
  await Promise.all([store.configuration.set(manifest, 'label', 'saved', () => true), store.configuration.set(manifest, 'compact', true, () => true)])
  assert.deepEqual(await store.configuration.get(manifest), { label: 'saved', compact: true })
  const before = await store.configuration.inspect(manifest)
  await assert.rejects(() => store.configuration.update(manifest, { label: 'lost', compact: false }, 'missing', () => true), e => e.code === 'CONFIG_STALE')
  assert.equal((await store.configuration.inspect(manifest)).revision, before.revision)
  await assert.rejects(() => store.configuration.set(manifest, 'label', 42, () => true))
  await assert.rejects(() => store.configuration.set(manifest, 'unknown', 'x', () => true), e => e.code === 'CONFIGURATION_KEY_NOT_FOUND')
})

test('corrupt config is preserved and explicit recovery saves exact raw bytes before defaults', async t => {
  const env = await setup(t); assert.ok(env.store.configuration)
  await env.fs.mkdir('config/v3')
  const path = await env.fs.path(`config/v3/${env.manifest.id}.json`); const bytes = Buffer.from('{broken')
  await writeFile(path, bytes)
  const state = await env.store.configuration.inspect(env.manifest)
  assert.equal(state.status, 'incompatible')
  await assert.rejects(() => env.store.configuration.get(env.manifest), e => e.code === 'CONFIG_INCOMPATIBLE')
  await assert.rejects(() => env.store.configuration.set(env.manifest, 'label', 'new', () => true))
  assert.deepEqual(await readFile(path), bytes)
  await env.store.configuration.reset(env.manifest, state.revision, () => true)
  const backup = JSON.parse((await env.fs.read(`config/v3/${env.manifest.id}.backup.json`, 1000000)).toString())
  assert.deepEqual(Buffer.from(backup.originalBase64, 'base64'), bytes)
  assert.deepEqual(await env.store.configuration.get(env.manifest), { label: 'hello', compact: false })
})

test('schema mismatch and revoked commit preserve config; explicit delete removes all namespaces', async t => {
  const env = await setup(t); assert.ok(env.store.configuration)
  await env.store.configuration.set(env.manifest, 'label', 'saved', () => true)
  const before = await env.store.configuration.inspect(env.manifest)
  await assert.rejects(() => env.store.configuration.set(env.manifest, 'label', 'late', () => false))
  assert.equal((await env.store.configuration.inspect(env.manifest)).revision, before.revision)
  const changed = { ...env.manifest, configuration: { ...descriptor(), schemaVersion: 2 } }
  assert.equal((await env.store.configuration.inspect(changed)).status, 'incompatible')
  await env.store.configuration.reset(changed, before.revision, () => true)
  await env.fs.atomicJson(`config/${env.manifest.id}.json`, { legacy: 'preserve until deletion' })
  await env.store.writeData(env.manifest.id, 'private', 'data', () => true)
  await env.store.deletePrivateData(env.manifest.id)
  for (const path of [`config/${env.manifest.id}.json`, `config/v3/${env.manifest.id}.json`, `config/v3/${env.manifest.id}.backup.json`, `data/${env.manifest.id}.json`])
    await assert.rejects(() => env.fs.read(path, 1000000), { code: 'ENOENT' })
})

test('failed recovery backup prevents reset and preserves corrupt bytes', async t => {
  const env = await setup(t); await env.fs.mkdir('config/v3')
  const path = await env.fs.path(`config/v3/${env.manifest.id}.json`); await writeFile(path, '{broken')
  const state = await env.store.configuration.inspect(env.manifest)
  const original = env.fs.atomicJson.bind(env.fs)
  env.fs.atomicJson = async (logical, ...args) => { if (logical.endsWith('.backup.json')) throw new Error('backup unavailable'); return original(logical, ...args) }
  await assert.rejects(() => env.store.configuration.reset(env.manifest, state.revision, () => true))
  assert.equal(await readFile(path, 'utf8'), '{broken')
})

test('v3 store rejects transport-invalid strings without changing the saved file', async t => {
  const { store, manifest } = await setup(t)
  await store.configuration.set(manifest, 'label', 'valid🙂', () => true)
  const before = await store.configuration.inspect(manifest)
  await assert.rejects(() => store.configuration.set(manifest, 'label', '\ud800', () => true))
  await assert.rejects(() => store.configuration.update(manifest, { label: '\udfff', compact: false }, before.revision, () => true))
  const after = await store.configuration.inspect(manifest)
  assert.equal(after.revision, before.revision)
  assert.equal(after.values.label, 'valid🙂')
})
