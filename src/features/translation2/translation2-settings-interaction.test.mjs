import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { createRenderer } from 'vue'
import vue from '@vitejs/plugin-vue'
import { createServer } from 'vite'
import { createDefaultTranslation2WorkspaceSettings, TRANSLATION2_WEBSITE_PROVIDERS } from '../../shared/translation2-contracts.ts'

const server = await createServer({ configFile: false, plugins: [vue()], resolve: { alias: { '@': resolve('src') } }, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom' })
after(() => server.close())
const { default: View } = await server.ssrLoadModule('/src/features/translation2/TranslationApp.vue')
View.render = () => null
const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null })

test('mounted settings can hide, show, reorder websites and select AI with cloneable IPC payloads', async t => {
  const previousWindow = globalThis.window, previousObserver = globalThis.ResizeObserver
  let persisted = createDefaultTranslation2WorkspaceSettings()
  const writes = []
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  globalThis.window = { setTimeout, clearTimeout, translation2: {
    onOpened: () => () => {}, cancel: async () => ({ ok: true }),
    updateSettings: async value => { persisted = structuredClone(value); writes.push(persisted); return { ok: true, data: persisted } },
  } }
  const app = renderer.createApp(View, { initialBootstrap: { open: { generation: 1, sourceText: 'Hello' }, settings: persisted, websites: TRANSLATION2_WEBSITE_PROVIDERS, aiProviders: [], machineConfigured: {}, languageDefaults: { sourceLanguage: 'auto', targetLanguage: 'zh-CN' } } })
  app.provide(Symbol.for('v-scx'), { modules: new Set() })
  const vm = app.mount({}), state = vm.$.setupState
  t.after(() => { app.unmount(); globalThis.window = previousWindow; globalThis.ResizeObserver = previousObserver })
  await state.toggleWebsite('google', false)
  assert.deepEqual(persisted.visibleWebsiteIds, [])
  await state.toggleWebsite('google', true)
  await state.reorderWebsite('google', persisted.websiteOrder[2], true, false)
  assert.equal(persisted.websiteOrder.indexOf('google'), 2)
  await state.selectService('ai:deepseek')
  assert.deepEqual(persisted.selectedService, { kind: 'ai', providerId: 'deepseek' })
  assert.equal(writes.length, 4)
  await Promise.all([state.toggleWebsite('youdao', true), state.toggleWebsite('microsoft', true)])
  assert.equal(persisted.visibleWebsiteIds.includes('youdao'), true)
  assert.equal(persisted.visibleWebsiteIds.includes('microsoft'), true)
  assert.deepEqual(state.orderedWebsites.map(p => p.id), persisted.websiteOrder)
})

test('Translation pin, minimize and close controls call only their narrow Host APIs', async t => {
  const previousWindow = globalThis.window, previousObserver = globalThis.ResizeObserver
  const calls = []
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  globalThis.window = { setTimeout, clearTimeout, translation2: {
    onOpened: () => () => {},
    setPinned: async value => { calls.push(['pin', value]); return { ok: true, data: { pinned: value } } },
    minimize: async () => { calls.push(['minimize']); return { ok: true } },
    close: async () => { calls.push(['close']); return { ok: true } },
  } }
  const app = renderer.createApp(View, { initialBootstrap: { pinned: false, open: { generation: 1, sourceText: null },
    settings: createDefaultTranslation2WorkspaceSettings(), websites: TRANSLATION2_WEBSITE_PROVIDERS, aiProviders: [], machineConfigured: {},
    languageDefaults: { sourceLanguage: 'auto', targetLanguage: 'zh-CN' } } })
  app.provide(Symbol.for('v-scx'), { modules: new Set() })
  const state = app.mount({}).$.setupState
  t.after(() => { app.unmount(); globalThis.window = previousWindow; globalThis.ResizeObserver = previousObserver })
  await state.togglePinned(); assert.equal(state.pinned, true)
  await state.minimizeWindow(); state.closeWindow()
  assert.deepEqual(calls, [['pin', true], ['minimize'], ['close']])
})
