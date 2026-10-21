import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { createRenderer, getCurrentInstance, h } from 'vue'
import vue from '@vitejs/plugin-vue'
import { createServer } from 'vite'
import { builtinPluginEntries } from '../../../electron/plugins/builtin-plugin-registry.ts'
import { BuiltinPluginStateStore } from '../../../electron/plugins/builtin-plugin-state.ts'
import { BuiltinTranslationLifecycle } from '../../../electron/plugins/builtin-translation-lifecycle.ts'
import { PluginCatalog } from '../../../electron/plugins/plugin-catalog.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const server = await createServer({ configFile: false, root: process.cwd(), plugins: [vue()], resolve: { alias: { '@': resolve(process.cwd(), 'src') } }, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' })
const { default: App } = await server.ssrLoadModule('/src/App.vue')
App.render = () => null // Test actual App setup/lifecycle without mounting unrelated product pages.
after(() => server.close())
const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null })
const snapshot = revision => ({ ok: true, data: { revision, entries: builtinPluginEntries('0.1.0', { status: 'ready', enabled: true, generation: 0 }), declarativeAvailability: { status: 'available' } } })
const tick = () => new Promise(resolve => setImmediate(resolve))
function mount(desktop, renderHandoffViews = false) {
  App.render = () => null
  let webRuntimeStateListener
  globalThis.window = { setTimeout, clearTimeout, desktop: {
    onNativeManagerIntent: () => () => {}, managerReady() {},
    webRuntime: { onState: listener => { webRuntimeStateListener = listener; return () => { webRuntimeStateListener = undefined } } },
    ...desktop,
  } }
  const app = renderer.createApp(App); app.provide(Symbol.for('v-scx'), { modules: new Set() })
  const vm = app.mount({})
  return { app, state: vm.$.setupState, instance: vm.$, publishWebRuntimeState: status => webRuntimeStateListener?.(status) }
}

test('late CLOSED state from a replaced Web Runtime generation cannot restore the prior Manager route', async () => {
  const env = mount({})
  try {
    await tick()
    env.publishWebRuntimeState({ state: 'CREATING', featureId: 'first', generation: 1 })
    env.publishWebRuntimeState({ state: 'LOADING', featureId: 'first', generation: 1 })
    env.publishWebRuntimeState({ state: 'CLOSING', featureId: 'first', generation: 1 })
    env.publishWebRuntimeState({ state: 'CLOSED', featureId: 'first', generation: 1 })
    env.publishWebRuntimeState({ state: 'CREATING', featureId: 'second', generation: 3 })
    env.publishWebRuntimeState({ state: 'LOADING', featureId: 'second', generation: 3 })
    env.publishWebRuntimeState({ state: 'READY', featureId: 'second', generation: 3 })
    env.publishWebRuntimeState({ state: 'CLOSED', featureId: 'first', generation: 1 })
    assert.equal(env.state.activeSection, 'web-runtime')
  } finally { env.app.unmount() }
})
test('closing a Manager-opened Web Feature returns to Plugin Center rather than its transient declarative loading route', async () => {
  const entry = { kind: 'web', id: 'org.example.web-route', icon: { kind: 'fallback' }, package: {
    id: 'org.example.web-route', name: 'Web Route', enabled: true, status: 'active', manifestVersion: 2,
    requested: [], granted: [], webFeatures: [{ id: 'hello', title: 'Hello', available: true }] } }
  let finish
  const env = mount({ pluginCatalog: { list: async () => ({ ok: true, data: { ...snapshot(1).data, entries: [entry] } }),
    open: () => new Promise(resolve => { finish = resolve }) } })
  try {
    await tick(); env.state.activeSection = 'plugins'
    const opening = env.state.openPluginPage({ kind: 'web', id: entry.id, featureId: 'hello' })
    env.publishWebRuntimeState({ state: 'CREATING', featureId: 'hello', generation: 1 })
    env.publishWebRuntimeState({ state: 'READY', featureId: 'hello', generation: 1 })
    finish({ ok: true, data: { kind: 'web', id: entry.id, featureId: 'hello' } }); await opening
    env.publishWebRuntimeState({ state: 'CLOSED', featureId: 'hello', generation: 1 })
    assert.equal(env.state.activeSection, 'plugins')
  } finally { env.app.unmount() }
})
test('late catalog refresh cannot restore obsolete entries after a newer request', async () => {
  let finishOld; let requests = 0
  const env = mount({ pluginCatalog: { list: () => ++requests === 1 ? new Promise(resolve => { finishOld = resolve }) : Promise.resolve(snapshot(2)) } })
  try {
    await env.state.refreshPlugins()
    finishOld({ ok: true, data: { ...snapshot(1).data, entries: [] } }); await tick()
    assert.equal(env.state.catalogEntries.length, 1)
    assert.equal(env.state.pluginsLoading, false)
  } finally { env.app.unmount() }
})
test('partial catalog failure retains builtin and late open cannot change a newer Native route', async () => {
  let finishOpen; let nativeIntent
  const env = mount({ onNativeManagerIntent: handler => { nativeIntent = handler; return () => {} }, acknowledgeNativeManagerIntent() {}, pluginCatalog: { list: async () => ({ ok: true, data: { ...snapshot(1).data, declarativeAvailability: { status: 'unavailable', errorCode: 'STORAGE_INVALID' } } }), open: () => new Promise(resolve => { finishOpen = resolve }) } })
  try {
    await tick(); assert.equal(env.state.catalogEntries.length, 1); assert.ok(env.state.pluginsError.includes('第三方'))
    const pending = env.state.openPluginPage({ kind: 'builtin', id: 'webtools.translation' })
    nativeIntent({ kind: 'open-page', section: 'settings', requestId: 'new-native' })
    finishOpen({ ok: true, data: { kind: 'builtin', id: 'webtools.translation', key: 'translation', generation: 0 } })
    await pending; assert.equal(env.state.activeSection, 'settings')
  } finally { env.app.unmount() }
})

test('Native declarative shortcut routes by exact composite ref after catalog refresh and acknowledges presentation', async () => {
  let nativeIntent; const acknowledged = []
  const plugin = { id: 'webtools.translation', name: 'Private Notes', version: '1.0.0', hash: 'a'.repeat(64), enabled: true, status: 'active', granted: ['manager.page'], requested: ['manager.page'], installedVersions: ['1.0.0'], source: 'local-unsigned' }
  const core = { session: 'core', isSession: s => s === 'core', list: async () => [plugin], getPages: async id => ({ pluginId: id, version: '1.0.0', hash: 'a'.repeat(64), entry: { pageId: 'home', label: 'Private Notes' }, pages: [], settings: [], actions: [] }) }
  const catalog = new PluginCatalog('0.1.0', () => core, { snapshot: () => ({ status: 'ready', enabled: true }), isEnabled: () => true })
  const env = mount({ onNativeManagerIntent: handler => { nativeIntent = handler; return () => {} }, acknowledgeNativeManagerIntent: id => acknowledged.push(id), pluginCatalog: {
    list: async () => ({ ok: true, data: await catalog.list(catalog.session) }), open: async ref => ({ ok: true, data: await catalog.open(ref, catalog.session) }),
  } })
  try {
    await tick()
    nativeIntent({ kind: 'open-plugin', requestId: 'native-plugin-1', ref: { kind: 'declarative', id: 'webtools.translation' } })
    for (let i = 0; i < 8; i++) await tick()
    assert.equal(env.state.activeSection, 'plugin-page')
    assert.deepEqual({ ...env.state.activePluginRef }, { kind: 'declarative', id: 'webtools.translation' })
    assert.equal(env.state.activePluginName, 'Private Notes')
    assert.deepEqual(acknowledged, ['native-plugin-1'])
  } finally { env.app.unmount(); catalog.close() }
})

test('Native FeatureRef opens only its current validated declarative page and returns a correlated acknowledgement', async () => {
  let nativeIntent
  const acknowledgements = []
  const plugin = { id: 'org.example.native-feature', name: 'Private Notes', version: '1.0.0', hash: 'b'.repeat(64), enabled: true, status: 'active', granted: ['manager.page'], requested: ['manager.page'], installedVersions: ['1.0.0'], source: 'local-unsigned' }
  const core = { session: 'core', isSession: s => s === 'core', list: async () => [plugin], getPages: async id => ({ pluginId: id, version: '1.0.0', hash: 'b'.repeat(64), entry: { pageId: 'home', label: 'Private Notes' }, pages: [], settings: [], actions: [] }) }
  const catalog = new PluginCatalog('0.1.0', () => core, { snapshot: () => ({ status: 'ready', enabled: true }), isEnabled: () => true })
  const opened = []
  const env = mount({
    onNativeManagerIntent: handler => { nativeIntent = handler; return () => {} },
    acknowledgeNativeManagerIntent: (id, outcome) => acknowledgements.push([id, outcome]),
    pluginCatalog: {
      list: async () => ({ ok: true, data: await catalog.list(catalog.session) }),
      open: async ref => { opened.push(ref); return { ok: true, data: await catalog.open(ref, catalog.session) } },
    },
  })
  try {
    await tick()
    nativeIntent({ kind: 'open-feature', requestId: 'native-feature-1', ref: { pluginId: plugin.id, featureId: 'legacy-manager-page' } })
    for (let i = 0; i < 10; i++) await tick()
    assert.deepEqual(opened, [{ kind: 'declarative', id: plugin.id }], 'renderer uses its safe catalog route and receives no pageId from Native')
    assert.equal(env.state.activeSection, 'plugin-page')
    assert.deepEqual(acknowledgements, [['native-feature-1', 'accepted']])
  } finally { env.app.unmount(); catalog.close() }
})

test('Native FeatureRef that becomes unavailable before renderer navigation is negatively acknowledged', async () => {
  let nativeIntent
  const acknowledgements = []
  const plugin = { id: 'org.example.revoked-feature', name: 'Revoked', version: '1.0.0', hash: 'c'.repeat(64), enabled: false, status: 'installed-disabled', granted: [], requested: ['manager.page'], installedVersions: ['1.0.0'], source: 'local-unsigned' }
  const env = mount({
    onNativeManagerIntent: handler => { nativeIntent = handler; return () => {} },
    acknowledgeNativeManagerIntent: (id, outcome) => acknowledgements.push([id, outcome]),
    pluginCatalog: {
      list: async () => ({ ok: true, data: { ...snapshot(1).data, entries: [...snapshot(1).data.entries, { kind: 'declarative', id: plugin.id, source: 'local-unsigned', package: plugin, icon: { kind: 'fallback' }, entry: { kind: 'declarative-page' }, management: { canToggle: true, canManageGrants: true, canUninstall: true, canReplacePackage: true } }] } }),
      open: async () => { throw new Error('stale feature must not open') },
    },
  })
  try {
    await tick()
    nativeIntent({ kind: 'open-feature', requestId: 'native-feature-stale', ref: { pluginId: plugin.id, featureId: 'legacy-manager-page' } })
    for (let i = 0; i < 8; i++) await tick()
    assert.deepEqual(acknowledgements, [['native-feature-stale', 'rejected']])
  } finally { env.app.unmount() }
})

 test('built-in Translation opens in a dedicated window and repeated opens never mount a Manager translation page', async () => {
 let opens = 0
 const env = mount({ pluginCatalog: { list: async () => snapshot(1), open: async () => { opens++; return { ok: true, data: { kind: 'builtin', id: 'webtools.translation', key: 'translation', generation: 0, presentation: 'window' } } } } })
 try { await tick(); for(let i=0;i<2;i++) { assert.equal(await env.state.openPluginPage({ kind: 'builtin', id: 'webtools.translation' }), true); assert.equal(env.state.activeSection, 'plugins') }; assert.equal(opens, 2) } finally { env.app.unmount() }
})
