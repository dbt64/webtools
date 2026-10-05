import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { createRenderer, getCurrentInstance, h } from 'vue'
import vue from '@vitejs/plugin-vue'
import { createServer } from 'vite'
import { builtinPluginEntries } from '../../../electron/plugins/builtin-plugin-registry.ts'
import { BuiltinPluginStateStore } from '../../../electron/plugins/builtin-plugin-state.ts'
import { BuiltinTranslationLifecycle } from '../../../electron/plugins/builtin-translation-lifecycle.ts'
import { BuiltinTranslationHandoff } from '../../../electron/services/builtin-translation-handoff.ts'
import { PluginCatalog } from '../../../electron/plugins/plugin-catalog.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
  let revision = 0
  const env = mount({
    pluginCatalog: { list: async () => ({ ok: true, data: { ...snapshot(++revision).data, entries: builtinPluginEntries('0.1.0', projection.status === 'ready' ? { status: 'ready', enabled: true } : { status: 'disabled', enabled: false }) } }) },
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

test('Enable & Open refreshes real persisted builtin state, catalog and navigation and survives Manager restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webtools-enable-gate-'))
  const lifecycle = new BuiltinTranslationLifecycle(new BuiltinPluginStateStore(root), () => {})
  await lifecycle.initialize(); await lifecycle.setEnabled(false)
  const catalog = new PluginCatalog('0.1.0', () => null, lifecycle)
  const handoff = new BuiltinTranslationHandoff(lifecycle)
  readyRenderer()
  function readyRenderer() { handoff.rendererStarting(); handoff.rendererReady() }
  let nativeIntent
  const env = mount({
    onNativeManagerIntent: handler => { nativeIntent = handler; return () => {} },
    pluginCatalog: { list: async () => ({ ok: true, data: await catalog.list(catalog.session) }) },
    builtinTranslationHandoff: {
      get: async () => ({ ok: true, data: handoff.getProjection() }),
      resolve: async request => ({ ok: true, data: await handoff.resolve(request) }),
    },
  })
  const flush = async () => { for (let i = 0; i < 8; i++) await tick() }
  const settled = async () => {
    const deadline = Date.now() + 3000
    while (env.state.handoffBusy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(env.state.handoffBusy, false, 'handoff operation must finish')
    await flush()
  }
  try {
    await flush()
    const cancelled = handoff.begin({ requestId: 'cancel-real', text: 'cancel me' })
    nativeIntent({ kind: 'translation-handoff', requestId: 'cancel-real' }); await flush()
    env.state.handleHandoffPresented(env.state.translationHandoff); await flush(); await cancelled
    env.state.cancelTranslationHandoff(env.state.translationHandoff); await settled()
    assert.equal(lifecycle.isEnabled(), false)
    assert.equal(env.state.pluginNavItems.length, 0)

    const text = "  Hello-WebTools 中文 日本語 🚀! don't\n  "
    const presented = handoff.begin({ requestId: 'enable-real', text })
    nativeIntent({ kind: 'translation-handoff', requestId: 'enable-real' }); await flush()
    env.state.handleHandoffPresented(env.state.translationHandoff); await flush(); await presented
    env.state.enableAndOpenTranslation(env.state.translationHandoff); await settled()
    assert.equal(lifecycle.isEnabled(), true)
    assert.equal(env.state.activeSection, 'translate')
    assert.equal(env.state.translationPrefill.text, text)
    assert.equal(env.state.catalogEntries[0].state.enabled, true, 'Plugin Center must receive the new authority projection')
    assert.equal(env.state.pluginNavItems[0].ref.id, 'webtools.translation', 'enabled builtin must be in navigation')

    const restarted = new BuiltinTranslationLifecycle(new BuiltinPluginStateStore(root), () => {})
    await restarted.initialize()
    assert.equal(restarted.isEnabled(), true, 'new Manager lifecycle reads persisted enable choice')
    const next = new BuiltinTranslationHandoff(restarted)
    const accepted = next.begin({ requestId: 'next-real', text: 'second' })
    next.rendererStarting(); next.rendererReady()
    const ready = next.getProjection()
    assert.equal(ready.status, 'ready', 'next handoff must bypass the disabled gate')
    await next.resolve({ ...ready, disposition: 'applied' }); await accepted; next.close()
  } finally { env.app.unmount(); handoff.close(); lifecycle.close(); catalog.close(); await rm(root, { recursive: true, force: true }) }
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
