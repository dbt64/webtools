import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
import { webManifest, webPackage } from './fixtures.mjs'
import { isValidatedWebPackageSnapshot, validateWebPackageForRuntime } from './package-validator.ts'
import { buildRuntimeCsp, buildRuntimeResourceUrl, createRuntimeOrigin, parseRuntimePackageUrl, selectValidatedWebFeature } from './web-runtime-policy.ts'

const source = stripTypeScriptTypes((await readFile(new URL('./web-plugin-runtime.ts', import.meta.url), 'utf8'))
  .replace(/^import .*\r?\n/gm, '').replace('export class WebPluginRuntime', 'class WebPluginRuntime'))

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function harness() {
  const views = []
  const currentSession = Object.assign(new EventEmitter(), {
    setPermissionRequestHandler() {}, setPermissionCheckHandler() {},
    webRequest: { onBeforeRequest() {} }, protocol: { handle() {} },
    async setProxy() {}, async closeAllConnections() {}, async clearStorageData() {}, async clearCache() {},
  })
  class Contents extends EventEmitter {
    destroyed = false
    isDestroyed() { return this.destroyed }
    setWebRTCIPHandlingPolicy() {}
    setWindowOpenHandler() {}
    async loadURL() { queueMicrotask(() => this.emit('did-finish-load')) }
    close() { this.destroyed = true; this.emit('destroyed') }
  }
  class View {
    webContents = new Contents()
    constructor() { views.push(this) }
    setBounds() {}
  }
  const children = []
  const window = {
    isDestroyed: () => false, webContents: { isDestroyed: () => false },
    contentView: { children, addChildView: view => children.push(view), removeChildView: view => children.splice(children.indexOf(view), 1) },
  }
  const Runtime = runInNewContext(`${source}\nWebPluginRuntime`, {
    WebContentsView: View, session: { fromPartition: () => currentSession },
    buildRuntimeCsp, buildRuntimeResourceUrl, createRuntimeOrigin, parseRuntimePackageUrl, selectValidatedWebFeature,
    isValidatedWebPackageSnapshot, setTimeout, clearTimeout, process: { argv: [], env: {} }, Headers, Response,
  })
  return { runtime: new Runtime(() => window), currentSession, views }
}

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
