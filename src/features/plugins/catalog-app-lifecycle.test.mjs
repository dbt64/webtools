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
const { default: BuiltinTranslationGate } = await server.ssrLoadModule('/src/features/plugins/BuiltinTranslationGate.vue')
TranslateView.render = () => null
BuiltinTranslationGate.render = () => null
App.render = () => null // Test actual App setup/lifecycle without mounting unrelated product pages.
after(() => server.close())
const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null })
const snapshot = revision => ({ ok: true, data: { revision, entries: builtinPluginEntries('0.1.0', { status: 'ready', enabled: true, generation: 0 }), declarativeAvailability: { status: 'available' } } })
const tick = () => new Promise(resolve => setImmediate(resolve))
function mount(desktop, renderHandoffViews = false) {
  App.render = renderHandoffViews ? function () {
    const state = getCurrentInstance().setupState
    if (state.activeSection === 'translation-gate' && state.translationHandoff.status === 'blocked') {
      return h(BuiltinTranslationGate, {
        handoff: state.translationHandoff,
        busy: state.handoffBusy,
        onPresented: state.handleHandoffPresented,
        onEnableAndOpen: state.enableAndOpenTranslation,
        onCancel: state.cancelTranslationHandoff,
        onManage: state.manageTranslationHandoff,
      })
    }
    if (state.activeSection === 'translate') return h(TranslateView, {
      prefill: state.translationPrefill,
      onPrefillApplied: state.handleTranslationPrefillApplied,
      onPageReady: state.handleTranslationPageReady,
    })
    return null
  } : () => null
  globalThis.window = { setTimeout, clearTimeout, desktop: {
    onNativeManagerIntent: () => () => {}, managerReady() {},
    builtinTranslationHandoff: { get: async () => ({ ok: true, data: { status: 'none', uiGeneration: 0 } }), resolve: async () => ({ ok: true, data: { status: 'none', uiGeneration: 0 } }) },
    ...desktop,
  } }
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

test('disabled Native Translation presents the gate, keeps exact text Main-owned, then applies exact prefill only after explicit enable', async () => {
  let nativeIntent
  let projection = { status: 'blocked', requestId: 'native-translation-1', generation: 1, uiGeneration: 1, reason: 'disabled', hasPrefill: true }
  const resolveCalls = []
  let providerCalls = 0
  const env = mount({
    onNativeManagerIntent: handler => { nativeIntent = handler; return () => {} },
    builtinTranslationHandoff: {
      get: async () => ({ ok: true, data: projection }),
      resolve: async request => {
        resolveCalls.push(request)
        if (request.disposition === 'enable-and-open') {
          projection = { status: 'ready', requestId: request.requestId, generation: request.generation, uiGeneration: request.uiGeneration, text: '  exact 原文\n🙂  ' }
          return { ok: true, data: projection }
        }
        if (request.disposition === 'applied' || request.disposition === 'cancel') {
          projection = { status: 'none', uiGeneration: request.uiGeneration }
          return { ok: true, data: projection }
        }
        return { ok: true, data: projection }
      },
    },
    getSettings: async () => ({ translation: { sourceLanguage: 'auto', targetLanguage: 'zh-CN' } }),
    getTranslationProviderInfo: async () => ({ ok: true, data: { engine: 'ai', configured: false } }),
    translate: async () => { providerCalls += 1; return { ok: true, data: { translation: '', provider: { engine: 'ai', configured: false } } } },
  }, true)
  try {
    await tick()
    nativeIntent({ kind: 'translation-handoff', requestId: 'native-translation-1' })
    await tick(); await tick()
    assert.equal(env.state.activeSection, 'translation-gate')
    assert.equal(env.state.translationPrefill, null, 'raw text is not sent by the Native event or shown before enable')
    assert.equal(resolveCalls[0].disposition, 'gate-presented', 'Native transport is acknowledged as soon as the gate mounts')
    assert.equal(resolveCalls[0].requestId, 'native-translation-1')

    const blocked = env.state.translationHandoff
    env.state.enableAndOpenTranslation(blocked)
    await tick(); await tick()
    assert.equal(env.state.activeSection, 'translate')
    const translationState = env.instance.subTree.component.setupState
    await tick(); await tick()
    assert.equal(translationState.sourceText, '  exact 原文\n🙂  ')
    assert.ok(resolveCalls.some(call => call.disposition === 'applied'))
    assert.equal(env.state.translationHandoff.status, 'none')
    assert.equal(providerCalls, 0, 'unconfigured fake provider is never called automatically')
  } finally { env.app.unmount() }
})

test('pending handoff survives local navigation for resume or discard', async () => {
  let nativeIntent
  let projection = { status: 'blocked', requestId: 'native-translation-2', generation: 1, uiGeneration: 1, reason: 'unavailable', errorCode: 'STATE_INVALID', hasPrefill: false }
  const env = mount({
    onNativeManagerIntent: handler => { nativeIntent = handler; return () => {} },
    builtinTranslationHandoff: {
      get: async () => ({ ok: true, data: projection }),
      resolve: async request => {
        if (request.disposition === 'cancel') projection = { status: 'none', uiGeneration: request.uiGeneration }
        return { ok: true, data: projection }
      },
    },
  }, true)
  try {
    await tick()
    nativeIntent({ kind: 'translation-handoff', requestId: 'native-translation-2' })
    await tick(); await tick()
    assert.equal(env.state.activeSection, 'translation-gate')
    env.state.manageTranslationHandoff()
    assert.equal(env.state.activeSection, 'plugins')
    assert.equal(env.state.translationHandoff.status, 'blocked')
    projection = { status: 'ready', requestId: 'native-translation-2', generation: 1, uiGeneration: 1, text: null }
    await env.state.refreshTranslationHandoff(false)
    assert.equal(env.state.activeSection, 'plugins', 'enabling/recovery in the center does not override the user route')
    assert.equal(env.state.translationHandoff.status, 'ready')
    env.state.resumeTranslationHandoff()
    await tick(); await tick()
    assert.equal(env.state.activeSection, 'translate')
    const ready = env.state.translationHandoff
    env.state.cancelTranslationHandoff(ready)
    await tick(); await tick()
    assert.equal(env.state.translationHandoff.status, 'none')
  } finally { env.app.unmount() }
})
