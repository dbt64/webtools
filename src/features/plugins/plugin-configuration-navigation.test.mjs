import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { createRenderer, getCurrentInstance, h } from 'vue'
import vue from '@vitejs/plugin-vue'
import { createServer } from 'vite'

// Mount actual App / Plugin Center / editor setup through an in-memory renderer.
// Product navigation handlers and the draft model run; no real Manager or profile is opened.
const server = await createServer({ configFile: false, root: process.cwd(), plugins: [vue()], resolve: { alias: { '@': resolve(process.cwd(), 'src') } }, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom' })
after(() => server.close())
const { default: App } = await server.ssrLoadModule('/src/App.vue')
const { default: Center } = await server.ssrLoadModule('/src/features/plugins/PluginManagerView.vue')
const { default: Editor } = await server.ssrLoadModule('/src/features/plugins/PluginConfigurationEditor.vue')
const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null })
const tick = () => new Promise(done => setImmediate(done))
const identity = id => ({ pluginId: id, version: '1.0.0', hash: 'a'.repeat(64) })
const dto = id => ({ identity: identity(id), status: 'ready', schemaVersion: 1, revision: 'missing', settings: [{ key: 'count', label: 'Count', type: 'number', min: 1, max: 10, default: 2 }], values: { count: 2 } })
const entry = id => ({ kind: 'web', id, source: 'local-unsigned', icon: { kind: 'fallback' }, entry: { kind: 'web-features' }, management: { canToggle: true, canManageGrants: true, canUninstall: true, canReplacePackage: true }, package: {
  id, manifestVersion: 3, name: id, version: '1.0.0', hash: 'a'.repeat(64), enabled: false, status: 'installed-disabled', requested: [], granted: [], installedVersions: ['1.0.0'], source: 'local-unsigned', webFeatures: [],
} })

async function mount(t, updateConfiguration = async request => ({ ok: true, data: { ...dto(request.pluginId), values: request.values } }), getConfiguration = async request => ({ ok: true, data: dto(request.pluginId) })) {
  let model, accept = false, confirmations = 0, nativeListener
  globalThis.document = { addEventListener() {}, removeEventListener() {} }
  globalThis.window = { addEventListener() {}, removeEventListener() {}, confirm() { confirmations++; return accept }, desktop: {
    onNativeManagerIntent(listener) { nativeListener = listener; return () => {} }, managerReady() {}, acknowledgeNativeManagerIntent() {},
    webRuntime: { onState: () => () => {} },
    pluginCatalog: { list: async () => ({ ok: true, data: { revision: 1, entries: [entry('first'), entry('second')], declarativeAvailability: { status: 'available' } } }) },
    plugins: { getConfiguration, updateConfiguration },
  } }
  Editor.render = () => { model = getCurrentInstance().setupState.model; return null }
  Center.render = () => {
    const state = getCurrentInstance().setupState
    const pkg = state.selectedPackage
    return pkg ? h(Editor, { identity: identity(pkg.id), ref: value => { state.configurationEditor = value }, onBusy: value => { state.configurationBusy = value }, onDirty: value => { state.configurationDirty = value } }) : null
  }
  App.render = () => {
    const state = getCurrentInstance().setupState
    return state.activeSection === 'plugins' ? h(Center, { ref: value => { state.pluginManagerView = value }, entries: state.catalogEntries, selection: state.pluginCenterSelection, loading: state.pluginsLoading, onSelectPlugin: value => { state.pluginCenterSelection = value } }) : null
  }
  const app = renderer.createApp(App); app.provide(Symbol.for('v-scx'), { modules: new Set() })
  const vm = app.mount({}); t.after(() => app.unmount())
  const state = vm.$.setupState
  await tick(); state.selectPluginDetail({ kind: 'web', id: 'first' }); await tick()
  return { state, get model() { return model }, get confirmations() { return confirmations }, accept(value) { accept = value }, publishIntent(intent) { nativeListener(intent) } }
}

test('real sidebar selection preserves unsaved configuration until discard is confirmed', async t => {
  const env = await mount(t)
  env.model.draft.count = 7
  env.state.selectPluginDetail({ kind: 'web', id: 'second' }); await tick()
  assert.equal(env.state.pluginCenterSelection.id, 'first')
  assert.equal(env.model.draft.count, 7)
  assert.equal(env.confirmations, 1)
  env.accept(true); env.state.selectPluginDetail({ kind: 'web', id: 'second' }); await tick()
  assert.equal(env.state.pluginCenterSelection.id, 'second')
  assert.equal(env.model.state.identity.pluginId, 'second')
})

test('Settings, Websites and overview navigation cannot silently discard a plugin draft', async t => {
  const env = await mount(t); env.model.draft.count = 8
  for (const navigate of [() => env.state.showSettings(), () => env.state.navigateSection('favorites'), () => env.state.showPluginCenter()]) {
    navigate(); await tick()
    assert.equal(env.state.activeSection, 'plugins'); assert.equal(env.state.pluginCenterSelection.id, 'first'); assert.equal(env.model.draft.count, 8)
  }
  env.accept(true); env.state.showSettings(); await tick()
  assert.equal(env.state.activeSection, 'settings')
})

test('configuration write in flight blocks actual sidebar and section navigation', async t => {
  let finish
  const env = await mount(t, request => new Promise(done => { finish = () => done({ ok: true, data: { ...dto('first'), values: request.values } }) }))
  env.model.draft.count = 5
  const saving = env.model.save()
  env.accept(true); env.state.selectPluginDetail({ kind: 'web', id: 'second' }); env.state.showSettings(); await tick()
  assert.equal(env.state.activeSection, 'plugins'); assert.equal(env.state.pluginCenterSelection.id, 'first'); assert.equal(env.confirmations, 0)
  finish(); await saving; env.state.showSettings(); await tick()
  assert.equal(env.state.activeSection, 'settings')
})

test('pending configuration read does not disable plugin management or trap navigation', async t => {
  const env = await mount(t, undefined, () => new Promise(() => {}))
  const managerView = env.state.pluginManagerView
  assert.equal(env.model.loading, true)
  assert.equal(managerView.$.setupState.operationsDisabled, false, 'a read-only settings request must not disable uninstall')
  env.state.selectPluginDetail({ kind: 'web', id: 'second' })
  await tick()
  assert.equal(env.state.pluginCenterSelection.id, 'second', 'a pending read must not trap the user on the current plugin')
})

test('Native Manager navigation requests respect the current configuration draft', async t => {
  const env = await mount(t); env.model.draft.count = 4
  env.publishIntent({ kind: 'open-page', section: 'settings', requestId: 'test-request' }); await tick()
  assert.equal(env.state.activeSection, 'plugins'); assert.equal(env.model.draft.count, 4)
})
