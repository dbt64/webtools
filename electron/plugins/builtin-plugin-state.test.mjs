import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const implementation = await import('./builtin-plugin-state.ts').catch(() => null)
const ID = 'webtools.translation'

async function createProfile(t) {
  const root = await mkdtemp(join(tmpdir(), 'webtools-builtin-state-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

function createStore(root, options) {
  assert.ok(implementation, 'built-in plugin state module must exist')
  return new implementation.BuiltinPluginStateStore(root, options)
}

async function statePath(root) { return join(root, 'builtin-plugins', 'state.json') }

test('a genuinely missing state file defaults Translation to enabled without creating unrelated plugin data', async t => {
  const root = await createProfile(t)
  const store = createStore(root)

  assert.deepEqual(await store.load(), { status: 'ready', enabled: true, source: 'default' })
  assert.deepEqual(await readdir(root), [])
})

test('disabled state persists across store instances and preserves inert future plugin IDs and unrelated data', async t => {
  const root = await createProfile(t)
  await mkdir(join(root, 'plugins'))
  const registry = Buffer.from('{"registryVersion":1,"plugins":[]}')
  const data = Buffer.from('{"settings":{"translation":{"engine":"mymemory"}}}')
  await writeFile(join(root, 'plugins', 'registry.json'), registry)
  await writeFile(join(root, 'nook-data.json'), data)
  const store = createStore(root)

  await store.load()
  await store.setEnabled(ID, false)

  const persisted = JSON.parse(await readFile(await statePath(root), 'utf8'))
  assert.deepEqual(persisted, { stateVersion: 1, plugins: { [ID]: { enabled: false } } })
  assert.deepEqual(await createStore(root).load(), { status: 'ready', enabled: false, source: 'stored' })
  assert.deepEqual(await readFile(join(root, 'plugins', 'registry.json')), registry)
  assert.deepEqual(await readFile(join(root, 'nook-data.json')), data)

  const withFuture = createStore(root)
  await withFuture.load()
  await writeFile(await statePath(root), JSON.stringify({ stateVersion: 1, plugins: { [ID]: { enabled: false }, 'org.future.feature': { enabled: false } } }))
  const afterFutureReload = createStore(root)
  assert.deepEqual(await afterFutureReload.load(), { status: 'ready', enabled: false, source: 'stored' })
  await afterFutureReload.setEnabled(ID, true)
  assert.deepEqual(JSON.parse(await readFile(await statePath(root), 'utf8')).plugins['org.future.feature'], { enabled: false })
})

test('corrupt, unsupported, oversized, and malformed documents fail closed and are never overwritten by toggle', async t => {
  const cases = [
    ['corrupt JSON', '{'],
    ['unknown schema version', JSON.stringify({ stateVersion: 2, plugins: {} })],
    ['unknown fields', JSON.stringify({ stateVersion: 1, plugins: {}, secret: 'do-not-read' })],
    ['invalid known record', JSON.stringify({ stateVersion: 1, plugins: { [ID]: { enabled: 'false' } } })],
    ['oversized state', ' '.repeat(16 * 1024 + 1)],
    ['too many inert records', JSON.stringify({ stateVersion: 1, plugins: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`org.example.p${index}`, { enabled: false }])) })],
  ]
  for (const [label, contents] of cases) {
    const root = await createProfile(t)
    await mkdir(join(root, 'builtin-plugins'))
    const original = Buffer.from(contents)
    await writeFile(await statePath(root), original)
    const store = createStore(root)

    const loaded = await store.load()
    assert.equal(loaded.status, 'unavailable', label)
    await assert.rejects(store.setEnabled(ID, true), { code: /STATE_|UNSAFE_PATH/ }, label)
    assert.deepEqual(await readFile(await statePath(root)), original, `${label} bytes must remain untouched`)
  }
})

test('explicit recovery retains the original invalid bytes before resetting to the enabled default', async t => {
  const root = await createProfile(t)
  await mkdir(join(root, 'builtin-plugins'))
  const original = Buffer.from('{not valid state')
  await writeFile(await statePath(root), original)
  const store = createStore(root)

  assert.equal((await store.load()).status, 'unavailable')
  await store.recoverToDefault()

  assert.deepEqual(await store.load(), { status: 'ready', enabled: true, source: 'stored' })
  const names = await readdir(join(root, 'builtin-plugins'))
  const backup = names.find(name => name.endsWith('.bak'))
  assert.ok(backup, 'invalid original state must be retained in a backup')
  assert.deepEqual(await readFile(join(root, 'builtin-plugins', backup)), original)
  assert.deepEqual(JSON.parse(await readFile(await statePath(root), 'utf8')), { stateVersion: 1, plugins: { [ID]: { enabled: true } } })
})

test('a stale session cannot commit and an atomic rename failure preserves prior state and removes temp files', async t => {
  const root = await createProfile(t)
  const store = createStore(root)
  await store.load()

  await assert.rejects(store.setEnabled(ID, false, () => false), { code: 'SESSION_EXPIRED' })
  assert.equal((await createStore(root).load()).enabled, true)

  const failing = createStore(root, { renameFile: async () => { throw new Error('disk failure') } })
  await failing.load()
  await assert.rejects(failing.setEnabled(ID, false), { code: 'STATE_WRITE_FAILED' })
  assert.equal((await createStore(root).load()).enabled, true)
  assert.deepEqual(await readdir(join(root, 'builtin-plugins')), [])
})
