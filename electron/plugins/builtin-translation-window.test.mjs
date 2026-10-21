import test from 'node:test'
import assert from 'node:assert/strict'
import { BuiltinTranslationWindow } from './builtin-translation-window.ts'
import { createTranslation2Handlers } from '../ipc/translation2-handlers.ts'
import { TRANSLATION2_IPC_CHANNELS } from '../../src/shared/translation2-ipc.ts'
import { createDefaultTranslation2WorkspaceSettings } from '../../src/shared/translation2-contracts.ts'

class FakeWindow {
  destroyed = false
  visible = false
  focused = false
  minimized = false
  pinned = false
  sent = []
  listeners = new Map()
  webContents = {
    destroyed: false,
    send: (channel, payload) => this.sent.push({ channel, payload }),
    isDestroyed: () => this.webContents.destroyed,
  }
  on(name, listener) { this.listeners.set(name, listener) }
  once(name, listener) { this.listeners.set(name, listener) }
  show() { this.visible = true }
  focus() { this.focused = true }
  isMinimized() { return this.minimized }
  restore() { this.minimized = false }
  minimize() { this.minimized = true }
  isAlwaysOnTop() { return this.pinned }
  setAlwaysOnTop(value) { this.pinned = value }
  isDestroyed() { return this.destroyed }
  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.webContents.destroyed = true
    this.listeners.get('closed')?.()
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function setup({ enabled = true, loading, onFocused } = {}) {
  const windows = []
  const surfaces = []
  const owner = new BuiltinTranslationWindow({
    createWindow: () => { const window = new FakeWindow(); windows.push(window); return window },
    loadWindow: loading ? () => loading.promise : async () => {},
    isEnabled: () => enabled,
    onSurfacesChanged: active => surfaces.push(active),
    onFocused,
  })
  return { owner, windows, surfaces, setEnabled: value => { enabled = value } }
}

test('Translation owns its pin and minimize controls and reopening restores the same surface', async () => {
  const { owner, windows } = setup()
  await owner.open()
  assert.equal(owner.isPinned(), false)
  assert.deepEqual(owner.setPinned(true), { pinned: true })
  owner.minimize()
  assert.equal(windows[0].minimized, true)
  await owner.open()
  assert.equal(windows[0].minimized, false)
  assert.equal(owner.isPinned(), true)
  await owner.close()
  assert.throws(() => owner.setPinned(true), /closed/)
})

test('background Translation reuses and restores its independent window and clears temporary targeting', async () => {
  let focused = 0
  const { owner, windows } = setup({ onFocused: () => focused++ })
  await owner.open(); windows[0].minimized = true
  await owner.open()
  assert.equal(windows.length, 1)
  assert.equal(windows[0].minimized, false)
  assert.equal(focused, 2)
  await owner.close(); await owner.open()
  assert.equal(windows.length, 2)
  await owner.close()
})

test('reuses one window and publishes the newest exact source with a new generation', async () => {
  const { owner, windows, surfaces } = setup()
  await owner.open(' first source ')
  await owner.open('第二段')

  assert.equal(windows.length, 1)
  assert.deepEqual(owner.snapshot(), { generation: 2, sourceText: '第二段' })
  assert.deepEqual(windows[0].sent.map(item => item.payload), [
    { generation: 1, sourceText: ' first source ' },
    { generation: 2, sourceText: '第二段' },
  ])
  assert.equal(windows[0].visible, true)
  assert.equal(windows[0].focused, true)
  assert.deepEqual(surfaces, [true])
})

test('a newer open during initial load is the only source delivered after load', async () => {
  const loading = deferred()
  const { owner, windows } = setup({ loading })
  const first = owner.open('old')
  const second = owner.open('new')
  loading.resolve()
  await Promise.all([first, second])

  assert.equal(windows.length, 1)
  assert.deepEqual(windows[0].sent, [{
    channel: 'translation2:opened',
    payload: { generation: 2, sourceText: 'new' },
  }])
})

test('disabled lifecycle rejects open before creating a window', async () => {
  const { owner, windows } = setup({ enabled: false })
  await assert.rejects(() => owner.open('text'), /disabled/)
  assert.equal(windows.length, 0)
})

test('close destroys the owned window and clears source state', async () => {
  const { owner, windows, surfaces } = setup()
  await owner.open('secret source')
  await owner.close()

  assert.equal(windows[0].destroyed, true)
  assert.deepEqual(owner.snapshot(), { generation: 2, sourceText: null })
  assert.deepEqual(surfaces, [true, false])
})

test('rejects invalid or oversized source text without mutating current state', async () => {
  const { owner } = setup()
  await owner.open('valid')
  await assert.rejects(() => owner.open('x'.repeat(20_001)), /invalid/)
  assert.deepEqual(owner.snapshot(), { generation: 1, sourceText: 'valid' })
})

test('first Translation bootstrap completes before the renderer-ready open promise', async () => {
  let owner
  let bootstrap
  let opening
  let settled = false
  const window = new FakeWindow()
  owner = new BuiltinTranslationWindow({
    createWindow: () => window,
    isEnabled: () => true,
    onSurfacesChanged() {},
    loadWindow: async () => {
      // The renderer invokes bootstrap after its document loads, while open is pending.
      await new Promise(resolve => setImmediate(resolve))
      bootstrap = await handlers[TRANSLATION2_IPC_CHANNELS.bootstrap]({})
      assert.equal(bootstrap.ok, true)
    },
  })
  const { handlers } = createTranslation2Handlers({
    isTranslationMainFrame: () => true,
    window: owner,
    // Regression fixture for the former Main wiring: bootstrap must ignore this wait.
    shellPresented: () => opening,
    sharedAI: { getProviderDescriptors: () => [] },
    settings: { get: () => createDefaultTranslation2WorkspaceSettings() },
    importedServices: { credentialStatus: async () => ({}) },
    languageDefaults: () => ({ sourceLanguage: 'auto', targetLanguage: 'zh-CN' }),
    theme: () => 'dark',
  })
  opening = owner.open('first exact source').then(() => { settled = true })
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, true, 'renderer bootstrap must not wait for the open promise that waits for renderer readiness')
  await opening
  assert.deepEqual(bootstrap.data.open, { generation: 1, sourceText: 'first exact source' })
  assert.deepEqual(window.sent.map(item => item.payload), [bootstrap.data.open])
})

test('closing during renderer readiness rejects the pending open without waiting for renderer', async () => {
  const loading = deferred()
  const { owner, surfaces } = setup({ loading })
  let failure
  const opening = owner.open('pending source').catch(error => { failure = error })
  await owner.close()
  await new Promise(resolve => setImmediate(resolve))
  assert.match(failure?.message ?? '', /closed before it was ready/)
  await opening
  assert.deepEqual(surfaces, [true, false])
  assert.equal(owner.hasSurface, false)
})

test('renderer load failure rejects the request and releases the surface', async () => {
  const loading = deferred()
  const { owner, surfaces, windows } = setup({ loading })
  const opening = owner.open('failed source')
  loading.reject(new Error('renderer failed'))
  await assert.rejects(opening, /renderer failed/)
  assert.deepEqual(surfaces, [true, false])
  assert.equal(owner.hasSurface, false)
  assert.equal(windows[0].destroyed, true)
})

test('completion of an old closed load cannot clear the replacement window opening', async () => {
  const loads = [deferred(), deferred()]
  const windows = []
  let loadIndex = 0
  const owner = new BuiltinTranslationWindow({
    createWindow: () => { const window = new FakeWindow(); windows.push(window); return window },
    loadWindow: () => loads[loadIndex++].promise,
    isEnabled: () => true,
    onSurfacesChanged() {},
  })
  const first = owner.open('old').catch(() => {})
  await Promise.resolve()
  await owner.close()
  const second = owner.open('replacement')
  loads[0].reject(new Error('old load finished after close'))
  loads[1].resolve()
  await Promise.all([first, second])
  assert.equal(owner.getSurface(), windows[1])
  assert.equal(windows[1].visible, true)
  assert.equal(windows[1].sent[0].payload.sourceText, 'replacement')
})
