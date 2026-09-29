import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { resolve } from 'node:path'
import { createRenderer } from 'vue'
import vue from '@vitejs/plugin-vue'
import { createServer } from 'vite'

const ssrContextKey = Symbol.for('v-scx')

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  plugins: [vue()],
  resolve: { alias: { '@': resolve(process.cwd(), 'src') } },
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true },
  appType: 'custom',
})
const { default: TranslateView } = await server.ssrLoadModule('/src/features/translate/TranslateView.vue')
TranslateView.render = () => null
after(() => server.close())

function createHostNode(type, text = '') {
  return { type, text, props: {}, children: [], parent: null }
}

const renderer = createRenderer({
  createElement: (type) => createHostNode(type),
  createText: (text) => createHostNode('#text', text),
  createComment: (text) => createHostNode('#comment', text),
  setText: (node, text) => { node.text = text },
  setElementText: (node, text) => { node.text = text; node.children = [] },
  patchProp: (node, key, _previous, next) => { node.props[key] = next },
  insert(node, parent, anchor = null) {
    if (node.parent) {
      const oldIndex = node.parent.children.indexOf(node)
      if (oldIndex >= 0) node.parent.children.splice(oldIndex, 1)
    }
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(node)
    else parent.children.splice(index, 0, node)
    node.parent = parent
  },
  remove(node) {
    if (!node.parent) return
    const index = node.parent.children.indexOf(node)
    if (index >= 0) node.parent.children.splice(index, 1)
    node.parent = null
  },
  parentNode: (node) => node.parent,
  nextSibling(node) {
    if (!node.parent) return null
    return node.parent.children[node.parent.children.indexOf(node) + 1] ?? null
  },
})

function deferred() {
  let resolvePromise
  let rejectPromise
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

function createWindowDesktop({ getSettings, getTranslationProviderInfo, translate }) {
  const timers = new Map()
  let nextTimerId = 0
  globalThis.window = {
    setTimeout(callback, delay) {
      const id = ++nextTimerId
      timers.set(id, { callback, delay })
      return id
    },
    clearTimeout(id) { timers.delete(id) },
    desktop: {
      getSettings,
      getTranslationProviderInfo,
      translate,
      cancelTranslation: async () => ({ ok: true }),
    },
  }
  return {
    timers,
    flushTimers() {
      const pending = [...timers.values()]
      timers.clear()
      pending.forEach(({ callback }) => callback())
      return pending.map(({ delay }) => delay)
    },
  }
}

function mountTranslateView() {
  const root = createHostNode('root')
  const app = renderer.createApp(TranslateView, {
    prefill: { id: 'prefill-1', text: 'hello world' },
  })
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount(root)
  return { app, root }
}

function translationSettings() {
  return { translation: { sourceLanguage: 'auto', targetLanguage: 'zh-CN' } }
}

function providerInfo() {
  return { ok: true, data: { engine: 'mymemory', configured: true, providerName: 'MyMemory' } }
}

test('unmounting while translation initialization is pending prevents late scheduling and requests', async () => {
  const settings = deferred()
  const provider = deferred()
  let translationRequests = 0
  const desktop = createWindowDesktop({
    getSettings: () => settings.promise,
    getTranslationProviderInfo: () => provider.promise,
    translate: async () => { translationRequests += 1; return { ok: true, data: { translation: '你好', provider: providerInfo().data } } },
  })
  const { app } = mountTranslateView()

  app.unmount()
  settings.resolve(translationSettings())
  provider.resolve(providerInfo())
  await new Promise((resolve) => setImmediate(resolve))
  desktop.flushTimers()
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(desktop.timers.size, 0, 'unmounted initialization must not schedule auto-translation')
  assert.equal(translationRequests, 0, 'unmounted initialization must not issue a translation request')
})

test('a mounted translation page keeps the 450 ms auto-translation behavior', async () => {
  let translationRequests = 0
  const desktop = createWindowDesktop({
    getSettings: async () => translationSettings(),
    getTranslationProviderInfo: async () => providerInfo(),
    translate: async () => {
      translationRequests += 1
      return { ok: true, data: { translation: '你好', provider: providerInfo().data } }
    },
  })
  const { app } = mountTranslateView()
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual([...desktop.timers.values()].map(({ delay }) => delay), [450])
  desktop.flushTimers()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(translationRequests, 1)
  app.unmount()
})
