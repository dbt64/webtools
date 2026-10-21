import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
import { DataStore } from '../services/data-store.ts'
import { createManagerInvokeRegistry } from './window-security.ts'

const source = stripTypeScriptTypes((await readFile(new URL('./settings-handlers.ts', import.meta.url), 'utf8'))
  .replace(/^import .*\r?\n/gm, '').replace('export function registerSettingsIpcHandlers', 'function registerSettingsIpcHandlers'), { mode: 'transform' })
const register = runInNewContext(`${source}\nregisterSettingsIpcHandlers`, { createManagerInvokeRegistry, structuredClone, console })

test('theme notification follows successful standalone persistence, never a failed write', async t => {
  const root = await mkdtemp(join(tmpdir(), 'webtools-theme-settings-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dataStore = new DataStore(join(root, 'data.json')); await dataStore.load()
  const saved = []; const handlers = new Map()
  register({ handle: (name, handler) => handlers.set(name, handler) }, {
    dataStore, isManagerMainFrame: () => true, cancelTranslations() {},
    onThemePreferenceChanged: () => saved.push(dataStore.snapshot().settings.theme),
  })
  assert.equal((await handlers.get('settings:update')({}, { theme: 'light' })).ok, true)
  assert.deepEqual(saved, ['light'])
  assert.equal((await new DataStore(join(root, 'data.json')).load()).settings.theme, 'light')
  dataStore.update = async () => { throw new Error('disk unavailable') }
  assert.equal((await handlers.get('settings:update')({}, { theme: 'dark' })).ok, false)
  assert.deepEqual(saved, ['light'])
})

test('native-owned theme publishes after the full save and does not publish a rolled-back mirror', async t => {
  const root = await mkdtemp(join(tmpdir(), 'webtools-native-theme-settings-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dataStore = new DataStore(join(root, 'data.json')); await dataStore.load()
  let mirror = { ...dataStore.snapshot().settings, theme: 'system' }
  const saved = []; const handlers = new Map()
  register({ handle: (name, handler) => handlers.set(name, handler) }, {
    dataStore, isManagerMainFrame: () => true, cancelTranslations() {}, getSettings: () => mirror,
    updateNativeLauncherSettings: async patch => { mirror = { ...mirror, ...patch }; return mirror },
    onThemePreferenceChanged: () => saved.push(mirror.theme),
  })
  assert.equal((await handlers.get('settings:update')({}, { theme: 'light' })).ok, true)
  assert.deepEqual(saved, ['light'])
  dataStore.update = async () => { throw new Error('disk unavailable') }
  assert.equal((await handlers.get('settings:update')({}, { theme: 'dark', websiteLayout: 'list' })).ok, false)
  assert.equal(mirror.theme, 'light')
  assert.deepEqual(saved, ['light'])
})
