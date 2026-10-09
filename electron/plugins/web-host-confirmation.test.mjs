import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, extname } from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
import { PluginManager } from './plugin-manager.ts'
import { completeSharedAIForWeb } from './web-host-capabilities.ts'
import { formatPluginConsentDetail } from './plugin-consent-view.ts'
import { fail } from './errors.ts'
import { LIMITS } from './manifest.ts'

test('production Host confirmation passes the same abort signal into Electron MessageBox options', async t => {
  const root = await mkdtemp(join(tmpdir(), 'webtools-dialog-signal-')); t.after(() => rm(root, { recursive: true, force: true }))
  const source = stripTypeScriptTypes((await readFile(new URL('./electron-plugin-host.ts', import.meta.url), 'utf8'))
    .replace(/^import .*\r?\n/gm, '').replace('export function createElectronPluginHost', 'function createElectronPluginHost'))
  let captured; let open = false
  const dialog = { showMessageBox: (_window, options) => {
    captured = options; open = true
    return new Promise(resolve => options.signal?.addEventListener('abort', () => { open = false; resolve({ response: 0 }) }, { once: true }))
  } }
  const createHost = runInNewContext(`${source}\ncreateElectronPluginHost`, { PluginManager, completeSharedAIForWeb, formatPluginConsentDetail,
    fail, LIMITS, join, extname, dialog, clipboard: { writeText: () => {} }, shell: {}, nativeImage: {} })
  const window = { isDestroyed: () => false, webContents: { isDestroyed: () => false } }
  const host = createHost({ userData: root, hostVersion: '0.1.0', sharedAI: {}, dataStore: {}, getWindow: () => window })
  t.after(() => host.manager.close())
  const controller = new AbortController()
  const pending = host.webEffects.confirm({ kind: 'ai', pluginId: 'org.example.test', name: 'Test', version: '1.0.0', manifestVersion: 2, preview: 'synthetic' }, controller.signal)
  assert.equal(captured.signal, controller.signal); assert.equal(open, true)
  controller.abort(); assert.equal(await pending, false); assert.equal(open, false)
})
