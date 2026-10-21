import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
import { PluginManager } from './plugin-manager.ts'
import { isWebFeatureAuthority } from './web-feature-authority.ts'
import { runtimeV3Manifest, runtimeV3Package } from './fixtures.mjs'
import { PluginThemeController } from './plugin-theme-controller.ts'

const source = stripTypeScriptTypes((await readFile(new URL('./plugin-window-manager.ts', import.meta.url), 'utf8'))
  .replace(/^import .*\r?\n/gm, '').replace('export class PluginWindowManager', 'class PluginWindowManager'), { mode: 'transform' })

function focusHarness({ deferRuntimeOpen = false } = {}) {
  const windows = []
  let returned = 0
  let returnApproval = Promise.resolve(true)
  let pendingDialogs = false
  let failNextOpen = false
  let finishRuntimeOpen
  let runtimeOpenStarted = false
  const runtimeBounds = []
  const runtimeVisibility = []
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.visible = false; this.focused = false; this.minimized = false; this.destroyed = false;
      this.webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler() {}, isDestroyed() { return false }, send() {} }); windows.push(this) }
    isDestroyed() { return this.destroyed }
    isMinimized() { return this.minimized }
    isMaximized() { return false }
    isFocused() { return this.focused }
    restore() { this.minimized = false }
    show() { this.visible = true }
    hide() { this.visible = false; this.focused = false }
    focus() { if (this.refuseFocus) return; for (const w of windows) if (w !== this && w.focused) w.blur(); this.focused = true; this.emit('focus') }
    blur() { this.focused = false; this.emit('blur') }
    minimize() { this.blur(); this.minimized = true; this.emit('minimize') }
    setTitle() {} setIcon() {} setBackgroundColor() {} setMenu() {}
    getContentSize() { return [960, 680] }
    destroy() { this.destroyed = true; this.visible = false; this.emit('closed') }
  }
  const Windows = runInNewContext(`${source}\nPluginWindowManager`, { BrowserWindow: Window,
    nativeImage: { createFromPath: () => ({ isEmpty: () => true }), createFromBuffer: () => ({ isEmpty: () => true }) },
    PLUGIN_WINDOW_CHROME_CHANNELS: { state: 'state' },
    isWebFeatureAuthority: () => true,
    screen: { getCursorScreenPoint: () => ({}), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }) }, Date, console, setImmediate })
  const owner = new Windows({ theme: { current: { backgroundColor: '#fff' }, subscribe: () => () => {} }, defaultIcon: 'app.ico', onSurfacesChanged() {},
    hasPendingHostDialogs: () => pendingDialogs, returnToLauncher: () => { returned++; return returnApproval }, createRuntime: () => {
      const listeners = new Set()
      const failOpen = failNextOpen; failNextOpen = false
      return { status: { state: 'ABSENT' }, closes: 0, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
        async openAuthority() {
          if (failOpen) throw new Error('Activation failed')
          runtimeOpenStarted = true
          if (deferRuntimeOpen) {
            this.status = { state: 'LOADING' }; for (const fn of listeners) fn(this.status)
            await new Promise(resolve => { finishRuntimeOpen = resolve })
          }
          this.status = { state: 'READY' }; for (const fn of listeners) fn(this.status)
          return this.status
        },
        async close() { this.closes++; await Promise.resolve(); this.status = { state: 'CLOSED' }; for (const fn of listeners) fn(this.status) },
        setBounds(bounds) { runtimeBounds.push(bounds) }, setVisible(visible) { runtimeVisibility.push(visible) },
        focus() {}, updateContext() {} }
    } })
  const open = (blurBehavior = 'temporary-hide', sessionId, featureId = 'home') => owner.open({ snapshot: {
    packageHash: 'hash', manifest: { manifestVersion: 3, id: 'org.example.focus', name: 'Focus', features: [{ id: featureId, title: featureId, presentation: { type: 'window', blurBehavior } }] } },
    featureId, ...(sessionId ? { development: { sessionId } } : {}), isCurrent: () => true, revoke() {} })
  const createManager = () => { const window = new Window({}); owner.registerManagerWindow(window, async () => window.destroy()); window.show(); window.focus(); return window }
  return { owner, windows, open, createManager, finishRuntimeOpen() { finishRuntimeOpen?.() }, runtimeBounds, runtimeVisibility,
    get runtimeOpenStarted() { return runtimeOpenStarted }, failNextOpen() { failNextOpen = true },
    setReturn(value) { returnApproval = value }, setDialogs(value) { pendingDialogs = value }, get returned() { return returned } }
}
const settleBlur = () => new Promise(resolve => setImmediate(resolve))

test('plugin activation starts immediately but the window stays hidden until its runtime is ready', async () => {
  const h = focusHarness({ deferRuntimeOpen: true })
  const opening = h.open()
  await settleBlur()
  const window = h.windows[0]
  assert.equal(h.runtimeOpenStarted, true)
  assert.equal(window.visible, false, 'WPF owns the only loading surface')
  assert.equal(h.owner.getChromeState(window).loading, true)
  assert.equal(h.owner.focusCurrentTemporaryWindow(), false, 'summon must not reveal an incomplete target')
  h.finishRuntimeOpen()
  await opening
  assert.equal(h.owner.getChromeState(window).loading, false)
  assert.equal(window.visible, true)
  assert.equal(h.runtimeVisibility.at(-1), true)
})

test('Esc waits for WPF acknowledgement, closes a temporary runtime, and retains a background window', async () => {
  const h = focusHarness()
  await h.open(); const temporary = h.windows[0]
  h.setDialogs(true)
  assert.equal(h.owner.handleEscape(temporary), false)
  assert.equal(h.returned, 0)
  h.setDialogs(false)
  let acknowledge
  h.setReturn(new Promise(resolve => { acknowledge = resolve }))
  assert.equal(h.owner.handleEscape(temporary), true)
  assert.equal(temporary.destroyed, false, 'WPF must acknowledge before teardown')
  acknowledge(true); await settleBlur()
  assert.equal(temporary.destroyed, true)
  assert.equal(h.owner.hasSurfaces, false, 'Esc teardown must release the idle-quit surface lease')
  assert.equal(h.owner.focusCurrentTemporaryWindow(), false)
  await h.open('background', undefined, 'background')
  assert.equal(h.owner.handleEscape(h.windows[1]), true)
  await settleBlur()
  assert.equal(h.windows[1].visible, true)
  assert.equal(h.returned, 2)
  await h.owner.closeAll()
})

test('manual minimize and modal blur preserve the window until final owner focus settles', async () => {
  const h = focusHarness()
  await h.open(); const window = h.windows[0]
  window.minimize(); await settleBlur()
  assert.equal(window.visible, true)
  assert.equal(h.owner.focusCurrentTemporaryWindow(), true)
  assert.equal(window.minimized, false)
  h.setDialogs(true); window.blur(); await settleBlur()
  assert.equal(window.visible, true)
  h.setDialogs(false); window.focus(); h.owner.hostDialogsClosed(window); await settleBlur()
  assert.equal(window.visible, true)
  window.blur(); h.owner.hostDialogsClosed(window); await settleBlur()
  assert.equal(window.visible, false)
  assert.equal(h.owner.focusCurrentTemporaryWindow(), true)
  await h.owner.closeAll()
})

test('development reload clears only that session target before closing its old runtime', async () => {
  const h = focusHarness()
  await h.open('background', 'dev'); const dev = h.windows[0]
  await h.open(); const installed = h.windows[1]
  const reload = h.owner.beginDevelopmentReload('dev')
  assert.equal(h.owner.focusCurrentTemporaryWindow(), true)
  assert.equal(installed.focused, true)
  await reload.ready
  await h.open('background', 'dev')
  await reload.finish()
  assert.equal(h.windows.length, 2)
  dev.blur(); await settleBlur()
  await h.open('temporary-hide', 'dev', 'temporary')
  const second = h.owner.beginDevelopmentReload('dev')
  assert.equal(h.owner.focusCurrentTemporaryWindow(), false)
  await second.ready; await second.finish()
  assert.equal(dev.destroyed, true)
  assert.equal(installed.destroyed, true, 'successful background activation explicitly ends the previous temporary interface')
  await h.owner.closeAll()
})

test('temporary blur retains the exact installed/development window and restores it on summon', async () => {
  const { owner, windows, open } = focusHarness()
  await open(); const original = windows[0]
  original.blur(); await settleBlur()
  assert.equal(original.visible, false)
  assert.equal(owner.hasSurfaces, true)
  assert.equal(owner.focusCurrentTemporaryWindow(), true)
  assert.equal(original.visible, true)
  await open('background', undefined, 'background'); const installed = windows[1]
  await open('temporary-hide', 'development-1'); const development = windows[2]
  await settleBlur()
  await owner.closePlugin('org.example.focus')
  assert.equal(installed.destroyed, true)
  development.blur(); await settleBlur()
  assert.equal(owner.focusCurrentTemporaryWindow(), true)
  assert.equal(development.focused, true)
  await owner.closeAll()
  assert.equal(owner.focusCurrentTemporaryWindow(), false)
})

test('background activation clears the temporary target and does not hide on blur', async () => {
  const { owner, windows, open } = focusHarness()
  await open(); await open('background', undefined, 'background')
  windows[1].blur(); await settleBlur()
  assert.equal(windows[0].destroyed, true)
  assert.equal(windows[1].visible, true)
  assert.equal(owner.focusCurrentTemporaryWindow(), false)
  await owner.closeAll()
})

test('summon reports a failed foreground activation so WPF can show search', async () => {
  const h = focusHarness()
  await h.open()
  h.windows[0].blur(); await settleBlur()
  h.windows[0].refuseFocus = true
  assert.equal(h.owner.focusCurrentTemporaryWindow(), false)
  h.windows[0].refuseFocus = false
  assert.equal(h.owner.focusCurrentTemporaryWindow(), true)
  await h.owner.closeAll()
})

test('explicit switching ends the previous temporary interface and Esc leaves no hidden runtime history', async () => {
  const h = focusHarness()
  await h.open('temporary-hide', undefined, 'a')
  await h.open('temporary-hide', undefined, 'b')
  await settleBlur()
  assert.equal(h.windows[0].destroyed, true)
  h.owner.handleEscape(h.windows[1])
  await settleBlur()
  assert.equal(h.owner.focusCurrentTemporaryWindow(), false)
  await h.open('temporary-hide', undefined, 'b')
  assert.equal(h.windows.length, 3)
  assert.equal(h.owner.focusCurrentTemporaryWindow(), true)
  h.windows[2].emit('close', { preventDefault() {} })
  assert.equal(h.owner.focusCurrentTemporaryWindow(), false)
  await settleBlur()
  await h.open('temporary-hide', undefined, 'b')
  assert.equal(h.windows.length, 4)
  assert.equal(h.windows[1].destroyed, true)
  await h.owner.closeAll()
})

test('Manager shares the temporary target, modal blur, summon, and acknowledged Esc teardown', async () => {
  const h = focusHarness()
  const manager = h.createManager()
  manager.blur(); await settleBlur()
  assert.equal(manager.visible, false)
  assert.equal(h.owner.focusCurrentTemporaryWindow(), true)
  manager.minimize(); await settleBlur()
  assert.equal(manager.visible, true)
  assert.equal(h.owner.focusCurrentTemporaryWindow(), true)
  assert.equal(manager.minimized, false)
  h.setDialogs(true); manager.blur(); await settleBlur()
  assert.equal(manager.visible, true)
  h.setDialogs(false); manager.focus()
  h.owner.handleEscape(manager); await settleBlur()
  assert.equal(manager.destroyed, true)
  assert.equal(h.owner.hasSurfaces, false)
  assert.equal(h.owner.focusCurrentTemporaryWindow(), false)
  await h.owner.closeAll()
})

test('failed replacement activation retains the previous temporary interface', async () => {
  const h = focusHarness()
  await h.open()
  h.failNextOpen()
  await assert.rejects(h.open('temporary-hide', undefined, 'failed'), /Activation failed/)
  assert.equal(h.windows[0].destroyed, false)
  assert.equal(h.windows[1].destroyed, true)
  assert.equal(h.owner.focusCurrentTemporaryWindow(), true)
  await h.owner.closeAll()
})

test('failed development restoration closes only that session and preserves an installed temporary target', async () => {
  const h = focusHarness()
  await h.open('background', 'dev')
  await h.open()
  const reload = h.owner.beginDevelopmentReload('dev')
  await reload.ready; await reload.finish()
  assert.equal(h.windows[0].destroyed, true)
  assert.equal(h.windows[1].destroyed, false)
  assert.equal(h.owner.focusCurrentTemporaryWindow(), true)
  await h.owner.closeAll()
})

test('switching Manager, ordinary plugin, and Translation-style background tears down only the previous temporary target', async () => {
  const h = focusHarness()
  const manager = h.createManager()
  await h.open(); await settleBlur()
  assert.equal(manager.destroyed, true)
  assert.equal(h.windows[1].options.frame, false)
  const nextManager = h.createManager(); await settleBlur()
  assert.equal(h.windows[1].destroyed, true)
  h.owner.activateBackgroundWindow(); await settleBlur()
  assert.equal(nextManager.destroyed, true)
  assert.equal(h.owner.focusCurrentTemporaryWindow(), false)
  await h.owner.closeAll()
})

test('failed WPF return retains the current temporary interface', async () => {
  const h = focusHarness()
  await h.open(); h.setReturn(Promise.resolve(false))
  h.owner.handleEscape(h.windows[0]); await settleBlur()
  assert.equal(h.windows[0].destroyed, false)
  assert.equal(h.owner.focusCurrentTemporaryWindow(), true)
  await h.owner.closeAll()
})

test('Plugin Window follows theme without replacing the window, altering geometry or retaining observers after closeAll', async t => {
  const root = await mkdtemp(join(tmpdir(), 'webtools-themed-window-'))
  const manager = new PluginManager({ userData: root, hostVersion: '0.1.0', confirm: async () => true,
    externalOpen: async () => {}, clipboardWrite() {}, ai: { complete: async () => ({ text: 'unused' }), getDefaultProviderInfo: async () => ({ providerName: 'test', model: 'test' }) } })
  await manager.initialize()
  t.after(async () => { manager.close(); await rm(root, { recursive: true, force: true }) })
  await manager.install(runtimeV3Package(), manager.session)
  await manager.setEnabled(runtimeV3Manifest().id, true, manager.session)
  let preference = 'light'
  const theme = new PluginThemeController(() => preference, Object.assign(new EventEmitter(), { shouldUseDarkColors: false }))
  t.after(() => theme.dispose())
  const windows = []
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.background = options.backgroundColor; this.destroyed = false; this.visible = false;
      this.webContents = { setWindowOpenHandler() {}, on() {}, isDestroyed() { return false }, send() {} }; windows.push(this) }
    isDestroyed() { return this.destroyed }
    isMinimized() { return false }
    isMaximized() { return false }
    isFocused() { return this.visible }
    show() { this.visible = true }
    focus() {}
    setTitle() {} setMenu() {}
    setIcon() {}
    setBackgroundColor(value) { this.background = value }
    getContentSize() { return [this.options.width, this.options.height] }
    destroy() { this.destroyed = true; this.emit('closed') }
  }
  const Windows = runInNewContext(`${source}\nPluginWindowManager`, {
    BrowserWindow: Window, nativeImage: { createFromPath: () => ({ isEmpty: () => true }), createFromBuffer: () => ({ isEmpty: () => true }) },
    PLUGIN_WINDOW_CHROME_CHANNELS: { state: 'state' }, isWebFeatureAuthority,
    screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }) },
    Date, console,
  })
  const owner = new Windows({ theme, defaultIcon: 'app.ico', onSurfacesChanged() {}, createRuntime: () => {
    const listeners = new Set()
    return { status: { state: 'ABSENT' }, authority: undefined,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
      async openAuthority(authority) { this.authority = authority; this.status = { state: 'READY' }; for (const listener of listeners) listener(this.status) },
      async close() { this.authority?.revoke(); await Promise.resolve(); this.status = { state: 'CLOSED' }; for (const listener of listeners) listener(this.status) },
      setBounds() {}, setVisible() {}, focus() {}, updateContext() {},
    }
  } })
  const open = async () => { const dispatch = await manager.authorizeWebFeature({ pluginId: runtimeV3Manifest().id, featureId: 'hello' }, manager.session, authority => owner.open(authority)); await dispatch.completion }
  await open()
  assert.equal(windows[0].options.backgroundColor, '#f3f5f8')
  assert.equal(windows[0].options.width, 960)
  assert.equal(windows[0].options.height, 680)
  assert.equal(windows[0].visible, true)
  preference = 'dark'; theme.refresh()
  assert.equal(windows[0].background, '#0b0c0e')
  await open()
  assert.equal(windows.length, 1)
  assert.equal(owner.hasSurfaces, true)
  await owner.closeAll()
  assert.equal(owner.hasSurfaces, false)
  preference = 'light'; theme.refresh()
  assert.equal(windows[0].background, '#0b0c0e')
})
