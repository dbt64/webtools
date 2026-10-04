import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PluginManager } from './plugin-manager.ts'
import { manifest, packageBytes } from './fixtures.mjs'
async function setup(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'webtools-plugin-manager-')); t.after(() => rm(root, { recursive: true, force: true }))
  const effects = []; const prompts = []
  const deps = { userData: root, hostVersion: '0.1.0', confirm: async request => { prompts.push(request); return true }, externalOpen: async url => { effects.push(['open', url]) }, clipboardWrite: text => { effects.push(['clipboard', text]) }, ai: { complete: async () => ({ text: 'answer', providerName: 'Mock', providerId: 'mock', model: 'mock' }), getDefaultProviderInfo: async () => ({ providerName: 'Mock', model: 'mock' }) }, ...options }
  const manager = new PluginManager(deps); await manager.initialize(); return { root, deps, manager, session: manager.session, effects, prompts }
}
const caps = ['manager.page', 'plugin.config.read', 'plugin.config.write', 'plugin.storage.read', 'plugin.storage.write', 'external.open', 'clipboard.write', 'sharedAI.complete']
function allManifest(extra = {}) { return manifest({ requestedCapabilities: caps, settings: [{ key: 'label', label: 'Label', type: 'text', minLength: 0, maxLength: 32, default: 'hello' }], actions: [{ id: 'get', type: 'plugin.config.read', key: 'label' }, { id: 'set', type: 'plugin.config.write', key: 'label' }, { id: 'read', type: 'plugin.storage.read', key: 'saved' }, { id: 'write', type: 'plugin.storage.write', key: 'saved' }, { id: 'open', type: 'external.open', url: 'https://example.org/' }, { id: 'copy', type: 'clipboard.write' }, { id: 'ai', type: 'sharedAI.complete' }], ...extra }) }
async function enabled(env, value = allManifest()) { const result = await env.manager.install(packageBytes(value), env.session); await env.manager.setEnabled(value.id, true, env.session); return (await env.manager.list())[0] }
function request(p, actionId, input = null) { return { pluginId: p.id, version: p.version, hash: p.hash, actionId, input } }
test('first install is disabled/ungranted and repeated identical import is idempotent', async t => {
  const env = await setup(t); const bytes = packageBytes()
  const first = await env.manager.install(bytes, env.session); assert.equal(first.plugin.enabled, false); assert.deepEqual(first.plugin.granted, [])
  assert.equal((await env.manager.install(bytes, env.session)).outcome, 'already-installed')
  await assert.rejects(() => env.manager.getPages(first.plugin.id, env.session)); assert.equal(env.prompts.length, 1)
})
test('conflicting hash and downgrade require separate consent; upgrade retains rollback and data', async t => {
  const env = await setup(t); let p = await enabled(env)
  await env.manager.invoke(request(p, 'write', { value: { retained: true } }), env.session)
  const replacement = packageBytes(allManifest({ description: 'Different' }))
  env.deps.confirm = async () => false
  assert.equal((await env.manager.install(replacement, env.session)).outcome, 'cancelled'); assert.equal((await env.manager.list())[0].hash, p.hash)
  env.deps.confirm = async () => true
  await env.manager.install(packageBytes(allManifest({ version: '2.0.0' })), env.session)
  p = (await env.manager.list())[0]; assert.equal(p.version, '2.0.0'); assert.equal(p.installedVersions.length, 2)
  assert.deepEqual((await env.manager.invoke(request(p, 'read'), env.session)).value, { retained: true })
  env.deps.confirm = async () => false
  assert.equal((await env.manager.install(packageBytes(allManifest()), env.session)).outcome, 'cancelled')
  assert.equal((await env.manager.list())[0].version, '2.0.0')
})
test('failed registry commit rolls back activation and removes new staged/package bytes', async t => {
  const env = await setup(t); const p = await enabled(env)
  const save = env.manager.registry.save.bind(env.manager.registry); env.manager.registry.save = async () => { throw new Error('simulated write failure') }
  await assert.rejects(() => env.manager.install(packageBytes(allManifest({ version: '2.0.0' })), env.session))
  env.manager.registry.save = save
  assert.equal((await env.manager.list())[0].hash, p.hash); assert.deepEqual(await readdir(join(env.root, 'plugins', 'staging')), [])
  assert.equal((await env.manager.invoke(request(p, 'get'), env.session)).value, 'hello')
})
test('permission, declaration, exact version/hash and closed action inputs enforced in Main', async t => {
  const env = await setup(t); const result = await env.manager.install(packageBytes(allManifest()), env.session); const p = result.plugin
  await assert.rejects(() => env.manager.invoke(request(p, 'open'), env.session))
  await env.manager.setEnabled(p.id, true, env.session)
  for (const r of [request(p, 'undeclared'), { ...request(p, 'get'), hash: '0'.repeat(64) }, request(p, 'open', { url: 'https://other.example/' }), request(p, 'set', { value: 42 }), request(p, 'copy', { text: 'ok', otherPluginId: 'org.other' })]) await assert.rejects(() => env.manager.invoke(r, env.session))
  await env.manager.invoke(request(p, 'open'), env.session); assert.deepEqual(env.effects, [['open', 'https://example.org/']])
  await env.manager.setGrants(p.id, ['manager.page'], env.session)
  await assert.rejects(() => env.manager.invoke(request(p, 'open'), env.session)); assert.equal(env.effects.length, 1)
})
test('sensitive action refusal/reload discards pending consent and performs no effect', async t => {
  const env = await setup(t); const p = await enabled(env)
  env.deps.confirm = async () => false; assert.deepEqual(await env.manager.invoke(request(p, 'copy', { text: 'text' }), env.session), { status: 'cancelled' }); assert.equal(env.effects.length, 0)
  let release; env.deps.confirm = () => new Promise(resolve => { release = resolve })
  const invocation = env.manager.invoke(request(p, 'open'), env.session); await until(() => release)
  env.manager.beginSession(); release(true)
  assert.deepEqual(await invocation, { status: 'cancelled' }); assert.equal(env.effects.length, 0)
})
async function until(condition) { for (let i = 0; i < 500; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 2)) } throw new Error('test checkpoint timeout') }
test('pending upgrade cannot reactivate after disable or revoke intent, including session restore', async t => {
  for (const mode of ['disable', 'revoke']) {
    const env = await setup(t); const p = await enabled(env); let consent; let releaseFlush; let flushCalls = 0
    env.deps.confirm = () => new Promise(resolve => { consent = resolve })
    const upgrading = env.manager.install(packageBytes(allManifest({ version: '2.0.0' })), env.session); await until(() => consent)
    const flush = env.manager.store.flush.bind(env.manager.store)
    env.manager.store.flush = async () => { if (++flushCalls === 2) await new Promise(resolve => { releaseFlush = resolve }); await flush() }
    const stopping = mode === 'disable' ? env.manager.setEnabled(p.id, false, env.session) : env.manager.setGrants(p.id, ['manager.page'], env.session)
    consent(true); await upgrading; await until(() => releaseFlush)
    const upgraded = (await env.manager.list())[0]
    await assert.rejects(() => env.manager.invoke(request(upgraded, 'get'), env.session))
    assert.notEqual(upgraded.status, 'active')
    // Restoration is queued too; it must not reopen access after the stop commits.
    const restore = env.manager.restoreSession(); releaseFlush(); await stopping; await restore
    await assert.rejects(() => env.manager.invoke(request(upgraded, 'get'), env.session))
  }
})
test('valid registry reconciles verified crash orphans without changing an active selection', async t => {
  const env = await setup(t); const p = await enabled(env)
  const { createHash } = await import('node:crypto'); const { mkdir } = await import('node:fs/promises')
  for (const m of [allManifest({ version: '2.0.0' }), manifest({ id: 'org.example.orphan' })]) {
    const bytes = packageBytes(m); const hash = createHash('sha256').update(bytes).digest('hex')
    const dir = join(env.root, 'plugins', 'packages', m.id, m.version); await mkdir(dir, { recursive: true }); await writeFile(join(dir, `${hash}.wtplugin`), bytes)
  }
  const restarted = new PluginManager(env.deps); await restarted.initialize(); const rows = await restarted.list()
  const existing = rows.find(row => row.id === p.id); assert.equal(existing.hash, p.hash); assert.equal(existing.status, 'active'); assert.equal(existing.installedVersions.length, 2)
  const orphan = rows.find(row => row.id === 'org.example.orphan'); assert.ok(orphan); assert.equal(orphan.enabled, false); assert.deepEqual(orphan.granted, []); assert.equal(orphan.errorCode, 'REGISTRY_RECOVERED')
  const again = new PluginManager(env.deps); await again.initialize(); assert.equal((await again.list()).find(row => row.id === orphan.id).errorCode, 'REGISTRY_RECOVERED')
})
test('AI preview, one concurrency slot, rate quota and no credentials in response', async t => {
  let finish; let calls = 0; const ai = { getDefaultProviderInfo: async () => ({ providerName: 'Mock', model: 'model' }), complete: async (messages, signal, tokens) => { calls++; assert.equal(tokens, 2048); return new Promise(resolve => { finish = () => resolve({ text: 'safe', apiKey: 'not-exposed', endpoint: 'not-exposed' }) }) } }
  const env = await setup(t, { ai }); const p = await enabled(env); const r = request(p, 'ai', { messages: [{ role: 'user', content: 'exact preview text' }] })
  const invocation = env.manager.invoke(r, env.session); await until(() => finish)
  await assert.rejects(() => env.manager.invoke(r, env.session), error => error.code === 'AI_BUSY')
  assert.ok(env.prompts.some(prompt => prompt.kind === 'ai' && prompt.preview.includes('exact preview text')))
  finish(); assert.deepEqual(await invocation, { status: 'success', value: { text: 'safe' } })
  env.deps.ai.complete = async () => ({ text: 'safe' })
  for (let i = 0; i < 4; i++) await env.manager.invoke(r, env.session)
  await assert.rejects(() => env.manager.invoke(r, env.session), error => error.code === 'AI_RATE_LIMIT'); assert.equal(calls, 1)
})
test('disable/revoke/uninstall/Manager close abort AI and ignore noncooperative late responses', async t => {
  for (const stop of ['disable', 'revoke', 'uninstall', 'close']) {
    let finish; let signal
    const env = await setup(t, { ai: { getDefaultProviderInfo: async () => ({ providerName: 'Mock', model: 'm' }), complete: async (_, s) => { signal = s; return new Promise(resolve => { finish = () => resolve({ text: 'late' }) }) } } })
    const p = await enabled(env); const invocation = env.manager.invoke(request(p, 'ai', { messages: [{ role: 'user', content: 'hello' }] }), env.session); await until(() => finish)
    if (stop === 'disable') await env.manager.setEnabled(p.id, false, env.session)
    if (stop === 'revoke') await env.manager.setGrants(p.id, ['manager.page'], env.session)
    if (stop === 'uninstall') await env.manager.uninstall(p.id, env.session)
    if (stop === 'close') env.manager.close()
    assert.equal(signal.aborted, true); assert.deepEqual(await invocation, { status: 'cancelled' }); finish()
  }
})
test('restart restores enabled valid packages, corruption recovery disables and tampering is rejected', async t => {
  const env = await setup(t); const p = await enabled(env)
  const restarted = new PluginManager(env.deps); await restarted.initialize(); assert.equal((await restarted.list())[0].status, 'active')
  await writeFile(join(env.root, 'plugins', 'registry.json'), '{broken')
  const recovery = new PluginManager(env.deps); await recovery.initialize(); assert.equal((await recovery.list())[0].enabled, false); assert.deepEqual((await recovery.list())[0].granted, [])
  const archive = join(env.root, 'plugins', 'packages', p.id, p.version, `${p.hash}.wtplugin`); await writeFile(archive, packageBytes(allManifest({ name: 'Tampered' })))
  await assert.rejects(() => restarted.invoke(request(p, 'get'), restarted.session)); assert.equal((await restarted.list())[0].enabled, false)
})
test('private data retained by default, explicitly deleted independently and serialized uninstall/install', async t => {
  const env = await setup(t); let p = await enabled(env); await env.manager.invoke(request(p, 'write', { value: 'saved' }), env.session)
  env.deps.confirm = async request => request.kind !== 'delete-data'
  assert.equal((await env.manager.uninstall(p.id, env.session)).removed, true)
  assert.ok(await readFile(join(env.root, 'plugins', 'data', `${p.id}.json`)))
  p = await enabled(env); assert.equal((await env.manager.invoke(request(p, 'read'), env.session)).value, 'saved')
  env.deps.confirm = async () => true
  await Promise.all([env.manager.uninstall(p.id, env.session), env.manager.install(packageBytes(allManifest()), env.session)])
  assert.equal((await env.manager.list()).length, 1); assert.equal((await env.manager.list())[0].enabled, false)
  await assert.rejects(() => readFile(join(env.root, 'plugins', 'data', `${p.id}.json`)))
})
test('compatible upgrade defaults, new capabilities require grants, and incompatible config rolls back', async t => {
  const env = await setup(t); const p = await enabled(env)
  await env.manager.invoke(request(p, 'set', { value: 'long-value' }), env.session)
  await assert.rejects(() => env.manager.install(packageBytes(allManifest({ version: '2.0.0', settings: [{ key: 'label', label: 'L', type: 'text', minLength: 0, maxLength: 2, default: '' }] })), env.session), error => error.code === 'CONFIG_INCOMPATIBLE')
  assert.equal((await env.manager.list())[0].version, '1.0.0')
  const second = manifest({ id: 'org.example.minimal' }); await env.manager.install(packageBytes(second), env.session); await env.manager.setEnabled(second.id, true, env.session)
  await env.manager.install(packageBytes({ ...second, version: '2.0.0', requestedCapabilities: ['manager.page', 'external.open'], actions: [{ id: 'open', type: 'external.open', url: 'https://example.org/' }] }), env.session)
  assert.equal((await env.manager.list()).find(p => p.id === second.id).status, 'needs-permission')
})
test('disabling immediately blocks new calls even when another mutation waits for consent', async t => {
  const env = await setup(t); const p = await enabled(env); let release
  env.deps.confirm = () => new Promise(resolve => { release = resolve })
  const install = env.manager.install(packageBytes(allManifest({ version: '2.0.0' })), env.session); await until(() => release)
  const disable = env.manager.setEnabled(p.id, false, env.session)
  await assert.rejects(() => env.manager.invoke(request(p, 'get'), env.session))
  release(true); await install; await disable
  assert.equal((await env.manager.list())[0].enabled, false)
})
test('late configuration writes cannot bypass upgraded schema compatibility', async t => {
  const env = await setup(t); const p = await enabled(env); let resolvePause; let writing = false
  const flush = env.manager.store.flush.bind(env.manager.store)
  env.manager.store.flush = async () => { writing = true; await new Promise(resolve => { resolvePause = resolve }); return flush() }
  const upgrading = env.manager.install(packageBytes(allManifest({ version: '2.0.0', settings: [{ key: 'label', label: 'L', type: 'text', minLength: 0, maxLength: 8, default: '' }] })), env.session)
  await until(() => writing)
  await assert.rejects(() => env.manager.invoke(request(p, 'set', { value: 'long-value' }), env.session))
  resolvePause(); await upgrading
  assert.equal((await env.manager.list())[0].version, '2.0.0')
})
test('AI aborts after 60 seconds and rejects provider changes after preview', async t => {
  let invoked = false
  const env = await setup(t, { ai: { getDefaultProviderInfo: async () => ({ providerName: 'Mock', model: 'm', identity: 'initial' }), complete: async () => { invoked = true; return new Promise(() => {}) } } })
  const p = await enabled(env)
  env.deps.confirm = async () => { env.deps.ai.getDefaultProviderInfo = async () => ({ providerName: 'Changed', model: 'new', identity: 'changed' }); return true }
  await assert.rejects(() => env.manager.invoke(request(p, 'ai', { messages: [{ role: 'user', content: 'hello' }] }), env.session)); assert.equal(invoked, false)
  env.deps.confirm = async () => true
  const { DeclarativeRuntime } = await import('./declarative-runtime.ts'); const { PermissionBroker } = await import('./permission-broker.ts'); const { parseManifest } = await import('./manifest.ts')
  const runtime = new DeclarativeRuntime(parseManifest(Buffer.from(JSON.stringify(allManifest())), '0.1.0'), p.hash, new Map())
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const call = runtime.invoke('ai', { messages: [{ role: 'user', content: 'hello' }] }, new PermissionBroker(env.deps), env.manager.store, () => true)
  const outcome = assert.rejects(call, error => error.code === 'AI_TIMEOUT')
  for (let i = 0; i < 20 && !invoked; i++) await Promise.resolve()
  assert.equal(invoked, true); t.mock.timers.tick(60_000); await outcome; t.mock.timers.reset()
})
test('AI timeout measures provider work, and cancelled lookup never opens a late preview', async t => {
  const env = await setup(t); const p = await enabled(env)
  let infoReady; let prompts = 0
  env.deps.ai.getDefaultProviderInfo = () => new Promise(resolve => { infoReady = resolve })
  env.deps.confirm = async () => { prompts++; return true }
  const pending = env.manager.invoke(request(p, 'ai', { messages: [{ role: 'user', content: 'hello' }] }), env.session)
  await until(() => infoReady); await env.manager.setEnabled(p.id, false, env.session)
  infoReady({ providerName: 'Mock', model: 'm' }); await pending
  for (let i = 0; i < 20; i++) await Promise.resolve()
  assert.equal(prompts, 0)
  const { DeclarativeRuntime } = await import('./declarative-runtime.ts'); const { PermissionBroker } = await import('./permission-broker.ts'); const { parseManifest } = await import('./manifest.ts')
  env.deps.ai.getDefaultProviderInfo = async () => ({ providerName: 'Mock', model: 'm' })
  let consent; let invoked = false
  env.deps.confirm = () => new Promise(resolve => { consent = resolve })
  env.deps.ai.complete = async () => { invoked = true; return { text: 'safe' } }
  const runtime = new DeclarativeRuntime(parseManifest(Buffer.from(JSON.stringify(allManifest())), '0.1.0'), p.hash, new Map())
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const call = runtime.invoke('ai', { messages: [{ role: 'user', content: 'hello' }] }, new PermissionBroker(env.deps), env.manager.store, () => true)
  for (let i = 0; i < 20 && !consent; i++) await Promise.resolve()
  t.mock.timers.tick(60_000); assert.equal(invoked, false); consent(true)
  assert.deepEqual(await call, { status: 'success', value: { text: 'safe' } }); t.mock.timers.reset()
})
