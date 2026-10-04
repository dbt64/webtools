import test from 'node:test'
import assert from 'node:assert/strict'
import { createPluginCatalogHandlers, registerPluginCatalogIpcHandlers } from './plugin-catalog-handlers.ts'
import { PluginCatalog } from '../plugins/plugin-catalog.ts'
import { IPC_CHANNELS } from '../../src/shared/ipc.ts'

test('catalog IPC rejects sender, arity, unknown kind, forged builtin, extra paths and bare IDs', async () => {
  let allowed = true
  const catalog = new PluginCatalog('0.1.0', () => null)
  const deps = { getCatalog: () => catalog, isManagerMainFrame: () => allowed }
  const handlers = createPluginCatalogHandlers(deps)
  allowed = false
  for (const handler of Object.values(handlers)) assert.equal((await handler({})).error.code, 'PERMISSION_DENIED')
  allowed = true
  assert.equal((await handlers[IPC_CHANNELS.pluginCatalogList]({}, 'extra')).ok, false)
  for (const ref of ['webtools.translation', {}, { kind: 'unknown', id: 'webtools.translation' }, { kind: 'builtin', id: 'org.example.other' }, { kind: 'builtin', id: 'webtools.translation', path: 'C:/private' }, { kind: 'declarative', id: '../bad' }]) assert.equal((await handlers[IPC_CHANNELS.pluginCatalogOpen]({}, ref)).ok, false)
  assert.equal((await handlers[IPC_CHANNELS.pluginCatalogOpen]({}, { kind: 'builtin', id: 'webtools.translation' })).ok, true)
  assert.equal((await handlers[IPC_CHANNELS.pluginCatalogSetEnabled]({}, { kind: 'builtin', id: 'webtools.translation' }, false)).error.code, 'PERMISSION_DENIED')
  assert.equal((await handlers[IPC_CHANNELS.pluginCatalogSetEnabled]({}, { kind: 'declarative', id: 'org.example.demo' }, 'true')).ok, false)
})
test('catalog IPC rechecks current sender and registration disposes every handler', async () => {
  let allowed = true
  const catalog = new PluginCatalog('0.1.0', () => null)
  const handlers = createPluginCatalogHandlers({ getCatalog: () => catalog, isManagerMainFrame: () => allowed })
  const original = catalog.list.bind(catalog)
  catalog.list = async session => { const value = await original(session); allowed = false; return value }
  assert.equal((await handlers[IPC_CHANNELS.pluginCatalogList]({})).error.code, 'SESSION_EXPIRED')
  const registered = []; const removed = []
  const dispose = registerPluginCatalogIpcHandlers({ handle: channel => registered.push(channel), removeHandler: channel => removed.push(channel) }, { getCatalog: () => catalog, isManagerMainFrame: () => true })
  dispose(); assert.deepEqual(registered, removed); assert.equal(registered.length, 3)
})
