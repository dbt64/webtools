import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createConnection, createServer } from 'node:net'
import { createInterface } from 'node:readline'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createDefaultAppData } from '../src/shared/domain.ts'
import { createDefaultTranslation2WorkspaceSettings } from '../src/shared/translation2-contracts.ts'

// Drives one actual Native Launcher request into a cold packaged Electron Host.
// Uses a fresh TEMP profile and its own pipe/debug port; no production install.
// The optional plugin case seeds a local, capability-free package in TEMP only.
const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1])
assert.ok(isAbsolute(args.get('--application') ?? ''), '--application must be an absolute packaged application directory')
const application = resolve(args.get('--application'))
const entry = args.get('--entry') ?? 'prefill'
const repeats = Number(args.get('--repeat') ?? 1)
assert.ok(['prefill', 'feature', 'panel', 'page', 'plugin'].includes(entry))
assert.ok(Number.isInteger(repeats) && repeats > 0 && repeats <= 20)
const root = await mkdtemp(join(tmpdir(), 'webtools-translation-cold-start-'))
const profile = join(root, 'profile'); await mkdir(profile)
const pluginRef = { pluginId: 'org.example.cold-window', featureId: 'hello' }
if (entry === 'plugin') {
  const { PluginManager } = await import('../electron/plugins/plugin-manager.ts')
  const { runtimeV3Manifest, runtimeV3Package } = await import('../electron/plugins/fixtures.mjs')
  const manager = new PluginManager({ userData: profile, hostVersion: '0.1.0', confirm: async () => true,
    externalOpen: async () => {}, clipboardWrite() {}, ai: { complete: async () => ({ text: 'unused' }), getDefaultProviderInfo: async () => ({ providerName: 'unused', model: 'unused' }) } })
  try {
    await manager.initialize()
    const manifest = runtimeV3Manifest({ id: pluginRef.pluginId, name: 'Cold Plugin', features: [{ id: 'hello', title: 'Cold Plugin',
      commands: ['Cold Plugin'], acceptedContexts: [{ type: 'none', sources: [] }], presentation: { type: 'window' },
      entry: { kind: 'web-bundle', document: 'web/index.html' }, requiredCapabilities: [] }] })
    await manager.install(runtimeV3Package(manifest, [{ name: 'web/index.html', data: '<!doctype html><title>Cold Plugin</title><main id="cold-plugin">Cold plugin ready</main>' }]), manager.session)
    await manager.setEnabled(pluginRef.pluginId, true, manager.session)
  } finally { manager.close() }
}
const source = 'Cold start lifecycle fixture'
const data = createDefaultAppData()
data.settings.sharedAI = { defaultProviderId: 'custom', providers: { custom: { model: 'local-unconfigured-fixture', baseUrl: 'http://127.0.0.1:1/v1' } } }
data.settings.translation2 = createDefaultTranslation2WorkspaceSettings()
data.settings.translation2.selectedService = { kind: 'ai', providerId: 'custom' }
data.settings.translation2.visibleWebsiteIds = []
await writeFile(join(profile, 'nook-data.json'), JSON.stringify(data))
await writeFile(join(profile, 'launcher-state.json'), JSON.stringify({ schemaVersion: 1, quickSearchShortcut: 'Control+Alt+Shift+F11',
  theme: 'light', launcherDisplayMode: 'compact', launchOnStartup: false, searchEngines: data.settings.searchEngines,
  defaultSearchEngineId: 'google', everythingEnabled: false, everythingEsPath: '', websites: [], appSearchMemory: [] }))
await writeFile(join(profile, 'catalog.json'), JSON.stringify({ schemaVersion: 1, generatedAtUtc: new Date().toISOString(), apps: [] }))
await writeFile(join(profile, 'feature-projection-v2.json'), JSON.stringify({ projectionVersion: 2, hostSessionId: randomUUID(), revision: 1, generatedAtUnixMs: Date.now(), features: [{
  ref: { pluginId: 'webtools.translation', featureId: 'translate-text' }, pluginName: '翻译', title: '翻译', commands: ['Translation', 'Translate'],
  acceptedContexts: [{ type: 'text', sources: ['launcher-input', 'selected-text'] }], iconToken: 'translate', featureKind: 'built-in', group: 'plugin-features',
}] }))
if (entry === 'plugin') await writeFile(join(profile, 'feature-projection-v2.json'), JSON.stringify({ projectionVersion: 2, hostSessionId: randomUUID(), revision: 1, generatedAtUnixMs: Date.now(), features: [{
  ref: pluginRef, pluginName: 'Cold Plugin', title: 'Cold Plugin', commands: ['Cold Plugin'], acceptedContexts: [{ type: 'none', sources: [] }],
  presentation: 'window', iconToken: 'plugin', featureKind: 'runtime-v3', group: 'plugin-features',
}] }))
await writeFile(join(profile, 'super-panel-state.json'), JSON.stringify({ schemaVersion: 2, enabled: true, mouseButton: 'middle', gesture: 'hold', holdMilliseconds: 600,
  autoTranslationPreview: false, pinned: [{ pluginId: 'webtools.translation', featureId: 'translate-text' }] }))
const portServer = createServer(); portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening')
const port = portServer.address().port; await new Promise(done => portServer.close(done))
const pipe = `WebTools.NativeHost.Resource.Cold_${randomUUID().replaceAll('-', '')}`
const report = { application, root, entry, phase: 'STARTING', cases: [], startedAt: new Date().toISOString() }
const save = () => writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2))
const pause = ms => new Promise(done => setTimeout(done, ms))
let native, socket, input, probe
const probeRequests = []
async function inventory() {
  const result = new Promise((ok, fail) => { const timer = setTimeout(() => fail(new Error('Window probe timed out')), 10000); probeRequests.push({ ok: value => { clearTimeout(timer); value.ok ? ok(value.processes) : fail(new Error(value.error)) } }) })
  probe.stdin.write('{"type":"scan"}\n'); return result
}
const pending = []
function nextLine(timeout = 15000) { return new Promise((ok, fail) => {
  const timer = setTimeout(() => { const index = pending.indexOf(task); if (index >= 0) pending.splice(index, 1); fail(new Error('Resource control timed out')) }, timeout)
  const task = { ok: value => { clearTimeout(timer); ok(value) }, fail: error => { clearTimeout(timer); fail(error) } }; pending.push(task)
}) }
async function connect() {
  for (let i = 0; i < 150; i++) {
    if (native.exitCode !== null) throw new Error(`Isolated NativeHost exited during startup (${native.exitCode})`)
    const candidate = createConnection(`\\\\.\\pipe\\${pipe}`)
    try {
      await Promise.race([once(candidate, 'connect'), pause(500).then(() => { throw new Error('connect timeout') })])
      socket = candidate; input = createInterface({ input: socket })
      input.on('line', raw => { const task = pending.shift(); if (task) { try { task.ok(JSON.parse(raw)) } catch (error) { task.fail(error) } } })
      socket.on('error', () => {})
      assert.equal((await nextLine(90000)).processId, native.pid); return
    } catch { candidate.destroy(); await pause(100) }
  }
  throw new Error('Native control unavailable')
}
async function control(value) { const response = nextLine(); socket.write(`${JSON.stringify(value)}\n`); const result = await response; assert.equal(result.ok, true, JSON.stringify(result)); return result }
async function targets() {
  try { return await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) })).json() } catch { return [] }
}
async function cdp(url, method, params = {}) {
  const ws = new WebSocket(url)
  await once(ws, 'open')
  try {
    const response = new Promise((ok, fail) => {
      const timer = setTimeout(() => fail(new Error(`CDP ${method} timed out`)), 8000)
      ws.addEventListener('close', () => { if (method === 'Browser.close') { clearTimeout(timer); ok({}) } })
      ws.addEventListener('message', ({ data }) => { const value = JSON.parse(data); if (value.id === 1) { clearTimeout(timer); value.error ? fail(new Error(value.error.message)) : ok(value.result) } })
    })
    ws.send(JSON.stringify({ id: 1, method, params })); return await response
  } finally { ws.close() }
}
async function closeBrowser() {
  try { const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); await cdp(info.webSocketDebuggerUrl, 'Browser.close') } catch {}
}
const activation = entry === 'plugin' ? { type: 'launcher-feature', ...pluginRef, query: 'Cold Plugin' }
  : entry === 'feature' ? { type: 'launcher-feature', pluginId: 'webtools.translation', featureId: 'translate-text', query: 'Translation' }
  : entry === 'panel' ? { type: 'quick-result-invoke', pluginId: 'webtools.translation', featureId: 'translate-text', text: source }
  : entry === 'page' ? { type: 'manager-open', section: 'translate' } : { type: 'manager-translation', text: source }
try {
  probe = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./measure-plugin-runtime-processes.ps1', import.meta.url)),
    '-TestRoot', root, '-NativeRoot', application, '-ManagerRoot', join(application, 'Manager')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  createInterface({ input: probe.stdout }).on('line', raw => { const task = probeRequests.shift(); if (task) task.ok(JSON.parse(raw)) })
  probe.stderr.on('data', () => {})
  assert.equal((await inventory()).length, 0, 'This isolated application already has live processes')
  const env = { ...process.env, WEBTOOLS_MANAGER_EXE: join(application, 'Manager/WebTools.exe'), WEBTOOLS_MANAGER_TEST_DEBUG_PORT: String(port), WEBTOOLS_SUPER_PANEL_ACCEPTANCE: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  native = spawn(join(application, 'WebTools.NativeHost.exe'), ['--phase4e-resource-test', profile, join(profile, 'catalog.json'), pipe, 'Control+Alt+Shift+F11'], { env, windowsHide: true, stdio: 'ignore' })
  await connect()
  for (let iteration = 0; iteration < repeats; iteration++) {
  assert.equal((await control({ type: 'manager-state' })).manager.processId, null, 'Electron must initially be absent')
  const item = { iteration: iteration + 1 }; report.cases.push(item)
  const started = performance.now()
  await control(activation)
  let translation, firstTargetMs
  for (let i = 0; i < 120; i++) {
    const rows = await targets()
    if (rows.length && firstTargetMs === undefined) firstTargetMs = Math.round(performance.now() - started)
    assert.equal(rows.some(row => row.type === 'page' && row.url.startsWith('file:') && /\/index\.html$/.test(row.url)), false, 'Translation entry created a Manager page')
    translation = rows.find(row => row.type === 'page' && (entry === 'plugin' ? row.url.startsWith('webtools-plugin:') : /\/translation\.html$/.test(row.url)))
    if (translation) break
    await pause(100)
  }
  item.firstClick = { firstTargetMs, translationTargetMs: translation ? Math.round(performance.now() - started) : null,
    state: (await control({ type: 'manager-state' })).manager, targetCount: (await targets()).length }
  if (!translation) {
    await control(activation)
    for (let i = 0; i < 100; i++) { translation = (await targets()).find(row => row.type === 'page' && /\/translation\.html$/.test(row.url)); if (translation) break; await pause(100) }
    item.secondClickOpened = Boolean(translation)
    assert.fail('First cold click did not create Translation; secondClickOpened=' + item.secondClickOpened)
  }
  let ready = false
  const presentationDeadline = performance.now() + 10000
  while (performance.now() < presentationDeadline) {
    const expected = ['feature', 'page'].includes(entry) ? '' : source
    const expression = entry === 'plugin'
      ? `JSON.stringify({ ready: !!document.querySelector('#cold-plugin'), sourceMatches: true, visibility: document.visibilityState, focused: document.hasFocus() })`
      : `JSON.stringify({ ready: !!document.querySelector('.translation-shell'), sourceMatches: document.querySelector('textarea')?.value === ${JSON.stringify(expected)}, visibility: document.visibilityState, focused: document.hasFocus() })`
    const result = await cdp(translation.webSocketDebuggerUrl, 'Runtime.evaluate', { expression, returnByValue: true })
    item.presentation = JSON.parse(result.result.value)
    const main = (await inventory()).find(row => row.pid === item.firstClick.state.processId)
    item.presentation.nativeVisibleWindowCount = main?.windows.length ?? 0
    if (item.presentation.ready && item.presentation.sourceMatches && item.presentation.nativeVisibleWindowCount > 0) { ready = true; break }
    await pause(100)
  }
  if (!ready) {
    await control(activation)
    const main = (await inventory()).find(row => row.pid === item.firstClick.state.processId)
    item.secondClickVisibleWindowCount = main?.windows.length ?? 0
  }
  assert.equal(ready, true, 'First cold request did not create a visible native Translation window')
  item.renderedMs = Math.round(performance.now() - started)
  if (args.get('--check-layout') === 'true' && entry !== 'plugin') {
    await cdp(translation.webSocketDebuggerUrl, 'Runtime.evaluate', { expression: `document.querySelector('[aria-label="翻译服务设置"]').click()` })
    await cdp(translation.webSocketDebuggerUrl, 'Runtime.evaluate', { expression: `document.querySelector('.service-panel > button').click()` })
    const layout = await cdp(translation.webSocketDebuggerUrl, 'Runtime.evaluate', { expression: `JSON.stringify((() => { const sections = [...document.querySelectorAll('.catalog-section')]; const grid = document.querySelector('.catalog'); const action = document.querySelector('.catalog-option-action'); return { sectionCount: sections.length, stacked: sections[1].getBoundingClientRect().top > sections[0].getBoundingClientRect().bottom, columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length, actionFont: parseFloat(getComputedStyle(action).fontSize), nameFont: parseFloat(getComputedStyle(document.querySelector('.catalog-option-name')).fontSize), scroll: getComputedStyle(document.querySelector('.catalog-sections')).overflowY } })())`, returnByValue: true })
    item.layout = JSON.parse(layout.result.value)
    assert.equal(item.layout.stacked, true); assert.equal(item.layout.columns, 2)
    assert.ok(item.layout.actionFont < item.layout.nameFont); assert.equal(item.layout.scroll, 'auto')
    const screenshot = await cdp(translation.webSocketDebuggerUrl, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(join(root, 'service-grid.png'), Buffer.from(screenshot.data, 'base64'))
  }
  if (args.get('--check-close') === 'true' && entry !== 'plugin') {
    await cdp(translation.webSocketDebuggerUrl, 'Runtime.evaluate', { expression: 'setTimeout(() => { void window.translation2.close() }, 0)' })
  } else await closeBrowser()
  const closeDeadline = performance.now() + 5000
  let remaining
  do { remaining = (await inventory()).filter(row => row.role !== 'native'); if (!remaining.length) break; await pause(100) } while (performance.now() < closeDeadline)
  item.closedState = { remainingElectronProcesses: remaining.length }
  assert.equal(remaining.length, 0, 'Last Translation window closed but the surface-less Electron Host stayed alive')
  await save()
  }
  report.phase = 'PASS'
} catch (error) { report.phase = 'FAIL'; report.error = error.message; process.exitCode = 1 }
finally {
  await save()
  await closeBrowser()
  if (socket && !socket.destroyed) try { await control({ type: 'exit' }) } catch {}
  socket?.destroy()
  probe?.stdin.end()
  if (native && native.exitCode === null) { await Promise.race([once(native, 'exit'), pause(10000)]); if (native.exitCode === null) native.kill() }
  console.log(JSON.stringify({ phase: report.phase, error: report.error, cases: report.cases, report: join(root, 'report.json') }, null, 2))
}
