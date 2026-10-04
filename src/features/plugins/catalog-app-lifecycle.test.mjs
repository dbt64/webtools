import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { createRenderer, getCurrentInstance, h } from 'vue'
import vue from '@vitejs/plugin-vue'
import { createServer } from 'vite'
import { builtinPluginEntries } from '../../../electron/plugins/builtin-plugin-registry.ts'

const server = await createServer({ configFile: false, root: process.cwd(), plugins: [vue()], resolve: { alias: { '@': resolve(process.cwd(), 'src') } }, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' })
const { default: App } = await server.ssrLoadModule('/src/App.vue')
const { default: TranslateView } = await server.ssrLoadModule('/src/features/translate/TranslateView.vue')
TranslateView.render = () => null
App.render = () => null // Test actual App setup/lifecycle without mounting unrelated product pages.
after(() => server.close())
const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null })
const snapshot = revision => ({ ok: true, data: { revision, entries: builtinPluginEntries('0.1.0'), declarativeAvailability: { status: 'available' } } })
const tick = () => new Promise(resolve => setImmediate(resolve))
function mount(desktop, withTranslation = false) {
  App.render = withTranslation ? function () { return getCurrentInstance().setupState.activeSection === 'translate' ? h(TranslateView, { prefill: null }) : null } : () => null
  globalThis.window = { setTimeout, clearTimeout, desktop: { onNativeManagerIntent: () => () => {}, managerReady() {}, ...desktop } }
  const app = renderer.createApp(App); app.provide(Symbol.for('v-scx'), { modules: new Set() })
  const vm = app.mount({})
  return { app, state: vm.$.setupState, instance: vm.$ }
}
test('reopening active Translation does not leave its section or invoke another page load', async () => {
  let opens = 0; let cancellations = 0; let finishTranslation
  const env = mount({
    getSettings: async () => ({ translation: { sourceLanguage: 'auto', targetLanguage: 'zh-CN' } }),
    getTranslationProviderInfo: async () => ({ ok: true, data: { engine: 'ai', configured: false } }),
    translate: () => new Promise(resolve => { finishTranslation = resolve }),
    cancelTranslation: async () => { cancellations += 1; return { ok: true } },
    pluginCatalog: { list: async () => snapshot(1), open: async () => { opens += 1; return { ok: true, data: { kind: 'builtin', id: 'webtools.translation', key: 'translation', generation: 0 } } } },
  }, true)
  try {
    await tick(); env.state.activeSection = 'translate'; await tick()
    const translationInstance = env.instance.subTree.component
    const translationState = translationInstance.setupState
    translationState.sourceText = 'original exact text'
    translationState.translation = 'existing result'
    const pending = env.state.openPluginPage({ kind: 'builtin', id: 'webtools.translation' })
    assert.equal(env.state.activeSection, 'translate', 'TranslateView must remain mounted while its own nav is clicked')
    await pending; await tick(); assert.equal(opens, 0)
    assert.equal(env.instance.subTree.component, translationInstance)
    assert.equal(translationState.sourceText, 'original exact text')
    assert.equal(translationState.translation, 'existing result')
    const request = translationState.translate()
    await env.state.openPluginPage({ kind: 'builtin', id: 'webtools.translation' }); await tick()
    assert.equal(cancellations, 0)
    assert.equal(translationState.loading, true)
    finishTranslation({ ok: true, data: { translation: 'new answer', provider: { engine: 'ai', configured: false } } })
    await request; assert.equal(translationState.translation, 'new answer')
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
