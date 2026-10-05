import test from 'node:test'
import assert from 'node:assert/strict'
import { createPluginCatalogHandlers, registerPluginCatalogIpcHandlers } from './plugin-catalog-handlers.ts'
import { PluginCatalog } from '../plugins/plugin-catalog.ts'
import { IPC_CHANNELS } from '../../src/shared/ipc.ts'

function createBuiltinPort(initial = { status: 'ready', enabled: true, generation: 0 }) {
  let state = structuredClone(initial)
  return {
    snapshot: () => structuredClone(state),
    isEnabled: () => state.status === 'ready' && state.enabled,
    setEnabled: async (enabled, mayCommit) => {
      if (state.status === 'unavailable') throw Object.assign(new Error(), { code: 'STATE_UNAVAILABLE' })
      if (!mayCommit()) throw Object.assign(new Error(), { code: 'SESSION_EXPIRED' })
      state = enabled ? { status: 'ready', enabled: true, generation: state.generation + 1 } : { status: 'disabled', enabled: false, generation: state.generation + 1 }
      return structuredClone(state)
    },
    recoverToDefault: async (confirmed, mayCommit) => {
      if (!confirmed || !mayCommit()) throw Object.assign(new Error(), { code: 'SESSION_EXPIRED' })
      state = { status: 'ready', enabled: true, generation: state.generation + 1 }
      return structuredClone(state)
    },
  }
}

function createCatalog(state) { return new PluginCatalog('0.1.0', () => null, createBuiltinPort(state)) }
function dependencies(catalog, overrides = {}) {
  return { getCatalog: () => catalog, isManagerMainFrame: () => true, confirmBuiltinStateRecovery: async () => true, ...overrides }
}

test('builtin toggles publish authoritative enabled Launcher projection and reject untrusted requests before publication', async () => {
  const catalog = createCatalog(); const sent = []; let allowed = true
  const handlers = createPluginCatalogHandlers(dependencies(catalog, { isManagerMainFrame: () => allowed, onCatalogChanged: async () => sent.push(await catalog.launcherProjection(catalog.session)) }))
  const ref = { kind: 'builtin', id: 'webtools.translation' }
  assert.equal((await handlers[IPC_CHANNELS.pluginCatalogSetEnabled]({}, ref, false)).ok, true)
  assert.deepEqual(sent[0].plugins, [])
  assert.equal((await handlers[IPC_CHANNELS.pluginCatalogSetEnabled]({}, ref, true)).ok, true)
  assert.deepEqual(sent[1].plugins[0].ref, ref)
  allowed = false; await handlers[IPC_CHANNELS.pluginCatalogSetEnabled]({}, ref, false)
  assert.equal(sent.length, 2)
})

test('catalog IPC rejects sender, arity, unknown kind, forged builtin, extra paths and bare IDs', async () => {
  let allowed = true
  const catalog = createCatalog()
  const handlers = createPluginCatalogHandlers(dependencies(catalog, { isManagerMainFrame: () => allowed }))
  allowed = false
  for (const handler of Object.values(handlers)) assert.equal((await handler({})).error.code, 'PERMISSION_DENIED')
  allowed = true
  assert.equal((await handlers[IPC_CHANNELS.pluginCatalogList]({}, 'extra')).ok, false)
  for (const ref of ['webtools.translation', {}, { kind: 'unknown', id: 'webtools.translation' }, { kind: 'builtin', id: 'org.example.other' }, { kind: 'builtin', id: 'webtools.translation', path: 'C:/private' }, { kind: 'declarative', id: '../bad' }]) assert.equal((await handlers[IPC_CHANNELS.pluginCatalogOpen]({}, ref)).ok, false)
  assert.equal((await handlers[IPC_CHANNELS.pluginCatalogOpen]({}, { kind: 'builtin', id: 'webtools.translation' })).ok, true)
  assert.equal((await handlers[IPC_CHANNELS.pluginCatalogSetEnabled]({}, { kind: 'builtin', id: 'webtools.translation' }, false)).data.state.status, 'disabled')
  assert.equal((await handlers[IPC_CHANNELS.pluginCatalogSetEnabled]({}, { kind: 'declarative', id: 'org.example.demo' }, 'true')).ok, false)
})

test('state recovery requires the Main confirmation and does not accept renderer-supplied confirmation', async () => {
  const catalog = createCatalog({ status: 'unavailable', enabled: false, errorCode: 'STATE_INVALID', generation: 0 })
  let confirmations = 0
  const handlers = createPluginCatalogHandlers(dependencies(catalog, { confirmBuiltinStateRecovery: async () => { confirmations += 1; return false } }))

  assert.equal((await handlers[IPC_CHANNELS.pluginCatalogRecoverBuiltin]({})).data.recovered, false)
  assert.equal((await handlers[IPC_CHANNELS.pluginCatalogRecoverBuiltin]({}, true)).ok, false)
  assert.equal(confirmations, 1)
  const confirmed = createPluginCatalogHandlers(dependencies(catalog, { confirmBuiltinStateRecovery: async () => true }))
  const result = await confirmed[IPC_CHANNELS.pluginCatalogRecoverBuiltin]({})
  assert.equal(result.data.recovered, true)
  assert.equal(result.data.entry.state.status, 'ready')
})

test('catalog IPC rechecks current sender and registration disposes every handler', async () => {
  let allowed = true
  const catalog = createCatalog()
  const handlers = createPluginCatalogHandlers(dependencies(catalog, { isManagerMainFrame: () => allowed }))
  const original = catalog.list.bind(catalog)
  catalog.list = async session => { const value = await original(session); allowed = false; return value }
  assert.equal((await handlers[IPC_CHANNELS.pluginCatalogList]({})).error.code, 'SESSION_EXPIRED')
  const registered = []; const removed = []
  const dispose = registerPluginCatalogIpcHandlers({ handle: channel => registered.push(channel), removeHandler: channel => removed.push(channel) }, dependencies(catalog))
  dispose(); assert.deepEqual(registered, removed); assert.equal(registered.length, 4)
})
