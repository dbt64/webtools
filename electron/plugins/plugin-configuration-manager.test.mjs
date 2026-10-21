import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PluginManager } from './plugin-manager.ts'
import { runtimeV3Manifest, runtimeV3Package } from './fixtures.mjs'
import { WebHostCapabilities } from './web-host-capabilities.ts'
import { createBridgeConnection } from '../../plugin-sdk/declarative-v1/web/bridge-client.mjs'
import { createPluginHandlers } from '../ipc/plugin-handlers.ts'
import { IPC_CHANNELS } from '../../src/shared/ipc.ts'

const configCaps = ['plugin.config.read', 'plugin.config.write']
const descriptor = () => ({ schemaVersion: 1, settings: [{ key: 'label', label: 'Label', type: 'text', minLength: 0, maxLength: 16, default: 'hello' }] })
async function setup(t, extra = {}, approve = () => true) {
  const root = await mkdtemp(join(tmpdir(), 'webtools-config-manager-')); t.after(() => rm(root, { recursive: true, force: true }))
  const prompts = []; const deps = { userData: root, hostVersion: '0.1.0', confirm: async r => { prompts.push(r); return approve(r) },
    externalOpen: async () => {}, clipboardWrite: () => {}, ai: { complete: async () => ({ text: 'unused' }), getDefaultProviderInfo: async () => ({ providerName: 'test', model: 'test' }) } }
  const manager = new PluginManager(deps); await manager.initialize(); t.after(() => manager.close())
  const base = runtimeV3Manifest(); const manifest = runtimeV3Manifest({ requestedCapabilities: configCaps, configuration: descriptor(),
    features: [{ ...base.features[0], requiredCapabilities: configCaps }], ...extra })
  const result = await manager.install(runtimeV3Package(manifest), manager.session)
  const identity = { pluginId: result.plugin.id, version: result.plugin.version, hash: result.plugin.hash }
  return { root, manager, manifest, identity, deps, prompts }
}

test('trusted management reads and writes disabled ungranted plugins without activating them', async t => {
  const env = await setup(t)
  assert.equal(typeof env.manager.getConfiguration, 'function')
  const dto = await env.manager.getConfiguration(env.identity, env.manager.session)
  assert.equal(dto.status, 'ready'); assert.equal(dto.values.label, 'hello')
  assert.deepEqual(dto.identity, env.identity)
  const saved = await env.manager.updateConfiguration({ ...env.identity, revision: dto.revision, values: { label: 'saved' } }, env.manager.session)
  assert.equal(saved.values.label, 'saved')
  const plugin = (await env.manager.list())[0]
  assert.equal(plugin.enabled, false); assert.deepEqual(plugin.granted, []); assert.equal(plugin.status, 'installed-disabled')
  await assert.rejects(() => env.manager.authorizeWebFeature({ pluginId: plugin.id, featureId: 'hello' }, env.manager.session, async () => assert.fail('must not activate')))
})

test('management saves reject old package identities, ended sessions and concurrent revisions', async t => {
  const env = await setup(t); assert.equal(typeof env.manager.getConfiguration, 'function')
  const dto = await env.manager.getConfiguration(env.identity, env.manager.session)
  await env.manager.store.configuration.set(env.manifest, 'label', 'runtime', () => true)
  await assert.rejects(() => env.manager.updateConfiguration({ ...env.identity, revision: dto.revision, values: { label: 'lost' } }, env.manager.session), e => e.code === 'CONFIG_STALE')
  await env.manager.install(runtimeV3Package({ ...env.manifest, version: '2.0.0' }), env.manager.session)
  await assert.rejects(() => env.manager.getConfiguration(env.identity, env.manager.session), e => e.code === 'INTEGRITY_FAILED')
  const session = env.manager.session; await env.manager.close()
  await assert.rejects(() => env.manager.getConfiguration(env.identity, session), e => e.code === 'SESSION_EXPIRED')
})

test('invalid configuration packages are rejected by actual Host validation before install confirmation', async t => {
  const env = await setup(t); const count = env.prompts.length
  await assert.rejects(() => env.manager.install(runtimeV3Package({ ...env.manifest, version: '2.0.0', configuration: { ...descriptor(), script: 'anything' } }), env.manager.session))
  assert.equal(env.prompts.length, count); assert.equal((await env.manager.list())[0].version, '1.0.0')
})

test('manager reset requires Host confirmation and preserves exact incompatible bytes', async t => {
  let accept = false; const env = await setup(t, {}, r => r.kind !== 'reset-config' || accept)
  assert.equal(typeof env.manager.getConfiguration, 'function')
  await env.manager.fs.mkdir('config/v3'); const path = await env.manager.fs.path(`config/v3/${env.manifest.id}.json`)
  await writeFile(path, '{broken'); const dto = await env.manager.getConfiguration(env.identity, env.manager.session)
  assert.equal(dto.status, 'incompatible')
  await assert.rejects(() => env.manager.resetConfiguration({ ...env.identity, revision: dto.revision }, env.manager.session), e => e.code === 'USER_CONFIRMATION_REQUIRED')
  assert.equal(await readFile(path, 'utf8'), '{broken')
  accept = true
  const restored = await env.manager.resetConfiguration({ ...env.identity, revision: dto.revision }, env.manager.session)
  assert.equal(restored.status, 'ready'); assert.equal(restored.values.label, 'hello')
})

async function running(env, t) {
  await env.manager.setEnabled(env.manifest.id, true, env.manager.session)
  let authority; await (await env.manager.authorizeWebFeature({ pluginId: env.manifest.id, featureId: 'hello' }, env.manager.session, async a => { authority = a })).completion
  const service = new WebHostCapabilities({ authority, store: env.manager.store, isRuntimeCurrent: () => true,
    effects: { confirm: async () => assert.fail('config must not trigger AI/clipboard confirmation'), hasForegroundGesture: () => false, isAIConfigured: async () => false, completeAI: async () => assert.fail(), clipboardWrite: () => assert.fail() } })
  t.after(() => service.dispose())
  return { authority, service, call: (method, payload) => service.dispatch({ method, payload }, new AbortController().signal) }
}

test('SDK config API uses the same Host validated values as Manager and private data stays separate', async t => {
  const env = await setup(t); const runtime = await running(env, t)
  const client = createBridgeConnection({ getReady: async () => ({ accepted: true }), onClose: () => () => {},
    submit: (method, payload) => ({ response: runtime.call(method, payload).then(result => ({ ok: true, result })), cancel() {} }) }).publicClient
  assert.ok(client.config); await client.ready
  assert.deepEqual(await client.config.get(), { label: 'hello' })
  assert.equal(await client.config.set('label', 'updated'), undefined)
  assert.equal((await env.manager.getConfiguration(env.identity, env.manager.session)).values.label, 'updated')
  assert.equal(await env.manager.store.readData(env.manifest.id, 'label'), null)
})

test('old config requests without descriptors remain installed and explicitly unsupported', async t => {
  const env = await setup(t, { configuration: undefined })
  const p = (await env.manager.list())[0]
  assert.deepEqual(p.unsupportedCapabilities, configCaps)
  await env.manager.setEnabled(p.id, true, env.manager.session)
  await assert.rejects(() => env.manager.authorizeWebFeature({ pluginId: p.id, featureId: 'hello' }, env.manager.session, async () => assert.fail()), e => e.code === 'PERMISSION_DENIED')
})

test('runtime config rejects undeclared key/type and grant revocation blocks stale session', async t => {
  const env = await setup(t); const runtime = await running(env, t)
  await assert.rejects(() => runtime.call('config.set', { key: 'other', value: 'x' }), e => e.code === 'CONFIGURATION_KEY_NOT_FOUND')
  await assert.rejects(() => runtime.call('config.set', { key: 'label', value: 42 }), e => e.code === 'INVALID_REQUEST')
  await env.manager.setGrants(env.manifest.id, [], env.manager.session)
  await assert.rejects(() => runtime.call('config.set', { key: 'label', value: 'late' }))
  assert.deepEqual(await env.manager.store.configuration.get(env.manifest), { label: 'hello' })
})

test('runtime config rechecks authority immediately before atomic commit', async t => {
  const env = await setup(t); const runtime = await running(env, t)
  const original = env.manager.fs.atomicJson.bind(env.manager.fs)
  env.manager.fs.atomicJson = async (...args) => { runtime.authority.revoke(); return original(...args) }
  await assert.rejects(() => runtime.call('config.set', { key: 'label', value: 'late' }))
  assert.deepEqual(await env.manager.store.configuration.get(env.manifest), { label: 'hello' })
})

test('configuration IPC denies forged senders and revocation of Manager frame prevents commit', async t => {
  const env = await setup(t); let allowed = true; const sender = {}
  const handlers = createPluginHandlers({ getManager: () => env.manager, isManagerMainFrame: event => event === sender && allowed, choosePackage: async () => null })
  const denied = await handlers[IPC_CHANNELS.pluginConfigurationGet]({}, env.identity)
  assert.equal(denied.ok, false); assert.equal(denied.error.code, 'PERMISSION_DENIED')
  const dto = (await handlers[IPC_CHANNELS.pluginConfigurationGet](sender, env.identity)).data
  const original = env.manager.fs.atomicJson.bind(env.manager.fs)
  env.manager.fs.atomicJson = async (...args) => { allowed = false; return original(...args) }
  const result = await handlers[IPC_CHANNELS.pluginConfigurationUpdate](sender, { ...env.identity, revision: dto.revision, values: { label: 'untrusted' } })
  assert.equal(result.ok, false)
  assert.deepEqual(await env.manager.store.configuration.get(env.manifest), { label: 'hello' })
})

test('runtime cannot use another feature declaration or an unrequested config capability', async t => {
  const base = runtimeV3Manifest()
  for (const capabilities of [[], ['plugin.config.read']]) {
    const env = await setup(t, { requestedCapabilities: capabilities, features: [{ ...base.features[0], requiredCapabilities: capabilities }] })
    const runtime = await running(env, t)
    if (!capabilities.length) await assert.rejects(() => runtime.call('config.get', null), e => e.code === 'PERMISSION_DENIED')
    else assert.deepEqual(await runtime.call('config.get', null), { label: 'hello' })
    await assert.rejects(() => runtime.call('config.set', { key: 'label', value: 'blocked' }), e => e.code === 'PERMISSION_DENIED')
    assert.equal((await env.manager.store.configuration.get(env.manifest)).label, 'hello')
  }
})

test('v3 values and explicit grants survive Host reopen and old package runtime cannot write after replacement', async t => {
  const env = await setup(t); const runtime = await running(env, t)
  await runtime.call('config.set', { key: 'label', value: 'persisted' })
  await env.manager.install(runtimeV3Package({ ...env.manifest, version: '2.0.0' }), env.manager.session)
  await assert.rejects(() => runtime.call('config.set', { key: 'label', value: 'old package' }))
  await env.manager.close()
  const reopened = new PluginManager(env.deps); await reopened.initialize(); t.after(() => reopened.close())
  const p = (await reopened.list())[0]
  assert.deepEqual(p.granted, configCaps)
  assert.equal((await reopened.getConfiguration({ pluginId: p.id, version: p.version, hash: p.hash }, reopened.session)).values.label, 'persisted')
})
