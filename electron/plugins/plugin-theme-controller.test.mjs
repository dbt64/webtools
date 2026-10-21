import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PluginThemeController } from './plugin-theme-controller.ts'

test('plugin theme follows authoritative settings and observes system changes only in system mode', () => {
  let preference = 'dark'
  const nativeTheme = Object.assign(new EventEmitter(), { shouldUseDarkColors: false })
  const controller = new PluginThemeController(() => preference, nativeTheme)
  const changes = []
  controller.subscribe(theme => changes.push(theme.scheme))
  assert.equal(controller.current.scheme, 'dark')
  nativeTheme.emit('updated')
  assert.deepEqual(changes, [])
  preference = 'system'; controller.refresh()
  assert.deepEqual(changes, ['light'])
  nativeTheme.shouldUseDarkColors = true; nativeTheme.emit('updated')
  assert.deepEqual(changes, ['light', 'dark'])
  preference = 'light'; controller.refresh()
  nativeTheme.shouldUseDarkColors = false; nativeTheme.emit('updated')
  nativeTheme.shouldUseDarkColors = true; nativeTheme.emit('updated')
  assert.deepEqual(changes, ['light', 'dark', 'light'])
  controller.dispose()
  assert.equal(nativeTheme.listenerCount('updated'), 0)
})

test('theme observers unsubscribe independently and cannot break other windows', () => {
  let preference = 'dark'
  const controller = new PluginThemeController(() => preference, Object.assign(new EventEmitter(), { shouldUseDarkColors: true }))
  const changes = []
  const unsubscribe = controller.subscribe(() => { throw new Error('destroyed observer') })
  controller.subscribe(theme => changes.push(theme.scheme))
  preference = 'light'; controller.refresh()
  unsubscribe()
  preference = 'dark'; controller.refresh()
  assert.deepEqual(changes, ['light', 'dark'])
  controller.dispose()
})

test('an OS event cannot publish a transient native mirror while a settings transaction may still roll back', () => {
  let mirror = 'dark'
  const nativeTheme = Object.assign(new EventEmitter(), { shouldUseDarkColors: false })
  const controller = new PluginThemeController(() => mirror, nativeTheme)
  const changes = []; controller.subscribe(theme => changes.push(theme.scheme))
  mirror = 'light' // Native accepted the first half of a combined save; Manager persistence is still pending.
  nativeTheme.emit('updated')
  assert.equal(controller.current.scheme, 'dark')
  assert.deepEqual(changes, [])
  mirror = 'dark' // The Manager write failed and the Native mirror rolled back.
  nativeTheme.emit('updated')
  assert.deepEqual(changes, [])
  mirror = 'system'; controller.refresh() // Only the successful-save callback accepts a new preference.
  assert.equal(controller.current.scheme, 'light')
  nativeTheme.shouldUseDarkColors = true; nativeTheme.emit('updated')
  assert.equal(controller.current.scheme, 'dark')
  controller.dispose()
})
