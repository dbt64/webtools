import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer as createHttpServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { createConnection, createServer } from 'node:net'
import { createInterface } from 'node:readline'
import { copyFile, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDefaultAppData } from '../src/shared/domain.ts'
import { validatePackageV3ForRuntime } from '../electron/plugins/package-validator.ts'
import { ThemeAcceptanceOwnership } from './lib/plugin-theme-acceptance-ownership.mjs'

// Opt-in isolated test tooling. Synthetic selections enter the existing WPF
// control seam; execution still uses real projection, authority, Utility and Pipe.
const repo = resolve(fileURLToPath(new URL('..', import.meta.url)))
const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  assert.ok(process.argv[i].startsWith('--') && process.argv[i + 1]); args.set(process.argv[i].slice(2), process.argv[i + 1])
}
const required = name => { const value = args.get(name); assert.ok(value, `Missing --${name}`); return value }
const within = (parent, child) => { const rel = relative(parent, child); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`) }
async function tempPath(path, directory = true) {
  assert.ok(isAbsolute(path)); const temp = await realpath(tmpdir()); const full = resolve(path)
  assert.ok(within(temp, full) && temp.toLowerCase() !== full.toLowerCase(), 'Strict TEMP descendant required')
  let current = temp
  for (const part of relative(temp, full).split(sep)) { current = join(current, part); assert.equal((await lstat(current)).isSymbolicLink(), false) }
  assert.equal((await realpath(full)).toLowerCase(), full.toLowerCase()); assert.equal((await lstat(full)).isDirectory(), directory)
  return full
}
const root = await tempPath(required('root')); const nativeRoot = await tempPath(required('native-root')); const managerRoot = await tempPath(required('manager-root'))
const nativeExe = await tempPath(join(nativeRoot, 'WebTools.NativeHost.exe'), false); const managerExe = await tempPath(join(managerRoot, 'WebTools.exe'), false)
const fixture = resolve(required('package')); assert.equal((await lstat(fixture)).isFile(), true)
const id = 'org.webtools.selected-text-actions'
const checked = await validatePackageV3ForRuntime(await readFile(fixture), '0.1.0'); assert.equal(checked.manifest.id, id)
const ownership = new ThemeAcceptanceOwnership(nativeExe, managerExe)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const translationSink = { requests: 0 }
const sink = createHttpServer((request, response) => {
  request.setTimeout(5000); let bytes = 0; const chunks = []
  request.on('data', chunk => { bytes += chunk.length; if (bytes > 65536) request.destroy(); else chunks.push(chunk) })
  request.on('end', () => {
    let body
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); assert.ok(Array.isArray(body.messages) && typeof body.messages.at(-1)?.content === 'string') }
    catch { response.writeHead(400); response.end(); return }
    translationSink.requests++; translationSink.lastInputSha256 = hash(body.messages.at(-1).content)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: 'Controlled local translation response' } }] }))
  })
})
sink.listen(0, '127.0.0.1'); await once(sink, 'listening')
const windowFixture = resolve(required('window-package'))
const profile = join(root, 'profile'); await mkdir(profile); await mkdir(join(root, 'fixtures'))
for (const name of ['fixture', 'update', 'isolation']) await copyFile(name === 'update' ? windowFixture : fixture, join(root, 'fixtures', `plugin-runtime-${name}.wtplugin`))
const data = createDefaultAppData(); data.settings.quickSearchShortcut = 'Control+Alt+Shift+F12'; data.settings.theme = 'light'
data.settings.translation.engine = 'ai'
data.settings.sharedAI = { defaultProviderId: 'custom', providers: { custom: { model: 'isolated-local-stub', baseUrl: 'http://127.0.0.1:' + sink.address().port + '/v1' } } }
await writeFile(join(profile, 'nook-data.json'), JSON.stringify(data))
await writeFile(join(profile, 'launcher-state.json'), JSON.stringify({ schemaVersion: 1, quickSearchShortcut: data.settings.quickSearchShortcut,
  theme: 'light', launcherDisplayMode: 'compact', launchOnStartup: false, searchEngines: data.settings.searchEngines,
  defaultSearchEngineId: 'google', everythingEnabled: false, everythingEsPath: '', websites: [], appSearchMemory: [] }))
await writeFile(join(profile, 'catalog.json'), JSON.stringify({ schemaVersion: 1, generatedAtUtc: new Date().toISOString(), apps: [] }))
await writeFile(join(profile, 'super-panel-state.json'), JSON.stringify({ schemaVersion: 2, enabled: true, mouseButton: 'middle', gesture: 'hold', holdMilliseconds: 600,
  pinned: [{ pluginId: 'webtools.translation', featureId: 'translate-text' }] }))
const controls = async selected => writeFile(join(profile, 'plugin-runtime-controls.json'), JSON.stringify({ package: selected, deleteData: true }))
await controls('fixture')
await mkdir(join(root, 'evidence'))
const evidence = join(root, 'evidence/selected-text-parity.json')
const report = { status: 'IN_PROGRESS', startedAt: new Date().toISOString(), sourceHead: args.get('source-head'),
  artifacts: { nativeExe, managerExe, nativeSha256: hash(await readFile(nativeExe)), nativeDllSha256: hash(await readFile(join(nativeRoot, 'WebTools.NativeHost.dll'))),
    managerSha256: hash(await readFile(managerExe)), asarSha256: hash(await readFile(join(managerRoot, 'resources/app.asar'))), packageSha256: hash(await readFile(fixture)), windowPackageSha256: hash(await readFile(windowFixture)),
    plugin: { id, version: checked.manifest.version, manifestVersion: 3, apiMajor: 1 } }, cases: [],
  manual: ['New matching actions with physical selection and mouse activation', 'Actual system-browser external open', 'Additional monitor/DPI visual combinations'].map(name => ({ name, status: 'MANUAL VERIFICATION REQUIRED' })) }
const save = () => writeFile(evidence, `${JSON.stringify(report, null, 2)}\n`)
const pause = ms => new Promise(done => setTimeout(done, ms))
let interrupted = false; let native; let probe; let socket; let reader; let manager
const pendingProbes = []; const connections = new Set(); const pendingSockets = new Set()
function interrupt() { interrupted = true; for (const cdp of connections) cdp.close(); for (const candidate of pendingSockets) candidate.destroy(); socket?.destroy() }
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt)
async function until(read, accepts, label, timeout = 30_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { assert.equal(interrupted, false, 'Interrupted'); const value = await read(); if (accepts(value)) return value; await pause(100) }
  throw new Error(`Timed out: ${label}`)
}
async function inventory(type = 'scan', identity) {
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('Identity probe timed out')), 15_000)
    pendingProbes.push({ ok: value => { clearTimeout(timer); if (!value.ok) { fail(new Error(value.error)); return } ownership.observe(value.processes); ok(value.processes) }, fail: error => { clearTimeout(timer); fail(error) } })
    probe.stdin.write(`${JSON.stringify({ type, pid: identity?.pid, created: identity?.created })}\n`)
  })
}
const electrons = rows => rows.filter(row => row.path?.toLowerCase().startsWith(`${managerRoot}${sep}`.toLowerCase()))
const managerIdentity = rows => ownership.live(rows).find(row => row.role === 'main')
const pipe = `WebTools.NativeHost.Resource.6G2_${randomUUID().replaceAll('-', '')}`
function nextLine(input, timeout = 20_000) {
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => { cleanup(); fail(new Error('Control response timeout')) }, timeout)
    const cleanup = () => { clearTimeout(timer); input.off('line', line); input.off('close', close) }
    const line = raw => { cleanup(); try { ok(JSON.parse(raw)) } catch (error) { fail(error) } }
    const close = () => { cleanup(); fail(new Error('Control disconnected')) }
    input.once('line', line); input.once('close', close)
  })
}
async function connectControl() {
  await until(async () => {
    const candidate = createConnection(`\\\\.\\pipe\\${pipe}`); pendingSockets.add(candidate)
    try {
      await new Promise((ok, fail) => { const timer = setTimeout(() => { candidate.destroy(); fail(new Error('Connect timeout')) }, 1500); candidate.once('connect', () => { clearTimeout(timer); ok() }); candidate.once('error', error => { clearTimeout(timer); fail(error) }) })
      const input = createInterface({ input: candidate }); const hello = await nextLine(input, 60_000)
      assert.equal(hello.processId, native.pid); assert.equal(hello.ok, true); socket = candidate; reader = input; return true
    } catch { candidate.destroy(); return false } finally { pendingSockets.delete(candidate) }
  }, Boolean, 'Native resource pipe', 90_000)
}
async function control(value) { const response = nextLine(reader); socket.write(`${JSON.stringify(value)}\n`); const result = await response; assert.equal(result.ok, true, result.error); assert.equal(result.processId, native.pid); return result }
const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port; await new Promise(done => server.close(done))
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); connections.add(this)
    ws.addEventListener('message', ({ data }) => { const value = JSON.parse(data); const task = this.pending.get(value.id); if (!task) return; this.pending.delete(value.id); clearTimeout(task.timer); value.error ? task.fail(new Error(value.error.message)) : task.ok(value.result) })
    ws.addEventListener('close', () => { for (const task of this.pending.values()) { clearTimeout(task.timer); task.fail(new Error('CDP closed')) } this.pending.clear() })
  }
  call(method, params = {}) { return new Promise((ok, fail) => { const id = ++this.id; const timer = setTimeout(() => { this.pending.delete(id); fail(new Error(`CDP timeout: ${method}`)) }, 20_000); this.pending.set(id, { ok, fail, timer }); this.ws.send(JSON.stringify({ id, method, params })) }) }
  async evaluate(expression) { const value = await this.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!value.exceptionDetails, JSON.stringify(value.exceptionDetails)); return value.result?.value }
  close() { this.ws.close(); connections.delete(this) }
}
async function openManager() {
  await control({ type: 'manager-open', section: 'settings' })
  const target = await until(async () => { try { return (await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) })).json()).find(t => t.type === 'page' && t.url.endsWith('/out/renderer/index.html')) } catch { return null } }, Boolean, 'Manager target')
  const ws = new WebSocket(target.webSocketDebuggerUrl); await Promise.race([once(ws, 'open'), pause(5000).then(() => { throw new Error('CDP connection timeout') })]); manager = new CDP(ws)
  await manager.call('Runtime.enable')
  await until(() => manager.evaluate('!!window.desktop && document.readyState === "complete"'), Boolean, 'Manager ready')
  return manager
}
async function api(expression) { const value = await manager.evaluate(expression); assert.equal(value?.ok, true, JSON.stringify(value)); return value.data }
async function closeManager() {
  const identity = managerIdentity(await inventory()); assert.ok(identity)
  manager?.close(); manager = null; await inventory('close', identity)
  await until(inventory, rows => electrons(rows).length === 0, 'exact-path Electron group exited', 30_000)
  assert.equal((await control({ type: 'super-panel-state' })).processId, native.pid)
}
const panel = async () => { const value = (await control({ type: 'super-panel-state' })).panel; report.lastPanel = value; return value }
const invoke = async (featureId, text, pluginId = id, previewOnly = false) => until(async () => {
  try { return await control({ type: 'quick-result-invoke', pluginId, featureId, text, previewOnly }) }
  catch (error) { if (/InvalidOperationException/.test(error.message)) return null; throw error }
}, Boolean, 'current matching Feature', 8000)
const commandChildren = rows => electrons(rows).filter(row => row.role === 'utility' && /node\.mojom\.NodeService/.test(row.commandLine ?? ''))
const noUtility = () => until(inventory, rows => commandChildren(rows).length === 0, 'command Utility process cleanup')
async function test(name, category, action) {
  console.log(`[selected-text-parity] ${name}`)
  const item = { name, category, status: 'IN_PROGRESS' }; report.cases.push(item); await save()
  try {
    const details = await action()
    const nativeWindows = ownership.live(await inventory()).filter(row => row.role === 'native').flatMap(row => row.windows ?? [])
    assert.equal(nativeWindows.filter(window => window.title === 'WebTools').length, 0, 'Quick Result must not leave a native error dialog')
    Object.assign(item, { status: 'PASS', nativeErrorDialogCount: 0, ...details }); await save()
  }
  catch (error) {
    item.status = 'FAIL'; item.error = error.message.slice(0, 300)
    if (manager) try { item.diagnostics = await manager.evaluate('window.desktop.pluginDevelopment.get().then(r=>r.data?.diagnostics.map(d=>({code:d.code,phase:d.phase,moduleMissing:/Cannot find module/.test(d.message),apiUnavailable:/does not provide|not a function|undefined/.test(d.message),invalidRequest:/INVALID_REQUEST/.test(d.message),urlUnavailable:/URL is not defined/.test(d.message),permissionDenied:/PERMISSION_DENIED/.test(d.message),notAvailable:/NOT_AVAILABLE/.test(d.message),pathTooLong:/ENAMETOOLONG/.test(d.message)})))') } catch {}
    await save(); throw error
  }
}
try {
  await save()
  probe = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(repo, 'scripts/measure-plugin-runtime-processes.ps1'), '-TestRoot', root, '-NativeRoot', nativeRoot, '-ManagerRoot', managerRoot], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  probe.stderr.on('data', () => {})
  createInterface({ input: probe.stdout }).on('line', line => { const task = pendingProbes.shift(); if (task) { try { task.ok(JSON.parse(line)) } catch (error) { task.fail(error) } } })
  for (const event of ['error', 'exit']) probe.on(event, () => { for (const task of pendingProbes.splice(0)) task.fail(new Error('Identity probe stopped')) })
  assert.equal((await inventory()).length, 0, 'Isolated binaries already running: refusing ownership')
  const env = { ...process.env, WEBTOOLS_MANAGER_EXE: managerExe, WEBTOOLS_MANAGER_TEST_DEBUG_PORT: String(port), WEBTOOLS_SUPER_PANEL_ACCEPTANCE: '1',
    WEBTOOLS_PLUGIN_RUNTIME_ACCEPTANCE: '1', WEBTOOLS_PLUGIN_RUNTIME_TEST_ROOT: root, WEBTOOLS_PLUGIN_RUNTIME_TEST_PROFILE: profile, WEBTOOLS_PLUGIN_RUNTIME_TEST_DEBUG_PORT: String(port) }
  delete env.ELECTRON_RUN_AS_NODE
  native = spawn(nativeExe, ['--phase4e-resource-test', profile, join(profile, 'catalog.json'), pipe, 'Control+Alt+Shift+F12'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  native.stdout.on('data', () => {}); native.stderr.on('data', () => {})
  await until(async () => ownership.claimNative(await inventory(), native.pid, process.pid), Boolean, 'Native process identity')
  report.nativeIdentity = ownership.identities.get(native.pid); await connectControl()
  await test('cold Native-only', 'REAL PACKAGED', async () => { assert.equal(electrons(await inventory()).length, 0); return { electronCount: 0 } })

  await openManager()
  await api('window.desktop.pluginDevelopment.setEnabled(true)')
  await api('window.desktop.pluginCatalog.setEnabled({kind:"builtin",id:"webtools.translation"},true)')
  await api('window.desktop.plugins.installFromUserDialog()')
  await api('window.desktop.plugins.setEnabled(' + JSON.stringify(id) + ',true)')
  const effectsNow = async () => JSON.parse(await readFile(join(profile, 'plugin-runtime-effects.json'), 'utf8'))
  const refKey = row => (row.pluginId ?? row.PluginId) + '/' + (row.featureId ?? row.FeatureId)
  const preview = async text => {
    let rePresented = 0
    await invoke('search-selection', text, id, true)
    return until(async () => {
      const value = await panel()
      // A transient popup can legitimately be dismissed by desktop activity.
      // Retry only a cleared/hidden preview, never a visible clipped list or an action.
      if (!value.visible && value.transientCleared) {
        if (++rePresented > 2) throw new Error('INCONCLUSIVE: desktop repeatedly dismissed the isolated preview')
        report.previewDismissals = (report.previewDismissals ?? 0) + 1; await save()
        await invoke('search-selection', text, id, true)
      }
      return value
    }, value => value.visible && value.mode === 'SelectedText' && value.firstActionVisible, 'first complete action in WPF viewport')
  }
  await invoke('search-selection', 'projection readiness', id, true)
  await until(panel, value => value.actionRefs.map(refKey).includes(id + '/search-selection'), 'Native received current installed projection', 8000)
  await test('real example installed; local action discovery never invokes a provider or external effect', 'ISOLATED PACKAGED PASS', async () => {
    const cases = [['English short', false], ['中文选区', false], ['Mixed 中文 🙂', false], ['!?', false], ['long '.repeat(500), false], ['https://example.com/a?q=x', true], ['https://user:password@example.com', false]]
    for (const [text, url] of cases) {
      const value = await preview(text); const refs = value.actionRefs.map(refKey)
      assert.ok(refs.includes('webtools.translation/translate-text'), 'General Translation disappeared')
      assert.ok(refs.includes(id + '/search-selection'), 'General search action disappeared')
      assert.ok(refs.includes(id + '/open-selected-link') === url, 'Content-specific eligibility differs from approved matrix')
      assert.ok(value.actionScrollOffset === 0 && value.firstActionVisible, 'First action is scrolled or clipped')
    }
    assert.equal((await effectsNow()).externalOpenCount, 0); assert.equal(translationSink.requests, 0)
    await noUtility()
    return { selections: cases.length, localOnly: true, firstActionVisible: true }
  })
  await test('no-selection still presents default shortcut board without selected-text actions', 'ISOLATED PACKAGED PASS', async () => {
    await invoke('search-selection', '', id, true)
    const value = await until(panel, value => value.visible && value.mode === 'NoContext', 'NoContext board')
    assert.equal(value.actionCount, 0); assert.equal(value.hasQuickResult, false)
    return { mode: value.mode, selectedTextActionCount: value.actionCount }
  })
  await test('installed action discovery works with NativeHost alone and never starts Electron', 'ISOLATED PACKAGED PASS', async () => {
    await closeManager()
    const value = await preview('https://example.com/native-only')
    assert.ok(value.actionRefs.map(refKey).includes(id + '/open-selected-link'))
    assert.equal(electrons(await inventory()).length, 0)
    assert.equal(translationSink.requests, 0)
    await openManager(); await api('window.desktop.pluginDevelopment.setEnabled(true)')
    return { electronCountDuringDiscovery: 0, matchedLink: true, translationRequests: 0 }
  })
  await test('real search command uses public SDK and bounded Host external-open effect', 'ISOLATED PACKAGED PASS', async () => {
    const text = 'selected 中文 & A'; const url = new URL('https://www.bing.com/search'); url.searchParams.set('q', text)
    await invoke('search-selection', text)
    const value = await until(effectsNow, value => value.externalOpenCount === 1, 'external-open effect')
    assert.ok(value.externalUrlSha256 === hash(url.href), 'Encoded search URL changed')
    await noUtility(); return { externalOpenCount: value.externalOpenCount, urlSha256: value.externalUrlSha256, osBrowser: 'STUBBED' }
  })
  await test('real open-link command opens only an applicable selected URL', 'ISOLATED PACKAGED PASS', async () => {
    const text = 'https://example.com/path?q=x'
    await invoke('open-selected-link', text)
    const value = await until(effectsNow, value => value.externalOpenCount === 2, 'second external-open effect')
    assert.ok(value.externalUrlSha256 === hash(text), 'Selected URL changed')
    await noUtility(); return { externalOpenCount: value.externalOpenCount, urlSha256: value.externalUrlSha256, osBrowser: 'STUBBED' }
  })
  await test('projection refresh preserves current match behavior and returns list to the top', 'ISOLATED PACKAGED PASS', async () => {
    await preview('https://example.com/')
    await api('window.desktop.plugins.setEnabled(' + JSON.stringify(id) + ',false)')
    await until(panel, value => !value.actionRefs.map(refKey).some(key => key.startsWith(id + '/')), 'disabled actions removed')
    await api('window.desktop.plugins.setEnabled(' + JSON.stringify(id) + ',true)')
    const value = await until(panel, value => value.actionRefs.map(refKey).includes(id + '/open-selected-link'), 'matching action restored')
    assert.equal(value.actionScrollOffset, 0)
    return { scrollOffset: value.actionScrollOffset, refreshed: true }
  })
  await controls('update'); await api('window.desktop.plugins.installFromUserDialog()')
  const windowId = 'org.webtools.acceptance.runtime'; await api('window.desktop.plugins.setEnabled(' + JSON.stringify(windowId) + ',true)')
  let plugin
  const openPlugin = async () => {
    const target = await until(async () => (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find(t => t.type === 'page' && t.url.startsWith('webtools-plugin://')), Boolean, 'independent plugin target')
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await Promise.race([once(ws, 'open'), pause(5000).then(() => { throw new Error('Plugin CDP connection timeout') })]); plugin = new CDP(ws)
    await plugin.call('Runtime.enable')
    await until(() => plugin.evaluate('window.__parityReady === true'), Boolean, 'public context API ready'); return target.id
  }
  const contextHash = () => plugin.evaluate('(async()=>{const c=await window.__parityAPI.context.current({signal:AbortSignal.timeout(5000)}); if(!c)return null; const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(c.text));return {type:c.type,source:c.source,hash:Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,"0")).join("")}})()')
  await test('independent real plugin Window receives exact current selection and reuses its window', 'ISOLATED PACKAGED PASS', async () => {
    const stage = async value => { report.windowAcceptanceStage = value; await save() }
    await stage('invoke first Window')
    const first = 'exact first selection 中文 🙂'; await invoke('context-window', first, windowId)
    await stage('wait public SDK readiness')
    const targetId = await openPlugin()
    await stage('first context.current')
    const initial = await contextHash()
    assert.ok(initial?.hash === hash(first) && initial.type === 'text' && initial.source === 'selected-text', 'Window context differs')
    await stage('invoke replacement Window')
    const second = 'replacement selected text'; await invoke('context-window', second, windowId)
    await stage('replacement context.current')
    await until(contextHash, value => value?.hash === hash(second), 'replacement context')
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()
    assert.equal(targets.filter(t => t.id === targetId).length, 1)
    await stage('disable Window')
    plugin.close(); plugin = null; await api('window.desktop.plugins.setEnabled(' + JSON.stringify(windowId) + ',false)')
    await until(async () => (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()), values => !values.some(t => t.id === targetId), 'disabled Window closes')
    return { exactContext: true, replacementContext: true, reusedTarget: true, revokedWindowClosed: true }
  })
  await api('window.desktop.saveAIProviderKey("custom", "isolated-free-stub-no-real-secret")')
  await test('explicit built-in Translation reaches Manager and its existing auto-schedule uses only local stub', 'ISOLATED PACKAGED PASS', async () => {
    const text = 'exact Translation handoff 中文'; const before = translationSink.requests; const began = Date.now()
    await invoke('translate-text', text, 'webtools.translation')
    await until(() => manager.evaluate('(async()=>{const e=document.querySelector(".translation-pane textarea");if(!e)return null;const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(e.value));return Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,"0")).join("")})()'), value => value === hash(text), 'exact Manager prefill')
    await until(() => translationSink.requests, value => value === before + 1, 'existing configured Translation scheduling')
    const value = await panel(); assert.equal(value.hasQuickResult, false)
    return { exactPrefill: true, route: 'existing Manager Translation', requestsAfterExplicitActivation: translationSink.requests - before, observedRequestAfterMs: Date.now() - began, provider: 'isolated loopback stub' }
  })
  await api('window.desktop.clearAIProviderKey("custom")')
  await test('discovery metadata and persisted projection omit selection values', 'ISOLATED PACKAGED PASS', async () => {
    const sentinel = 'PRIVATE_SELECTION_SENTINEL_6G2'; await preview(sentinel)
    const projection = await readFile(join(profile, 'feature-projection-v2.json'), 'utf8')
    const metadata = await control({ type: 'super-panel-state' })
    assert.ok(!projection.includes(sentinel) && !JSON.stringify(metadata).includes(sentinel), 'Selection leaked into metadata')
    return { projectionContainsSelection: false, diagnosticMetadataContainsSelection: false }
  })
  await closeManager(); await control({ type: 'super-panel-dismiss' }); await control({ type: 'exit' })
  await until(inventory, rows => rows.length === 0, 'final exact-path process count zero')
  report.status = 'ISOLATED PACKAGED PASS'; report.remainingProcessCount = 0; report.translationRequestCount = translationSink.requests
} catch (error) {
  report.status = 'FAIL'; report.error = error.message.slice(0, 500); process.exitCode = 1; console.error(error.message)
} finally {
  for (const cdp of connections) cdp.close()
  if (probe && ownership.identities.size) {
    try {
      let rows = await inventory(); const current = managerIdentity(rows); if (current) await inventory('close', current)
      await until(inventory, value => electrons(value).length === 0, 'Manager failure-path exit before Native shutdown', 45_000)
      const host = ownership.live(rows).find(row => row.role === 'native')
      if (host && socket && !socket.destroyed) await control({ type: 'exit' })
      else if (host) await inventory('close-native', host)
      rows = await until(inventory, value => ownership.live(value).length === 0, 'graceful failure-path cleanup', 45_000)
      report.remainingProcessCount = rows.length; if (rows.length) throw new Error('Unowned isolated process remains')
    } catch (error) { report.cleanupError = error.message; report.remainingProcessCount = 'NOT VERIFIED'; report.status = 'FAIL'; process.exitCode = 1 }
  }
  socket?.destroy(); reader?.close(); probe?.stdin.end(); sink.closeAllConnections(); await new Promise(done => sink.close(done))
  report.finishedAt = new Date().toISOString(); await save()
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, passed: report.cases.filter(value => value.status === 'PASS').length, evidence, remaining: report.remainingProcessCount }))
}
