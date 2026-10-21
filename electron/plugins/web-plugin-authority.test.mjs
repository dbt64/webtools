import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PluginManager } from './plugin-manager.ts'
import { WebHostCapabilities } from './web-host-capabilities.ts'
import { runtimeV3Manifest, runtimeV3Package, webManifest, webPackage } from './fixtures.mjs'

const capabilities = ['plugin.storage.read', 'plugin.storage.write', 'sharedAI.complete', 'clipboard.write']
function fixture(extra = {}) {
  const base = runtimeV3Manifest()
  const { requiredCapabilities = capabilities, ...fields } = extra
  return runtimeV3Manifest({ ...fields, requestedCapabilities: fields.requestedCapabilities ?? capabilities,
    features: [{ ...base.features[0], requiredCapabilities,
      acceptedContexts: [{ type: 'text', sources: ['launcher-input'] }] }] })
}
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'webtools-v2-authority-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const prompts = []
  const deps = { userData: root, hostVersion: '0.1.0', confirm: async r => { prompts.push(r); return true },
    externalOpen: async () => {}, clipboardWrite: () => {},
    ai: { complete: async () => ({ text: 'isolated' }), getDefaultProviderInfo: async () => ({ providerName: 'test', model: 'test' }) } }
  const manager = new PluginManager(deps)
  await manager.initialize()
  t.after(() => manager.close())
  return { root, prompts, deps, manager }
}
async function ticket(manager, manifest) {
  let authority
  const result = await manager.authorizeWebFeature({ pluginId: manifest.id, featureId: manifest.features[0].id }, manager.session,
    value => { authority = value; return Promise.resolve() })
  await result.completion
  return authority
}
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test('replacement revokes authority before confirmation settles; denial never revives old effects or tickets', async t => {
  const env = await setup(t); const m = fixture()
  await env.manager.install(runtimeV3Package(m), env.manager.session); await env.manager.setEnabled(m.id, true, env.manager.session)
  const old = await ticket(env.manager, m); const effectConfirmation = deferred(); const effectEntered = deferred(); const writes = []
  const host = new WebHostCapabilities({ authority: old, store: env.manager.store, isRuntimeCurrent: () => old.isCurrent(),
    effects: { hasForegroundGesture: () => true, isAIConfigured: async () => true, completeAI: async () => ({ text: 'isolated', outputTokens: 1 }),
      confirm: () => { effectEntered.resolve(); return effectConfirmation.promise }, clipboardWrite: text => writes.push(text) } })
  t.after(() => host.dispose())
  const pendingEffect = host.dispatch({ method: 'clipboard.write', payload: { text: 'must not commit' } }, new AbortController().signal)
  pendingEffect.catch(() => {}); await effectEntered.promise
  const entered = deferred(); const answer = deferred()
  env.deps.confirm = async request => { assert.equal(request.kind, 'install'); entered.resolve(); return answer.promise }
  const replacement = env.manager.install(runtimeV3Package(fixture({ version: '2.0.0' })), env.manager.session)
  await entered.promise
  assert.equal(old.isCurrent(), false, 'old ticket must be invalid while confirmation is unresolved')
  await assert.rejects(() => host.dispatch({ method: 'storage.get', payload: { key: 'note' } }, new AbortController().signal))
  effectConfirmation.resolve(true); await assert.rejects(pendingEffect); assert.deepEqual(writes, [])
  answer.resolve(false); assert.equal((await replacement).outcome, 'cancelled')
  assert.equal(old.isCurrent(), false)
  assert.equal((await env.manager.list())[0].version, '1.0.0')
  const fresh = await ticket(env.manager, m); assert.notEqual(fresh, old); assert.equal(fresh.isCurrent(), true)
})

test('replacement approval cannot overwrite a newer disable, grant mutation or uninstall intent', async t => {
  for (const action of ['disable', 'grants', 'uninstall']) await t.test(action, async t => {
    const env = await setup(t); const m = fixture()
    await env.manager.install(runtimeV3Package(m), env.manager.session); await env.manager.setEnabled(m.id, true, env.manager.session)
    const old = await ticket(env.manager, m); const entered = deferred(); const answer = deferred()
    env.deps.confirm = async request => request.kind === 'install' ? (entered.resolve(), answer.promise) : true
    const replacement = env.manager.install(runtimeV3Package(fixture({ version: '2.0.0' })), env.manager.session)
    replacement.catch(() => {}); await entered.promise
    const mutation = action === 'disable' ? env.manager.setEnabled(m.id, false, env.manager.session)
      : action === 'grants' ? env.manager.setGrants(m.id, ['plugin.storage.read'], env.manager.session)
      : env.manager.uninstall(m.id, env.manager.session)
    answer.resolve(true)
    await assert.rejects(replacement, error => error.code === 'INTENT_SUPERSEDED'); await mutation
    assert.equal(old.isCurrent(), false); await assert.rejects(() => ticket(env.manager, m))
    const rows = await env.manager.list(); assert.equal(rows.length, action === 'uninstall' ? 0 : 1)
    if (rows.length) assert.equal(rows[0].version, '1.0.0')
  })
})

test('concurrent replacement attempts serialize and each binds the then-current installation', async t => {
  const env = await setup(t); const m = fixture()
  await env.manager.install(runtimeV3Package(m), env.manager.session); await env.manager.setEnabled(m.id, true, env.manager.session)
  const old = await ticket(env.manager, m); const entered = deferred(); const answer = deferred()
  env.deps.confirm = async request => request.version === '2.0.0' ? (entered.resolve(), answer.promise) : true
  const first = env.manager.install(runtimeV3Package(fixture({ version: '2.0.0' })), env.manager.session)
  await entered.promise
  const second = env.manager.install(runtimeV3Package(fixture({ version: '3.0.0' })), env.manager.session)
  assert.equal(old.isCurrent(), false); answer.resolve(true)
  assert.equal((await first).outcome, 'installed'); assert.equal((await second).change.currentVersion, '2.0.0')
  assert.equal((await env.manager.list())[0].version, '3.0.0'); assert.equal(old.isCurrent(), false)
  assert.equal((await ticket(env.manager, fixture({ version: '3.0.0' }))).isCurrent(), true)
})

test('replacement revalidates its installed archive after trusted confirmation', async t => {
  const env = await setup(t); const m = fixture(); const installed = await env.manager.install(runtimeV3Package(m), env.manager.session)
  await env.manager.setEnabled(m.id, true, env.manager.session); const old = await ticket(env.manager, m)
  const entered = deferred(); const answer = deferred()
  env.deps.confirm = async () => { entered.resolve(); return answer.promise }
  const replacement = env.manager.install(runtimeV3Package(fixture({ version: '2.0.0' })), env.manager.session); replacement.catch(() => {})
  await entered.promise
  await writeFile(join(env.root, 'plugins', 'packages', m.id, m.version, `${installed.plugin.hash}.wtplugin`), runtimeV3Package(fixture({ name: 'Changed archive' })))
  answer.resolve(true); await assert.rejects(replacement, error => error.code === 'INTEGRITY_FAILED')
  assert.equal(old.isCurrent(), false); assert.equal((await env.manager.list())[0].version, '1.0.0')
})

test('retired v2 network declarations require repack and v3 no longer accepts the legacy capability', async t => {
  const env = await setup(t)
  const legacy = webManifest({ requestedCapabilities: ['network.domains', 'plugin.storage.read'],
    features: [{ id: 'hello', title: 'Hello', entry: { kind: 'web-bundle', document: 'web/index.html' }, requiredCapabilities: ['network.domains'] }],
    network: { mode: 'domains', domains: [{ host: 'status.example.com', protocol: 'https' }] } })
  await assert.rejects(() => env.manager.install(webPackage(legacy), env.manager.session), error => error.code === 'INCOMPATIBLE_PLUGIN')
  const v3 = fixture({ requestedCapabilities: ['network.domains'], requiredCapabilities: ['network.domains'] })
  await assert.rejects(() => env.manager.install(runtimeV3Package(v3), env.manager.session), error => error.code === 'INVALID_CAPABILITY')
})

test('v3 installation persists exact package identity and requests without granting authority; restart preserves explicit grants', async t => {
  const env = await setup(t); const m = fixture()
  const installed = await env.manager.install(runtimeV3Package(m), env.manager.session)
  assert.equal(installed.plugin.manifestVersion, 3)
  assert.equal(installed.plugin.enabled, false)
  assert.deepEqual(installed.plugin.requested, capabilities)
  assert.deepEqual(installed.plugin.granted, [])
  await assert.rejects(() => ticket(env.manager, m))
  await env.manager.setGrants(m.id, capabilities, env.manager.session)
  await env.manager.setEnabled(m.id, true, env.manager.session)
  const first = await ticket(env.manager, m)
  assert.equal(first.snapshot.packageHash, installed.plugin.hash)
  assert.equal(first.snapshot.manifest.version, m.version)
  assert.equal(first.isCurrent('plugin.storage.write'), true)
  env.manager.close()
  assert.equal(first.isCurrent('plugin.storage.write'), false)
  const restarted = new PluginManager(env.deps); await restarted.initialize(); t.after(() => restarted.close())
  assert.deepEqual((await restarted.list())[0].granted, capabilities)
  assert.equal((await ticket(restarted, m)).isCurrent('plugin.storage.write'), true)
})
test('valid v3 Unicode scalar metadata limits survive registry persistence without weakening v1 rules', async t => {
  const env = await setup(t)
  const m = fixture({ name: '😀'.repeat(80), description: '😀'.repeat(512), author: { name: '😀'.repeat(128) } })
  const installed = await env.manager.install(runtimeV3Package(m), env.manager.session)
  assert.equal(installed.plugin.name, m.name); assert.equal(installed.plugin.description, m.description)
  env.manager.close(); const restarted = new PluginManager(env.deps); await restarted.initialize(); t.after(() => restarted.close())
  assert.equal((await restarted.list())[0].name, m.name)
})

test('grant revoke and disable synchronously revoke existing tickets before queued persistence', async t => {
  const { manager } = await setup(t); const m = fixture()
  await manager.install(runtimeV3Package(m), manager.session); await manager.setEnabled(m.id, true, manager.session)
  const current = await ticket(manager, m); let revoked = 0; current.onRevoke(() => revoked++)
  const revoke = manager.setGrants(m.id, ['plugin.storage.read'], manager.session)
  assert.equal(current.isCurrent('plugin.storage.write'), false); assert.equal(revoked, 1)
  await revoke; await assert.rejects(() => ticket(manager, m))
  await manager.setGrants(m.id, capabilities, manager.session)
  const next = await ticket(manager, m)
  const disable = manager.setEnabled(m.id, false, manager.session)
  assert.equal(next.isCurrent(), false); await disable
})

test('per-Feature required capabilities are authority; package grants alone do not authorize undeclared methods', async t => {
  const { manager } = await setup(t); const m = fixture({ requiredCapabilities: ['plugin.storage.read'] })
  await manager.install(runtimeV3Package(m), manager.session); await manager.setEnabled(m.id, true, manager.session)
  const current = await ticket(manager, m)
  assert.equal(current.isCurrent('plugin.storage.read'), true)
  assert.equal(current.isCurrent('plugin.storage.write'), false)
  await assert.rejects(() => manager.authorizeWebFeature({ pluginId: m.id, featureId: 'forged-feature' }, manager.session, async () => {}))
})

test('update revokes old package; expansion never auto-grants; uninstall/reinstall never restores stale grants', async t => {
  const { manager } = await setup(t); const m = fixture({ requestedCapabilities: ['plugin.storage.read'], requiredCapabilities: ['plugin.storage.read'] })
  await manager.install(runtimeV3Package(m), manager.session); await manager.setEnabled(m.id, true, manager.session)
  const first = await ticket(manager, m)
  const updated = fixture({ version: '2.0.0' })
  await manager.install(runtimeV3Package(updated), manager.session)
  assert.equal(first.isCurrent(), false)
  assert.deepEqual((await manager.list())[0].granted, ['plugin.storage.read'])
  await assert.rejects(() => ticket(manager, updated))
  await manager.uninstall(m.id, manager.session)
  await manager.install(runtimeV3Package(updated), manager.session)
  assert.deepEqual((await manager.list())[0].granted, [])
  assert.equal((await manager.list())[0].enabled, false)
})

test('registry corruption and legacy grant records cannot recreate v3 authority; archive/hash mismatch fails closed', async t => {
  const env = await setup(t); const m = fixture()
  const installed = await env.manager.install(runtimeV3Package(m), env.manager.session)
  await env.manager.setEnabled(m.id, true, env.manager.session); env.manager.close()
  const path = join(env.root, 'plugins', 'registry.json')
  const registry = JSON.parse(await readFile(path, 'utf8'))
  delete registry.plugins[0].manifestVersion
  await writeFile(path, JSON.stringify(registry))
  const restarted = new PluginManager(env.deps); await restarted.initialize(); t.after(() => restarted.close())
  await assert.rejects(() => ticket(restarted, m))
  const row = (await restarted.list())[0]
  assert.equal(row.enabled, false)
  assert.deepEqual(row.granted, [])
  const archive = join(env.root, 'plugins', 'packages', m.id, m.version, `${installed.plugin.hash}.wtplugin`)
  await writeFile(archive, Buffer.from('invalid archive'))
  await assert.rejects(() => restarted.setEnabled(m.id, true, restarted.session))
})
