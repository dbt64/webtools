import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { loadWindowShell, presentWindow, withWindowRequest } from './window-startup.ts'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function harness() {
  const events = []
  const window = Object.assign(new EventEmitter(), {
    visible: false, isDestroyed: () => false, isMinimized: () => false,
    isVisible() { return this.visible },
    showInactive() { this.visible = true; events.push('show-inactive') },
    show() { events.push('show') }, focus() { events.push('focus') }, setOpacity(value) { events.push(`opacity-${value}`) },
    webContents: { isDestroyed: () => false,
      async executeJavaScript() { events.push('check-shell'); return true },
      async capturePage() { events.push('capture'); throw new Error('shell presentation must not wait for screenshots') } },
  })
  return { window, events }
}

test('target document loading does not reveal a shell, capture it, or poll pixels', async () => {
  const h = harness(); const documentLoaded = deferred()
  const ready = loadWindowShell(h.window, () => documentLoaded.promise)
  h.window.emit('ready-to-show')
  assert.deepEqual(h.events, [])
  documentLoaded.resolve()
  const result = await ready
  assert.equal(result, undefined)
  assert.deepEqual(h.events, ['opacity-0'])
  assert.equal(h.window.visible, false)
  assert.equal(h.events.includes('capture'), false)
  assert.equal(h.window.listenerCount('closed'), 0)
})

test('a ready shell is handed off before WPF releases and Electron focuses only after acknowledgement', async () => {
  const h = harness(); const acknowledged = deferred()
  await withWindowRequest({ requestId: 'one', entry: 'launcher', pluginId: 'org.example.vue', startup: 'cold' }, async () => {
    const opening = presentWindow(h.window, async (id, target) => { assert.equal(id, 'one'); h.events.push('handoff'); await acknowledged.promise; target.showInactive(); return true })
    assert.deepEqual(h.events, ['handoff'])
    acknowledged.resolve(); await opening
    assert.deepEqual(h.events, ['handoff', 'show-inactive', 'opacity-1', 'show', 'focus'])
    await presentWindow(h.window, () => assert.fail('the same request must not present twice'))
  })
})

test('hot activation of an existing window still completes the new WPF request without reloading it', async () => {
  const h = harness(); h.window.visible = true
  await withWindowRequest({ requestId: 'two', entry: 'super-panel', pluginId: 'org.example.vue', startup: 'warm' },
    () => presentWindow(h.window, async id => { assert.equal(id, 'two'); h.events.push('handoff'); return false }))
  assert.deepEqual(h.events, ['handoff', 'show-inactive', 'opacity-1', 'show', 'focus'])
})
