import test from 'node:test'
import assert from 'node:assert/strict'
import { PluginCatalog } from './plugin-catalog.ts'
import { PluginManager } from './plugin-manager.ts'
import { manifest, packageBytes } from './fixtures.mjs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const summary = { id: 'webtools.translation', name: 'Untrusted Translation', version: '1.0.0', hash: 'a'.repeat(64), enabled: true, status: 'active', requested: ['manager.page'], granted: ['manager.page'], installedVersions: ['1.0.0'], source: 'local-unsigned' }
function setup() {
  let session = 'core'; let rows = [summary]
  const calls = []
  const core = { get session() { return session }, isSession: value => value === session, list: async () => rows, getPages: async (id, value) => { calls.push([id, value]); return { pluginId: id } }, setEnabled: async (id, enabled) => ({ ...summary, id, enabled }) }
  const catalog = new PluginCatalog('0.1.0', () => core)
  return { catalog, core, calls, rows: value => { rows = value }, rotate: () => { session = 'new' } }
}
test('fixed bundled Translation and same-ID package remain separate safe entries', async () => {
  const { catalog, calls } = setup()
  const snapshot = await catalog.list(catalog.session)
  assert.equal(snapshot.entries.length, 2)
  assert.equal(snapshot.entries[0].source, 'bundled')
  assert.equal(snapshot.entries[0].version, '0.1.0')
  assert.deepEqual(snapshot.entries[0].management, { canToggle: false, canManageGrants: false, canUninstall: false, canReplacePackage: false })
  assert.equal(snapshot.entries[1].kind, 'declarative')
  assert.equal(snapshot.entries[1].package.name, summary.name)
  assert.equal((await catalog.open({ kind: 'builtin', id: summary.id }, catalog.session)).key, 'translation')
  assert.equal(calls.length, 0)
  assert.equal((await catalog.open({ kind: 'declarative', id: summary.id }, catalog.session)).kind, 'declarative')
  assert.equal(calls.length, 1)
  await assert.rejects(catalog.setEnabled({ kind: 'builtin', id: summary.id }, false, catalog.session), { code: 'PERMISSION_DENIED' })
})
test('core failure is explicit while built-in list/open remains available', async () => {
  for (const core of [null, { session: 'core', isSession: () => true, list: async () => { throw new Error('C:/private/token') } }]) {
    const catalog = new PluginCatalog('0.1.0', () => core)
    const snapshot = await catalog.list(catalog.session)
    assert.equal(snapshot.entries.length, 1)
    assert.equal(snapshot.declarativeAvailability.status, 'unavailable')
    assert.equal(JSON.stringify(snapshot).includes('private'), false)
    assert.equal((await catalog.open({ kind: 'builtin', id: summary.id }, catalog.session)).kind, 'builtin')
    await assert.rejects(catalog.open({ kind: 'declarative', id: summary.id }, catalog.session))
  }
})
test('package status is projected unchanged and list revisions increase', async () => {
  const env = setup()
  for (const status of ['installed-disabled', 'needs-permission', 'incompatible', 'invalid', 'invoking']) {
    env.rows([{ ...summary, status }])
    const a = await env.catalog.list(env.catalog.session); const b = await env.catalog.list(env.catalog.session)
    assert.equal(a.entries[1].package.status, status)
    assert.ok(b.revision > a.revision)
  }
})
test('awaited catalog work cannot survive core reload, catalog reload or close', async () => {
  for (const invalidate of [env => env.rotate(), env => env.catalog.beginSession(), env => env.catalog.close()]) {
    const env = setup(); let complete
    env.core.list = () => new Promise(resolve => { complete = resolve })
    const pending = env.catalog.list(env.catalog.session)
    invalidate(env); complete([summary])
    await assert.rejects(pending, { code: 'SESSION_EXPIRED' })
  }
  const env = setup(); let complete
  env.core.getPages = () => new Promise(resolve => { complete = resolve })
  const pending = env.catalog.open({ kind: 'declarative', id: summary.id }, env.catalog.session)
  env.catalog.beginSession(); complete({ pluginId: summary.id })
  await assert.rejects(pending, { code: 'SESSION_EXPIRED' })
})

test('real manifest-v1 core retains grants/data and controls same-ID catalog page admission', async t => {
  const root = await mkdtemp(join(tmpdir(), 'webtools-5f-core-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const core = new PluginManager({ userData: root, hostVersion: '0.1.0', confirm: async () => true, externalOpen: async () => {}, clipboardWrite: () => {}, ai: { getDefaultProviderInfo: async () => { throw new Error('not used') }, complete: async () => { throw new Error('not used') } } })
  t.after(() => core.close())
  await core.initialize()
  const catalog = new PluginCatalog('0.1.0', () => core)
  const m = manifest({ id: 'webtools.translation', name: 'Untrusted same ID' })
  await core.install(packageBytes(m), core.session)
  const ref = { kind: 'declarative', id: m.id }
  await assert.rejects(catalog.open(ref, catalog.session), { code: 'PLUGIN_DISABLED' })
  await catalog.setEnabled(ref, true, catalog.session)
  const before = await readFile(join(root, 'plugins/registry.json'))
  const snapshot = await catalog.list(catalog.session)
  assert.equal(snapshot.entries[1].package.source, 'local-unsigned')
  assert.equal((await catalog.open(ref, catalog.session)).page.pluginId, m.id)
  assert.deepEqual(await readFile(join(root, 'plugins/registry.json')), before, 'projection does not migrate or reset registry')
  await core.setGrants(m.id, [], core.session)
  await assert.rejects(catalog.open(ref, catalog.session))
  assert.equal((await catalog.open({ kind: 'builtin', id: m.id }, catalog.session)).key, 'translation')
})
