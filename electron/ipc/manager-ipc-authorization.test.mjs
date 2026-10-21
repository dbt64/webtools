import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { registerManagerEventHandlers, registerManagerInvokeHandlers } from './window-security.ts'
import { registerWebsiteIpcHandlers } from './website-handlers.ts'
import { registerEverythingIpcHandlers } from './everything-handlers.ts'
import { registerWindowIpcHandlers } from './window-handlers.ts'

function registrar() {
  const invokes = new Map()
  const events = new Map()
  return {
    invokes,
    events,
    handle: (channel, handler) => invokes.set(channel, handler),
    removeHandler: channel => invokes.delete(channel),
    on: (channel, handler) => events.set(channel, handler),
    removeListener: (channel, handler) => { if (events.get(channel) === handler) events.delete(channel) },
  }
}

test('manager invoke registration rejects plugin and subframe senders before service access', async () => {
  const ipc = registrar()
  const calls = []
  const manager = { webContents: {}, frame: {} }
  let allowed = false
  registerManagerInvokeHandlers(ipc, () => allowed, {
    'manager:secret': () => { calls.push('secret'); return 'credential metadata' },
    'manager:favorites': () => { calls.push('favorites'); return [] },
  })

  const plugin = { sender: {}, senderFrame: {} }
  await assert.rejects(Promise.resolve().then(() => ipc.invokes.get('manager:secret')(plugin)), /UNAUTHORIZED_MANAGER_IPC/)
  await assert.rejects(Promise.resolve().then(() => ipc.invokes.get('manager:favorites')({ sender: manager.webContents, senderFrame: {} })), /UNAUTHORIZED_MANAGER_IPC/)
  assert.deepEqual(calls, [])

  allowed = true
  assert.equal(await ipc.invokes.get('manager:secret')({ sender: manager.webContents, senderFrame: manager.frame }), 'credential metadata')
  assert.deepEqual(calls, ['secret'])
})

test('manager event registration drops plugin messages before invoking the event handler', () => {
  const ipc = registrar()
  let allowed = false
  const calls = []
  registerManagerEventHandlers(ipc, () => allowed, {
    'manager:ready': event => calls.push(event.sender),
  })

  const plugin = { sender: {} }
  ipc.events.get('manager:ready')(plugin)
  assert.deepEqual(calls, [])

  allowed = true
  ipc.events.get('manager:ready')(plugin)
  assert.deepEqual(calls, [plugin.sender])
})

test('Website and Favorites registrations reject plugin senders before touching services', async () => {
  const ipc = registrar()
  const calls = []
  registerWebsiteIpcHandlers(ipc, {
    isManagerMainFrame: () => false,
    websiteService: new Proxy({}, { get: (_target, property) => async () => { calls.push(String(property)); return { ok: true } } }),
    websiteMetadata: { fetch: async () => { calls.push('metadata'); return {} } },
    bookmarkService: new Proxy({}, { get: (_target, property) => async () => { calls.push(String(property)); return [] } }),
    onWebsitesChanged: async () => calls.push('projection'),
  })

  for (const handler of ipc.invokes.values()) {
    await assert.rejects(Promise.resolve().then(() => handler({ sender: {}, senderFrame: {} })), /UNAUTHORIZED_MANAGER_IPC/)
  }
  assert.deepEqual(calls, [])
})

test('Everything registrations reject plugin senders before detection, dialogs, search, or open', async () => {
  const ipc = registrar()
  const calls = []
  registerEverythingIpcHandlers(ipc, {
    isManagerMainFrame: () => false,
    everything: new Proxy({}, { get: (_target, property) => async () => { calls.push(String(property)); return [] } }),
    dataStore: { snapshot: () => { calls.push('snapshot'); return { settings: { everythingEnabled: true } } } },
    getManagerWindow: () => null,
    dialog: { showOpenDialog: async () => { calls.push('dialog'); return { canceled: true, filePaths: [] } } },
  })

  for (const handler of ipc.invokes.values()) {
    await assert.rejects(Promise.resolve().then(() => handler({ sender: {}, senderFrame: {} }, 'query')), /UNAUTHORIZED_MANAGER_IPC/)
  }
  assert.deepEqual(calls, [])
})

test('Manager lifecycle event registrations reject plugin senders before dispatch', () => {
  const ipc = registrar()
  const calls = []
  registerWindowIpcHandlers(ipc, {
    isManagerMainFrame: () => false,
    markManagerRendererReady: sender => calls.push(['ready', sender]),
    acknowledgeNativeManagerIntent: context => calls.push(['ack', context.sender]),
  })

  for (const listener of ipc.events.values()) listener({ sender: {} }, 'request', { disposition: 'applied' })
  assert.deepEqual(calls, [])
})

test('production IPC registrations do not bypass the role-checked registrars', async () => {
  const [main, sources] = await Promise.all([
    readFile(new URL('../main.ts', import.meta.url), 'utf8'),
    Promise.all([
      'website-handlers.ts', 'everything-handlers.ts', 'settings-handlers.ts', 'translation-handlers.ts',
      'plugin-handlers.ts', 'plugin-catalog-handlers.ts', 'window-handlers.ts',
    ].map(name => readFile(new URL(`./${name}`, import.meta.url), 'utf8'))),
  ])
  assert.match(main, /registerManagerInvokeHandlers\(ipcMain,\s*context => isCurrentWindowMainFrame\(context, managerWindow\)/)
  assert.match(main, /registerManagerEventHandlers\(ipcMain,\s*context => isCurrentWindowMainFrame\(context, managerWindow\)/)
  assert.match(main, /const nativePipeAuthenticationToken = process\.env\.WEBTOOLS_NATIVE_PIPE_TOKEN/)
  assert.match(main, /new NativeManagerClient\(nativePipeName, nativePipeAuthenticationToken, true, true\)/)
  assert.match(main, /delete process\.env\.WEBTOOLS_NATIVE_PIPE\s+delete process\.env\.WEBTOOLS_NATIVE_PIPE_TOKEN/)
  assert.ok(main.indexOf('delete process.env.WEBTOOLS_NATIVE_PIPE_TOKEN') < main.indexOf('app.whenReady()'), 'pipe credentials must be removed before any BrowserWindow renderer is created')
  for (const source of sources) assert.match(source, /(?:createManagerInvokeRegistry|registerManagerInvokeHandlers|registerManagerEventHandlers)\(/)
  assert.doesNotMatch(main, /ipcMain\.handle\s*\(/)
  assert.doesNotMatch(main, /ipcMain\.on\s*\(/)
})
