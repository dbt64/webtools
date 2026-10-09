import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
import { join } from 'node:path'
import { WebPluginBridge } from './web-plugin-bridge.ts'
import { PLUGIN_BRIDGE_CLIENT_ROUTE, PLUGIN_BRIDGE_HOST_ROUTE } from './web-plugin-bridge-routes.ts'
import { webManifest, webPackage } from './fixtures.mjs'
import { isValidatedWebPackageSnapshot, validateWebPackageForRuntime } from './package-validator.ts'
import { isWebFeatureAuthority } from './web-feature-authority.ts'
import { WebHostCapabilities } from './web-host-capabilities.ts'
import { buildRuntimeCsp, buildRuntimeResourceUrl, createRuntimeOrigin, parseRuntimePackageUrl, selectValidatedWebFeature } from './web-runtime-policy.ts'

const source = stripTypeScriptTypes((await readFile(new URL('./web-plugin-runtime.ts', import.meta.url), 'utf8'))
  .replace(/^import .*\r?\n/gm, '').replace('export class WebPluginRuntime', 'class WebPluginRuntime'))

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function harness(preloadHello = true, autoFinish = true, runtimeOptions = undefined, capabilityDependencies = undefined) {
  const ipcMain = new EventEmitter()
  const views = []
  const currentSession = Object.assign(new EventEmitter(), {
    setPermissionRequestHandler() {}, setPermissionCheckHandler() {},
    webRequest: { onBeforeRequest() {} }, protocol: { handle() {} },
    async setProxy() {}, async closeAllConnections() {}, async clearStorageData() {}, async clearCache() {},
  })
  class Contents extends EventEmitter {
    destroyed = false
    mainFrame = { url: '', detached: false }
    sent = []
    getURL() { return this.mainFrame.url }
    send(route, raw) { this.sent.push({ route, message: JSON.parse(raw) }) }
    isDestroyed() { return this.destroyed }
    isFocused() { return true }
    setWebRTCIPHandlingPolicy() {}
    setWindowOpenHandler() {}
    async loadURL(url) {
      this.mainFrame.url = url
      this.emit('did-start-navigation', { url, isMainFrame: true, isSameDocument: false })
      queueMicrotask(() => {
        if (preloadHello) ipcMain.emit(PLUGIN_BRIDGE_CLIENT_ROUTE, { sender: this, senderFrame: this.mainFrame }, '{"type":"hello","protocolMajor":1}')
        if (autoFinish) this.emit('did-finish-load')
      })
    }
    close() { this.destroyed = true; this.emit('destroyed') }
  }
  class View {
    webContents = new Contents()
    constructor(options) { this.options = options; views.push(this) }
    setBounds() {}
  }
  const children = []
  const window = {
    isDestroyed: () => false, isFocused: () => true, webContents: { isDestroyed: () => false },
    contentView: { children, addChildView: view => children.push(view), removeChildView: view => children.splice(children.indexOf(view), 1) },
  }
  const Runtime = runInNewContext(`${source}\nWebPluginRuntime`, {
    WebContentsView: View, session: { fromPartition: () => currentSession },
    ipcMain, WebPluginBridge, PLUGIN_BRIDGE_CLIENT_ROUTE, PLUGIN_BRIDGE_HOST_ROUTE, join, __dirname: '.',
    buildRuntimeCsp, buildRuntimeResourceUrl, createRuntimeOrigin, parseRuntimePackageUrl, selectValidatedWebFeature,
    isValidatedWebPackageSnapshot, isWebFeatureAuthority, WebHostCapabilities, Date, performance, setTimeout, clearTimeout, process: { argv: [], env: {} }, Headers, Response,
  })
  return { runtime: new Runtime(() => window, runtimeOptions, capabilityDependencies), currentSession, views, ipcMain }
}

test('ordinary capabilities require real installed authority; revoke synchronously cancels the production runtime before teardown', async t => {
  const { PluginManager } = await import('./plugin-manager.ts')
  const { mkdtemp, rm } = await import('node:fs/promises'); const { tmpdir } = await import('node:os')
  const root = await mkdtemp(join(tmpdir(), 'webtools-runtime-authority-')); t.after(() => rm(root, { recursive: true, force: true }))
  const effects = { confirm: async () => true, isAIConfigured: async () => true, completeAI: async () => ({ text: 'test' }), clipboardWrite: () => {} }
  const manager = new PluginManager({ userData: root, hostVersion: '0.1.0', confirm: async () => true, externalOpen: async () => {}, clipboardWrite: () => {},
    ai: { complete: async () => ({ text: 'test' }), getDefaultProviderInfo: async () => ({ providerName: 'test', model: 'test' }) } })
  await manager.initialize(); t.after(() => manager.close())
  const base = webManifest(); const m = webManifest({ requestedCapabilities: ['plugin.storage.read', 'plugin.storage.write'],
    features: [{ ...base.features[0], requiredCapabilities: ['plugin.storage.read', 'plugin.storage.write'], acceptedContexts: [{ type: 'text', sources: ['launcher-input'] }] }] })
  await manager.install(webPackage(m), manager.session); await manager.setEnabled(m.id, true, manager.session)
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
  const m = webManifest(); await manager.install(webPackage(m), manager.session); await manager.setEnabled(m.id, true, manager.session)
  const effects = { confirm: async () => true, isAIConfigured: async () => true, completeAI: async () => ({ text: 'isolated', outputTokens: 1 }), clipboardWrite: () => {} }
  const h = harness(true, true, undefined, () => ({ store: manager.store, effects })); t.after(() => h.runtime.close())
  let authority
  const opened = await manager.authorizeWebFeature({ pluginId: m.id, featureId: 'hello' }, manager.session,
    value => { authority = value; return h.runtime.openAuthority(value).then(() => {}) })
  await opened.completion; assert.equal(h.runtime.status.state, 'READY')
  const entered = deferred(); const answer = deferred()
  deps.confirm = async () => { entered.resolve(); return answer.promise }
  const replacement = manager.install(webPackage(webManifest({ version: '2.0.0' })), manager.session)
  await entered.promise
  try {
    assert.equal(authority.isCurrent(), false)
    assert.equal(h.runtime.status.state, 'ABSENT')
    assert.equal(h.ipcMain.listenerCount(PLUGIN_BRIDGE_CLIENT_ROUTE), 0)
  } finally { answer.resolve(false); await replacement }
  assert.equal(authority.isCurrent(), false)
})

test('loaded document alone stays LOADING until the dedicated preload handshake arrives', async () => {
  const snapshot = await validateWebPackageForRuntime(webPackage(webManifest()), '0.1.0')
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

test('cross-document reload revokes the generation and removes its private IPC listener', async () => {
  const snapshot = await validateWebPackageForRuntime(webPackage(webManifest()), '0.1.0')
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
  const snapshot = await validateWebPackageForRuntime(webPackage(webManifest()), '0.1.0')
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

test('crash teardown completes before a replacement runtime can reuse its Session', async () => {
  const snapshot = await validateWebPackageForRuntime(webPackage(webManifest()), '0.1.0')
  const { runtime, currentSession, views } = harness()
  await runtime.open(snapshot, 'hello')
  const cleanupStarted = deferred()
  const releaseCleanup = deferred()
  currentSession.clearStorageData = () => { cleanupStarted.resolve(); return releaseCleanup.promise }
  views[0].webContents.emit('render-process-gone')
  await cleanupStarted.promise
  const replacement = runtime.open(snapshot, 'hello')
  try {
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(views.length, 1, 'replacement view must wait for the crashed runtime Session cleanup')
    releaseCleanup.resolve()
    assert.equal((await replacement).state, 'READY')
    assert.equal(views.length, 2)
  } finally {
    releaseCleanup.resolve()
    await replacement.catch(() => undefined)
    await runtime.close()
  }
})

test('failed Session cleanup prevents the in-progress Feature switch from creating a replacement', async () => {
  const snapshot = await validateWebPackageForRuntime(webPackage(webManifest()), '0.1.0')
  const { runtime, currentSession, views } = harness()
  await runtime.open(snapshot, 'hello')
  currentSession.clearStorageData = async () => { throw new Error('controlled cleanup failure') }
  try {
    // A different validated package hash requires replacing the READY runtime.
    const replacement = await validateWebPackageForRuntime(webPackage(webManifest({ version: '1.0.1' })), '0.1.0')
    await assert.rejects(runtime.open(replacement, 'hello'), /unavailable after an incomplete security cleanup/)
    assert.equal(views.length, 1, 'a failed security cleanup must not admit another view')
    await assert.rejects(runtime.open(snapshot, 'hello'), /unavailable/)
  } finally { await runtime.close() }
})

const ping = id => `{"type":"request","protocolMajor":1,"requestId":"${id}","method":"bridge.ping","payload":null}`
const flush = () => new Promise(resolve => setImmediate(resolve))

test('actual runtime authentication drops a foreign sender without consuming tokens or canceling the current call', async () => {
  const snapshot = await validateWebPackageForRuntime(webPackage(webManifest()), '0.1.0')
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

test('current Plugin subframe violation revokes before Session cleanup can finish', async () => {
  const snapshot = await validateWebPackageForRuntime(webPackage(webManifest()), '0.1.0')
  const h = harness(); await h.runtime.open(snapshot, 'hello')
  const contents = h.views[0].webContents
  const cleanup = deferred()
  h.currentSession.clearStorageData = () => cleanup.promise
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
  const snapshot = await validateWebPackageForRuntime(webPackage(webManifest()), '0.1.0')
  const h = harness(); await h.runtime.open(snapshot, 'hello')
  const contents = h.views[0].webContents
  const oldGeneration = h.runtime.status.generation
  const oldListener = h.ipcMain.listeners(PLUGIN_BRIDGE_CLIENT_ROUTE)[0]
  const cleanup = deferred()
  h.currentSession.clearStorageData = () => cleanup.promise
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

test('a held acceptance ping is canceled by the current Bridge exactly once and later pings still work', async () => {
  const snapshot = await validateWebPackageForRuntime(webPackage(webManifest()), '0.1.0')
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
  const h = harness(true, true, { holdPingUntilAbort: dispatchPing })
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
