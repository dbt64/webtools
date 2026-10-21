import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
import { isAbsolute, join } from 'node:path'
import { WebPluginBridge } from './web-plugin-bridge.ts'
import { PLUGIN_BRIDGE_CLIENT_ROUTE, PLUGIN_BRIDGE_HOST_ROUTE, PLUGIN_RUNTIME_PRELOAD_ERROR_ROUTE } from './web-plugin-bridge-routes.ts'
import { runtimeV3Manifest, runtimeV3Package } from './fixtures.mjs'
import { isValidatedPluginRuntimeSnapshot, validatePackageV3ForRuntime } from './package-validator.ts'
import { isWebFeatureAuthority } from './web-feature-authority.ts'
import { WebHostCapabilities } from './web-host-capabilities.ts'
import { buildRuntimeCsp, buildRuntimeResourceUrl, createRuntimeOrigin, parseRuntimePackageUrl, selectValidatedWebFeature } from './web-runtime-policy.ts'
import { resolvePluginWindowTheme } from './plugin-window-theme.ts'

const source = stripTypeScriptTypes(
  (await readFile(new URL('./web-plugin-runtime.ts', import.meta.url), 'utf8'))
    .replace(/^import .*\r?\n/gm, '').replace('export class WebPluginRuntime', 'class WebPluginRuntime'),
  { mode: 'transform' },
)

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
async function runtimeSnapshot(value = runtimeV3Manifest()) {
  return (await validatePackageV3ForRuntime(runtimeV3Package(value), '0.1.0')).snapshot
}

function harness(preloadHello = true, autoFinish = true, runtimeOptions = undefined, capabilityDependencies = undefined, resolveNodePreload = undefined, frameUrlMode = 'normal', theme = undefined, handleEscape = undefined) {
  const ipcMain = new EventEmitter()
  const views = []
  const partitions = []
  let clearStorageCalls = 0
  const currentSession = Object.assign(new EventEmitter(), {
    setPermissionRequestHandler() {}, setPermissionCheckHandler() {},
    webRequest: { onBeforeRequest() {} }, protocol: { handle() {} }, cookies: { async get() { return [] } },
    async setProxy() {}, async closeAllConnections() {}, async clearStorageData() { clearStorageCalls++ }, async clearCache() {},
  })
  const sessionOwners = new Map()
  let sessionCleanup = Promise.resolve()
  let sessionCreated = false
  const pluginRuntimeSession = {
    async get() {
      await sessionCleanup
      if (!sessionCreated) {
        currentSession.partition = 'persist:webtools-web-plugin-runtime'
        partitions.push(currentSession.partition)
        sessionCreated = true
      }
      return currentSession
    },
    async attach(owner) {
      await sessionCleanup
      if (!owner.current()) throw new Error('Runtime was revoked before Session attachment.')
      sessionOwners.set(owner.contents.id, owner)
      return async () => {
        if (sessionOwners.get(owner.contents.id) !== owner) return
        sessionOwners.delete(owner.contents.id)
        if (!sessionOwners.size) {
          sessionCleanup = Promise.resolve(currentSession.closeAllConnections())
          await sessionCleanup
        }
      }
    },
    async clearPluginData() { await this.get(); await currentSession.clearStorageData() },
  }
  class Contents extends EventEmitter {
    id = views.length + 1
    destroyed = false
    mainFrame = { url: '', detached: false }
    sent = []
    cssRequests = []
    styles = new Map()
    async insertCSS(css) {
      this.cssRequests.push(css)
      const key = await (theme?.insertCSS?.(css) ?? Promise.resolve(`css-${this.cssRequests.length}`))
      if (!this.destroyed) this.styles.set(key, css)
      return key
    }
    async removeInsertedCSS(key) { this.styles.delete(key) }
    getURL() { return this.mainFrame.url }
    send(route, raw) { this.sent.push({ route, message: JSON.parse(raw) }) }
    isDestroyed() { return this.destroyed }
    isFocused() { return true }
    setWebRTCIPHandlingPolicy() {}
    setWindowOpenHandler() {}
    async loadURL(url) {
      if (frameUrlMode === 'hello-before-navigation' && preloadHello)
        ipcMain.emit(PLUGIN_BRIDGE_CLIENT_ROUTE, { sender: this, senderFrame: this.mainFrame }, '{"type":"hello","protocolMajor":1}')
      if (frameUrlMode === 'blank-initial-frame-url') {
        this.emit('did-start-navigation', { url, isMainFrame: true, isSameDocument: false })
        queueMicrotask(() => {
          if (preloadHello) ipcMain.emit(PLUGIN_BRIDGE_CLIENT_ROUTE, { sender: this, senderFrame: this.mainFrame }, '{"type":"hello","protocolMajor":1}')
          this.mainFrame.url = url
          if (autoFinish) this.emit('did-finish-load')
        })
        return
      }
      this.mainFrame.url = url
      this.emit('did-start-navigation', { url, isMainFrame: true, isSameDocument: false })
      queueMicrotask(() => {
        if (preloadHello) ipcMain.emit(PLUGIN_BRIDGE_CLIENT_ROUTE, { sender: this, senderFrame: this.mainFrame }, '{"type":"hello","protocolMajor":1}')
        if (autoFinish) this.emit('did-finish-load')
      })
    }
    close() { this.destroyed = true; this.styles.clear(); this.emit('destroyed') }
  }
  class View {
    webContents = new Contents()
    visible = true
    constructor(options) { this.options = options; views.push(this) }
    setBounds() {}
    setVisible(visible) { this.visible = visible }
  }
  const children = []
  const window = {
    isDestroyed: () => false, isFocused: () => true, webContents: { isDestroyed: () => false },
    contentView: { children, addChildView: view => children.push(view), removeChildView: view => children.splice(children.indexOf(view), 1) },
  }
  const Runtime = runInNewContext(`${source}\nWebPluginRuntime`, {
    WebContentsView: View, pluginRuntimeSession,
    dialog: { async showMessageBox() { return { response: 0 } }, async showSaveDialog() { return { canceled: true } } },
    ipcMain, WebPluginBridge, PLUGIN_BRIDGE_CLIENT_ROUTE, PLUGIN_BRIDGE_HOST_ROUTE, join, __dirname: '.',
    PLUGIN_RUNTIME_PRELOAD_ERROR_ROUTE, isAbsolute, Buffer, tracePluginRuntimeAcceptance: () => undefined,
    buildRuntimeCsp, buildRuntimeResourceUrl, createRuntimeOrigin, parseRuntimePackageUrl, selectValidatedWebFeature,
    isValidatedPluginRuntimeSnapshot, isWebFeatureAuthority, WebHostCapabilities, nextRuntimeGeneration: (() => { let generation = 0; return () => ++generation })(),
    Date, performance, setTimeout, clearTimeout, process: { argv: [], env: {} }, Headers, Response,
  })
  return { runtime: new Runtime(() => window, runtimeOptions, capabilityDependencies, resolveNodePreload, undefined, theme?.source, handleEscape), currentSession, views, ipcMain, partitions, get clearStorageCalls() { return clearStorageCalls } }
}

test('runtime view can be hidden behind the Host loading shell and restored without replacing it', async () => {
  const h = harness()
  await h.runtime.open(await runtimeSnapshot(), 'hello')
  const view = h.views[0]
  assert.equal(view.visible, true)
  h.runtime.setVisible(false)
  assert.equal(view.visible, false)
  h.runtime.setVisible(true)
  assert.equal(view.visible, true)
  await h.runtime.close()
})

test('Host intercepts plain Esc before the plugin page, while a modal can keep the key', async () => {
  let handled = true; let calls = 0; let prevented = 0
  const h = harness(true, true, undefined, undefined, undefined, 'normal', undefined, () => { calls++; return handled })
  await h.runtime.open(await runtimeSnapshot(), 'hello')
  const contents = h.views[0].webContents
  const emit = extra => contents.emit('before-input-event', { preventDefault() { prevented++ } }, { type: 'keyDown', key: 'Escape', ...extra })
  emit({}); assert.equal(prevented, 1)
  handled = false; emit({}); assert.equal(prevented, 1)
  emit({ control: true }); emit({ isAutoRepeat: true })
  assert.equal(calls, 4, 'the Host input router receives every keyDown; it filters modifiers/repeats and also owns Ctrl+D')
  await h.runtime.close()
})

function themeSource(scheme = 'light') {
  let current = resolvePluginWindowTheme(scheme, false)
  const events = new EventEmitter()
  return {
    get current() { return current },
    subscribe(listener) { events.on('change', listener); return () => events.off('change', listener) },
    change(next) { current = resolvePluginWindowTheme(next, false); events.emit('change', current) },
  }
}
async function waitUntil(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setImmediate(resolve)) }
  assert.fail('runtime did not reach expected state')
}

test('theme is installed before READY and live replacement keeps one current root stylesheet', async () => {
  const first = deferred(); const source = themeSource(); let inserts = 0
  const env = harness(true, true, undefined, undefined, undefined, 'normal', { source,
    insertCSS: () => ++inserts === 1 ? first.promise : Promise.resolve('updated') })
  const states = []; env.runtime.subscribe(status => states.push(status.state))
  const opening = env.runtime.open(await runtimeSnapshot(), 'hello')
  await waitUntil(() => env.views[0]?.webContents.cssRequests.length > 0)
  assert.equal(env.runtime.status.state, 'LOADING')
  assert.equal(states.includes('READY'), false)
  first.resolve('initial')
  await opening
  assert.equal(env.runtime.status.state, 'READY')
  const contents = env.views[0].webContents
  source.change('dark')
  await waitUntil(() => [...contents.styles.values()].some(css => css.includes('--webtools-color-scheme: dark')))
  assert.equal(contents.styles.size, 1)
  await env.runtime.close()
  const requests = contents.cssRequests.length
  source.change('light'); await new Promise(resolve => setImmediate(resolve))
  assert.equal(contents.styles.size, 0)
  assert.equal(contents.cssRequests.length, requests)
})

test('theme changes during load are settled before the first READY publication', async () => {
  const first = deferred(); const source = themeSource('dark'); let calls = 0
  const env = harness(true, true, undefined, undefined, undefined, 'normal', { source,
    insertCSS: () => ++calls === 1 ? first.promise : Promise.resolve(`updated-${calls}`) })
  const readyStyles = []
  env.runtime.subscribe(status => { if (status.state === 'READY') readyStyles.push([...env.views[0].webContents.styles.values()]) })
  const opening = env.runtime.open(await runtimeSnapshot(), 'hello')
  await waitUntil(() => calls === 1)
  source.change('light'); first.resolve('initial')
  await opening
  assert.equal(readyStyles.length, 1)
  assert.equal(readyStyles[0].length, 1)
  assert.match(readyStyles[0][0], /--webtools-color-scheme: light/)
  await env.runtime.close()
})

test('close during a pending CSS insertion revokes readiness and cannot style the replacement runtime', async () => {
  const first = deferred(); const source = themeSource(); let calls = 0
  const env = harness(true, true, undefined, undefined, undefined, 'normal', { source,
    insertCSS: () => ++calls === 1 ? first.promise : Promise.resolve(`new-${calls}`) })
  const snapshot = await runtimeSnapshot()
  const opening = env.runtime.open(snapshot, 'hello')
  const rejected = assert.rejects(opening, /closed|Stale/)
  await waitUntil(() => calls === 1)
  await env.runtime.close(); await rejected
  await env.runtime.open(snapshot, 'hello')
  first.resolve('obsolete'); await new Promise(resolve => setImmediate(resolve))
  assert.equal(env.runtime.status.state, 'READY')
  assert.equal(env.views[1].webContents.styles.size, 1)
  assert.equal(env.views[1].webContents.styles.has('obsolete'), false)
  await env.runtime.close()
})

test('CSS failures use plugin fallback and a failed replacement retains the previous style', async () => {
  const source = themeSource(); let fail = true
  const env = harness(true, true, undefined, undefined, undefined, 'normal', { source,
    insertCSS: () => fail ? Promise.reject(new Error('contents unavailable')) : Promise.resolve('valid') })
  await env.runtime.open(await runtimeSnapshot(), 'hello')
  assert.equal(env.runtime.status.state, 'READY')
  const contents = env.views[0].webContents
  assert.equal(contents.styles.size, 0)
  fail = false; source.change('dark')
  await waitUntil(() => contents.styles.size === 1)
  fail = true; source.change('light')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(env.runtime.status.state, 'READY')
  assert.match(contents.styles.get('valid'), /--webtools-color-scheme: dark/)
  await env.runtime.close()
})

test('Web Features keep the sandbox-safe preload while Node Features use the Node-capable bootstrap', async t => {
  const { PluginManager } = await import('./plugin-manager.ts')
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const root = await mkdtemp(join(tmpdir(), 'webtools-runtime-preloads-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const manager = new PluginManager({ userData: root, hostVersion: '0.1.0', confirm: async () => true, externalOpen: async () => {}, clipboardWrite: () => {},
    ai: { complete: async () => ({ text: 'test' }), getDefaultProviderInfo: async () => ({ providerName: 'test', model: 'test' }) } })
  await manager.initialize(); t.after(() => manager.close())
  const dependencies = () => ({ store: manager.store, effects: { confirm: async () => true, isAIConfigured: async () => false,
    completeAI: async () => ({ text: 'test' }), clipboardWrite: () => {} } })

  const webManifest = runtimeV3Manifest({ id: 'org.example.web-runtime' })
  await manager.install(runtimeV3Package(webManifest), manager.session)
  await manager.setEnabled(webManifest.id, true, manager.session)
  const webHarness = harness(true, true, undefined, dependencies)
  t.after(() => webHarness.runtime.close())
  const webOpen = await manager.authorizeWebFeature({ pluginId: webManifest.id, featureId: 'hello' }, manager.session,
    authority => webHarness.runtime.openAuthority(authority).then(() => {}))
  await webOpen.completion
  const webPreferences = webHarness.views[0].options.webPreferences
  assert.equal(webPreferences.sandbox, true)
  assert.equal(webPreferences.nodeIntegration, false)
  assert.equal(webPreferences.contextIsolation, true)
  assert.match(webPreferences.preload, /preload[\\/]web-plugin\.js$/)
  await webHarness.runtime.close()

  const nodeManifest = runtimeV3Manifest({ id: 'org.example.node-runtime',
    runtime: { kind: 'node', preload: 'runtime/preload.cjs' },
    compatibility: { platforms: ['win32'], architectures: ['x64'], nodeAbi: process.versions.modules },
    runtimeFiles: [
      { path: 'web/index.html', role: 'web', mediaType: 'text/html' },
      { path: 'runtime/preload.cjs', role: 'node-preload', mediaType: 'text/javascript' },
    ],
  })
  await manager.install(runtimeV3Package(nodeManifest, [
    { name: 'web/index.html', data: '<!doctype html>' },
    { name: 'runtime/preload.cjs', data: 'module.exports = {}' },
  ]), manager.session)
  await manager.setEnabled(nodeManifest.id, true, manager.session)
  const nodeHarness = harness(true, true, undefined, dependencies, authority => ({
    pluginId: authority.snapshot.manifest.id, packageHash: authority.snapshot.packageHash,
    preloadPath: 'C:\\plugin-runtime\\preload.cjs', preloadHash: 'a'.repeat(64),
    localDataPath: 'C:\\plugin-runtime\\local-data',
  }))
  t.after(() => nodeHarness.runtime.close())
  const nodeOpen = await manager.authorizeWebFeature({ pluginId: nodeManifest.id, featureId: 'hello' }, manager.session,
    authority => nodeHarness.runtime.openAuthority(authority).then(() => {}))
  await nodeOpen.completion
  const nodePreferences = nodeHarness.views[0].options.webPreferences
  assert.equal(nodePreferences.sandbox, false)
  assert.equal(nodePreferences.nodeIntegration, false)
  assert.equal(nodePreferences.contextIsolation, true)
  assert.match(nodePreferences.preload, /preload[\\/]node-web-plugin\.js$/)
})

test('ordinary capabilities require real installed authority; revoke synchronously cancels the production runtime before teardown', async t => {
  const { PluginManager } = await import('./plugin-manager.ts')
  const { mkdtemp, rm } = await import('node:fs/promises'); const { tmpdir } = await import('node:os')
  const root = await mkdtemp(join(tmpdir(), 'webtools-runtime-authority-')); t.after(() => rm(root, { recursive: true, force: true }))
  const effects = { confirm: async () => true, isAIConfigured: async () => true, completeAI: async () => ({ text: 'test' }), clipboardWrite: () => {} }
  const manager = new PluginManager({ userData: root, hostVersion: '0.1.0', confirm: async () => true, externalOpen: async () => {}, clipboardWrite: () => {},
    ai: { complete: async () => ({ text: 'test' }), getDefaultProviderInfo: async () => ({ providerName: 'test', model: 'test' }) } })
  await manager.initialize(); t.after(() => manager.close())
  const base = runtimeV3Manifest(); const m = runtimeV3Manifest({ requestedCapabilities: ['plugin.storage.read', 'plugin.storage.write'],
    features: [{ ...base.features[0], requiredCapabilities: ['plugin.storage.read', 'plugin.storage.write'], acceptedContexts: [{ type: 'text', sources: ['launcher-input'] }] }] })
  await manager.install(runtimeV3Package(m), manager.session); await manager.setEnabled(m.id, true, manager.session)
  const h = harness(true, true, undefined, () => ({ store: manager.store, effects }))
  t.after(() => h.runtime.close())
  let originalAuthority
  const opened = await manager.authorizeWebFeature({ pluginId: m.id, featureId: 'hello' }, manager.session,
    authority => { originalAuthority = authority; return h.runtime.openAuthority(authority, { type: 'text', source: 'launcher-input', text: 'exact 中文', ageMs: 0 }).then(() => {}) })
  await opened.completion
  const contents = h.views[0].webContents
  h.ipcMain.emit(PLUGIN_BRIDGE_CLIENT_ROUTE, { sender: contents, senderFrame: contents.mainFrame },
    '{"type":"request","protocolMajor":1,"requestId":"1","method":"context.current","payload":null}')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(contents.sent.at(-1).message.result, { type: 'text', source: 'launcher-input', text: 'exact 中文' })
  const replacement = await manager.authorizeWebFeature({ pluginId: m.id, featureId: 'hello' }, manager.session, authority => {
    const switching = h.runtime.openAuthority(authority); switching.catch(() => {})
    assert.equal(originalAuthority.isCurrent(), false, 'READY Feature loses authority synchronously on replacement request')
    assert.equal(h.ipcMain.listenerCount(PLUGIN_BRIDGE_CLIENT_ROUTE), 0)
    return switching.then(() => {})
  })
  await replacement.completion
  const disabled = manager.setEnabled(m.id, false, manager.session)
  assert.equal(h.runtime.status.state, 'ABSENT'); assert.equal(h.ipcMain.listenerCount(PLUGIN_BRIDGE_CLIENT_ROUTE), 0)
  await disabled; await h.runtime.close(); assert.equal(contents.destroyed, true)
})

test('a READY production Runtime is synchronously revoked before update confirmation completes', async t => {
  const { PluginManager } = await import('./plugin-manager.ts')
  const { mkdtemp, rm } = await import('node:fs/promises'); const { tmpdir } = await import('node:os')
  const root = await mkdtemp(join(tmpdir(), 'webtools-ready-update-')); t.after(() => rm(root, { recursive: true, force: true }))
  const deps = { userData: root, hostVersion: '0.1.0', confirm: async () => true, externalOpen: async () => {}, clipboardWrite: () => {},
    ai: { complete: async () => ({ text: 'isolated' }), getDefaultProviderInfo: async () => ({ providerName: 'test', model: 'test' }) } }
  const manager = new PluginManager(deps); await manager.initialize(); t.after(() => manager.close())
  const m = runtimeV3Manifest(); await manager.install(runtimeV3Package(m), manager.session); await manager.setEnabled(m.id, true, manager.session)
  const effects = { confirm: async () => true, isAIConfigured: async () => true, completeAI: async () => ({ text: 'isolated', outputTokens: 1 }), clipboardWrite: () => {} }
  const h = harness(true, true, undefined, () => ({ store: manager.store, effects })); t.after(() => h.runtime.close())
  let authority
  const opened = await manager.authorizeWebFeature({ pluginId: m.id, featureId: 'hello' }, manager.session,
    value => { authority = value; return h.runtime.openAuthority(value).then(() => {}) })
  await opened.completion; assert.equal(h.runtime.status.state, 'READY')
  const entered = deferred(); const answer = deferred()
  deps.confirm = async () => { entered.resolve(); return answer.promise }
  const replacement = manager.install(runtimeV3Package(runtimeV3Manifest({ version: '2.0.0' })), manager.session)
  await entered.promise
  try {
    assert.equal(authority.isCurrent(), false)
    assert.equal(h.runtime.status.state, 'ABSENT')
    assert.equal(h.ipcMain.listenerCount(PLUGIN_BRIDGE_CLIENT_ROUTE), 0)
  } finally { answer.resolve(false); await replacement }
  assert.equal(authority.isCurrent(), false)
})

test('loaded document alone stays LOADING until the dedicated preload handshake arrives', async () => {
  const snapshot = await runtimeSnapshot()
  const h = harness(false)
  const opening = h.runtime.open(snapshot, 'hello')
  await new Promise(resolve => setImmediate(resolve))
  try {
    assert.equal(h.runtime.status.state, 'LOADING')
    const contents = h.views[0].webContents
    h.ipcMain.emit(PLUGIN_BRIDGE_CLIENT_ROUTE, { sender: contents, senderFrame: contents.mainFrame }, '{"type":"hello","protocolMajor":1}')
    assert.equal((await opening).state, 'READY')
  } finally { await h.runtime.close(); await opening.catch(() => {}) }
})

test('blank Chromium frame URL is tolerated only during the exact initial document commit', async () => {
  const snapshot = await runtimeSnapshot()
  const committing = harness(true, true, undefined, undefined, undefined, 'blank-initial-frame-url')
  try {
    assert.equal((await committing.runtime.open(snapshot, 'hello')).state, 'READY')
    const contents = committing.views[0].webContents
    contents.mainFrame.url = ''
    committing.ipcMain.emit(PLUGIN_BRIDGE_CLIENT_ROUTE, { sender: contents, senderFrame: contents.mainFrame }, ping('1'))
    await flush()
    assert.equal(committing.runtime.status.state, 'ABSENT', 'blank frame identity after initial commit remains invalid')
  } finally { await committing.runtime.close() }

  const beforeNavigation = harness(true, true, undefined, undefined, undefined, 'hello-before-navigation')
  try {
    await assert.rejects(beforeNavigation.runtime.open(snapshot, 'hello'), /closed/)
    assert.equal(beforeNavigation.runtime.status.state, 'ABSENT', 'a blank frame before the authorized first navigation is rejected')
  } finally { await beforeNavigation.runtime.close() }
})

test('runtime uses a persistent Manager-isolated Session and ordinary close preserves browser storage', async () => {
  const snapshot = await runtimeSnapshot()
  const h = harness()
  await h.runtime.open(snapshot, 'hello')
  assert.deepEqual(h.partitions, ['persist:webtools-web-plugin-runtime'])
  assert.equal(h.currentSession.partition, 'persist:webtools-web-plugin-runtime')
  await h.runtime.close()
  assert.equal(h.clearStorageCalls, 0, 'ordinary close must not clear localStorage/IndexedDB/session data')
})

test('cross-document reload revokes the generation and removes its private IPC listener', async () => {
  const snapshot = await runtimeSnapshot()
  const h = harness()
  await h.runtime.open(snapshot, 'hello')
  h.views[0].webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.views[0].webContents.destroyed, true)
  assert.equal(h.ipcMain.listenerCount(PLUGIN_BRIDGE_CLIENT_ROUTE), 0)
  await h.runtime.open(snapshot, 'hello')
  assert.equal(h.ipcMain.listenerCount(PLUGIN_BRIDGE_CLIENT_ROUTE), 1)
  await h.runtime.close()
})

test('reload between preload hello and document finish revokes the old handshake', async () => {
  const snapshot = await runtimeSnapshot()
  const h = harness(false, false)
  const opening = h.runtime.open(snapshot, 'hello')
  opening.catch(() => {})
  await new Promise(resolve => setImmediate(resolve))
  const contents = h.views[0].webContents
  h.ipcMain.emit(PLUGIN_BRIDGE_CLIENT_ROUTE, { sender: contents, senderFrame: contents.mainFrame }, '{"type":"hello","protocolMajor":1}')
  contents.emit('did-start-navigation', { url: contents.mainFrame.url, isMainFrame: true, isSameDocument: false })
  contents.emit('did-finish-load')
  try {
    await assert.rejects(opening, /closed/)
    assert.equal(contents.destroyed, true)
    assert.equal(h.ipcMain.listenerCount(PLUGIN_BRIDGE_CLIENT_ROUTE), 0)
  } finally { await h.runtime.close() }
})

test('crash teardown closes outstanding Session connections before a replacement reuses the persistent Session', async () => {
  const snapshot = await runtimeSnapshot()
  const { runtime, currentSession, views } = harness()
  await runtime.open(snapshot, 'hello')
  const cleanupStarted = deferred()
  const releaseCleanup = deferred()
  currentSession.closeAllConnections = () => { cleanupStarted.resolve(); return releaseCleanup.promise }
  views[0].webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
  await cleanupStarted.promise
  const replacement = runtime.open(snapshot, 'hello')
  try {
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(views.length, 1, 'replacement view must wait for outstanding Session connection cleanup')
    releaseCleanup.resolve()
    assert.equal((await replacement).state, 'READY')
    assert.equal(views.length, 2)
  } finally {
    releaseCleanup.resolve()
    await replacement.catch(() => undefined)
    await runtime.close()
  }
})

test('failed Session connection cleanup prevents the in-progress Feature switch from creating a replacement', async () => {
  const snapshot = await runtimeSnapshot()
  const { runtime, currentSession, views } = harness()
  await runtime.open(snapshot, 'hello')
  currentSession.closeAllConnections = async () => { throw new Error('controlled cleanup failure') }
  try {
    // A different validated package hash requires replacing the READY runtime.
    const replacement = await runtimeSnapshot(runtimeV3Manifest({ version: '1.0.1' }))
    await assert.rejects(runtime.open(replacement, 'hello'), /unavailable after an incomplete security cleanup/)
    assert.equal(views.length, 1, 'a failed security cleanup must not admit another view')
    await assert.rejects(runtime.open(snapshot, 'hello'), /unavailable/)
  } finally { await runtime.close() }
})

const ping = id => `{"type":"request","protocolMajor":1,"requestId":"${id}","method":"bridge.ping","payload":null}`
const flush = () => new Promise(resolve => setImmediate(resolve))

test('actual runtime authentication drops a foreign sender without consuming tokens or canceling the current call', async () => {
  const snapshot = await runtimeSnapshot()
  const h = harness(); await h.runtime.open(snapshot, 'hello')
  const contents = h.views[0].webContents
  const current = { sender: contents, senderFrame: contents.mainFrame }
  const foreign = { sender: { mainFrame: contents.mainFrame }, senderFrame: contents.mainFrame }
  try {
    h.ipcMain.emit(PLUGIN_BRIDGE_CLIENT_ROUTE, current, ping('1'))
    h.ipcMain.emit(PLUGIN_BRIDGE_CLIENT_ROUTE, foreign, '{"type":"cancel","protocolMajor":1,"requestId":"1"}')
    for (let i = 1; i <= 21; i++) h.ipcMain.emit(PLUGIN_BRIDGE_CLIENT_ROUTE, foreign, ping(String(i)))
    await flush()
    assert.equal(h.runtime.status.state, 'READY')
    assert.equal(contents.sent.at(-1).message.ok, true)
    assert.equal(contents.sent.filter(x => x.message.type === 'response').length, 1)
    for (let i = 2; i <= 20; i++) {
      h.ipcMain.emit(PLUGIN_BRIDGE_CLIENT_ROUTE, current, ping(String(i))); await flush()
      assert.equal(contents.sent.at(-1).message.ok, true)
    }
    h.ipcMain.emit(PLUGIN_BRIDGE_CLIENT_ROUTE, current, ping('21'))
    assert.equal(contents.sent.at(-1).message.error.code, 'LIMIT_EXCEEDED')
  } finally { await h.runtime.close() }
})

test('current Plugin subframe violation revokes before Session connection cleanup can finish', async () => {
  const snapshot = await runtimeSnapshot()
  const h = harness(); await h.runtime.open(snapshot, 'hello')
  const contents = h.views[0].webContents
  const cleanup = deferred()
  h.currentSession.closeAllConnections = () => cleanup.promise
  const oldListener = h.ipcMain.listeners(PLUGIN_BRIDGE_CLIENT_ROUTE)[0]
  try {
    h.ipcMain.emit(PLUGIN_BRIDGE_CLIENT_ROUTE, { sender: contents, senderFrame: { ...contents.mainFrame } }, ping('1'))
    assert.equal(h.runtime.status.state, 'ABSENT')
    assert.equal(h.ipcMain.listenerCount(PLUGIN_BRIDGE_CLIENT_ROUTE), 0)
    oldListener({ sender: contents, senderFrame: contents.mainFrame }, ping('2'))
    assert.equal(contents.sent.filter(x => x.message.type === 'response').length, 0)
    assert.equal(contents.sent.at(-1).message.type, 'runtime-closed')
  } finally { cleanup.resolve(); await h.runtime.close() }
})

test('normal close removes old authority before await and replacement cannot inherit an old listener', async () => {
  const snapshot = await runtimeSnapshot()
  const h = harness(); await h.runtime.open(snapshot, 'hello')
  const contents = h.views[0].webContents
  const oldGeneration = h.runtime.status.generation
  const oldListener = h.ipcMain.listeners(PLUGIN_BRIDGE_CLIENT_ROUTE)[0]
  const cleanup = deferred()
  h.currentSession.closeAllConnections = () => cleanup.promise
  const closing = h.runtime.close()
  assert.equal(h.runtime.status.state, 'ABSENT')
  assert.equal(h.ipcMain.listenerCount(PLUGIN_BRIDGE_CLIENT_ROUTE), 0)
  const replacement = h.runtime.open(snapshot, 'hello')
  try {
    await flush(); assert.equal(h.views.length, 1)
    cleanup.resolve(); await closing; await replacement
    assert.ok(h.runtime.status.generation > oldGeneration)
    const next = h.views[1].webContents
    h.ipcMain.emit(PLUGIN_BRIDGE_CLIENT_ROUTE, { sender: next, senderFrame: next.mainFrame }, ping('1'))
    oldListener({ sender: contents, senderFrame: contents.mainFrame }, '{"type":"cancel","protocolMajor":1,"requestId":"1"}')
    await flush()
    assert.equal(next.sent.at(-1).message.ok, true)
    assert.equal(h.ipcMain.listenerCount(PLUGIN_BRIDGE_CLIENT_ROUTE), 1)
  } finally { cleanup.resolve(); await replacement.catch(() => {}); await h.runtime.close() }
  assert.equal(h.ipcMain.listenerCount(PLUGIN_BRIDGE_CLIENT_ROUTE), 0)
})

test('a controlled runtime ping is canceled by the current Bridge exactly once and later pings still work', async () => {
  const snapshot = await runtimeSnapshot()
  const started = deferred()
  const aborted = deferred()
  let dispatchCount = 0
  const dispatchPing = signal => {
    dispatchCount++
    if (dispatchCount > 1) return null
    started.resolve()
    return new Promise(resolve => {
      const onAbort = () => {
        signal.removeEventListener('abort', onAbort)
        aborted.resolve()
        resolve(null)
      }
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    })
  }
  const h = harness(true, true, { dispatchPing })
  await h.runtime.open(snapshot, 'hello')
  const contents = h.views[0].webContents
  try {
    h.ipcMain.emit(PLUGIN_BRIDGE_CLIENT_ROUTE, { sender: contents, senderFrame: contents.mainFrame }, ping('1'))
    await flush()
    assert.equal(dispatchCount, 1, 'the Host must start the accepted ping before cancellation')
    await started.promise
    assert.equal(contents.sent.filter(item => item.message.type === 'response' && item.message.requestId === '1').length, 0)
    h.ipcMain.emit(PLUGIN_BRIDGE_CLIENT_ROUTE, { sender: contents, senderFrame: contents.mainFrame }, '{"type":"cancel","protocolMajor":1,"requestId":"1"}')
    await aborted.promise
    await flush()
    const terminal = contents.sent.filter(item => item.message.type === 'response' && item.message.requestId === '1')
    assert.equal(terminal.length, 1)
    assert.deepEqual(terminal[0].message, { type: 'response', protocolMajor: 1, requestId: '1', ok: false, error: { code: 'CANCELLED', retryable: false } })
    assert.equal(h.runtime.status.state, 'READY')
    h.ipcMain.emit(PLUGIN_BRIDGE_CLIENT_ROUTE, { sender: contents, senderFrame: contents.mainFrame }, ping('2'))
    await flush()
    assert.deepEqual(contents.sent.at(-1).message, { type: 'response', protocolMajor: 1, requestId: '2', ok: true, result: null })
  } finally { await h.runtime.close() }
})
