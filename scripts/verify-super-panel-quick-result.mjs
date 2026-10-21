import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createHash, randomUUID } from 'node:crypto'
import { createConnection, createServer } from 'node:net'
import { createInterface } from 'node:readline'
import { copyFile, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
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
const author = await tempPath(join(root, 'author')); const id = 'org.webtools.acceptance.runtime'
const checked = await validatePackageV3ForRuntime(await readFile(fixture), '0.1.0'); assert.equal(checked.manifest.id, id)
const ownership = new ThemeAcceptanceOwnership(nativeExe, managerExe)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const profile = join(root, 'profile'); await mkdir(profile); await mkdir(join(root, 'fixtures'))
for (const name of ['fixture', 'update', 'isolation']) await copyFile(name === 'update' && args.get('update-package') ? resolve(args.get('update-package')) : fixture, join(root, 'fixtures', `plugin-runtime-${name}.wtplugin`))
const data = createDefaultAppData(); data.settings.quickSearchShortcut = 'Control+Alt+Shift+F12'; data.settings.theme = 'light'
await writeFile(join(profile, 'nook-data.json'), JSON.stringify(data))
await writeFile(join(profile, 'launcher-state.json'), JSON.stringify({ schemaVersion: 1, quickSearchShortcut: data.settings.quickSearchShortcut,
  theme: 'light', launcherDisplayMode: 'compact', launchOnStartup: false, searchEngines: data.settings.searchEngines,
  defaultSearchEngineId: 'google', everythingEnabled: false, everythingEsPath: '', websites: [], appSearchMemory: [] }))
await writeFile(join(profile, 'catalog.json'), JSON.stringify({ schemaVersion: 1, generatedAtUtc: new Date().toISOString(), apps: [] }))
const controls = async selected => writeFile(join(profile, 'plugin-runtime-controls.json'), JSON.stringify({ package: selected, deleteData: true }))
await controls('fixture')
await mkdir(join(root, 'evidence'))
const evidence = join(root, 'evidence/quick-result-acceptance.json')
const report = { status: 'IN_PROGRESS', startedAt: new Date().toISOString(), sourceHead: args.get('source-head'),
  artifacts: { nativeExe, managerExe, nativeSha256: hash(await readFile(nativeExe)), nativeDllSha256: hash(await readFile(join(nativeRoot, 'WebTools.NativeHost.dll'))),
    managerSha256: hash(await readFile(managerExe)), asarSha256: hash(await readFile(join(managerRoot, 'resources/app.asar'))), packageSha256: hash(await readFile(fixture)),
    plugin: { id, version: checked.manifest.version, manifestVersion: 3, apiMajor: 1 } }, cases: [],
  manual: ['Actual mouse Feature selection', 'Visual light/dark and bounded long-text scrolling', 'Physical Escape/outside-click', 'Copy capture/compact first frame unchanged'].map(name => ({ name, status: 'MANUAL VERIFICATION REQUIRED' })) }
const save = () => writeFile(evidence, `${JSON.stringify(report, null, 2)}\n`)
const pause = ms => new Promise(done => setTimeout(done, ms))
let interrupted = false; let native; let probe; let socket; let reader; let manager; let developer
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
const pipe = `WebTools.NativeHost.Resource.6G1_${randomUUID().replaceAll('-', '')}`
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
const invoke = async featureId => until(async () => {
  // Enabled/install returns before the asynchronous Native projection delivery.
  // This seam has no effect until that exact current row can be found.
  try { return await control({ type: 'quick-result-invoke', pluginId: id, featureId, text: 'synthetic selection' }) }
  catch (error) { if (/InvalidOperationException/.test(error.message)) return null; throw error }
}, Boolean, `current projected ${featureId} command`, 8000)
const accepted = expected => until(async () => {
  const value = await panel()
  if (!value.quickResultPending && !value.hasQuickResult && value.status === '功能执行未完成。') throw new Error('Command failed before Native result presentation')
  return value
}, value => value.hasQuickResult && value.quickResultVisible && value.quickResultBodySha256?.toLowerCase() === hash(expected), 'Native accepted exact synthetic text')
const finished = () => until(panel, value => !value.quickResultPending && !value.hasQuickResult && value.status.length > 0, 'bounded completion without result')
const commandChildren = rows => electrons(rows).filter(row => row.role === 'utility' && /node\.mojom\.NodeService/.test(row.commandLine ?? ''))
const noUtility = () => until(inventory, rows => commandChildren(rows).length === 0, 'command Utility process cleanup')
async function test(name, category, action) {
  if (args.get('only') === 'development' && category !== 'DEVELOPMENT WORKFLOW') return
  console.log(`[quick-result] ${name}`)
  const item = { name, category, status: 'IN_PROGRESS' }; report.cases.push(item); await save()
  try {
    const details = await action()
    const nativeWindows = ownership.live(await inventory()).filter(row => row.role === 'native').flatMap(row => row.windows ?? [])
    assert.equal(nativeWindows.filter(window => window.title === 'WebTools').length, 0, 'Quick Result must not leave a native error dialog')
    Object.assign(item, { status: 'PASS', nativeErrorDialogCount: 0, ...details }); await save()
  }
  catch (error) {
    item.status = 'FAIL'; item.error = error.message.slice(0, 300)
    if (manager) try { item.diagnostics = await manager.evaluate('window.desktop.pluginDevelopment.get().then(r => r.data?.diagnostics.map(d => ({code:d.code,phase:d.phase,message:d.message.slice(0,300)})))') } catch {}
    await save(); throw error
  }
}
async function startDeveloper() {
  // Uses the installed tarball's exact CLI session implementation. The
  // controller only supplies orderly close through stdin; plugin code imports
  // the public /node entry and contains no repository/private Host API.
  const controller = join(root, 'sdk-dev-controller.mjs')
  await writeFile(controller, `import { startDevSession } from ${JSON.stringify(pathToFileURL(join(author, 'node_modules/@webtools/plugin-sdk/src/cli.mjs')).href)};\nimport { createInterface } from 'node:readline';\nconst session=await startDevSession(${JSON.stringify(author)},{onStatus:()=>{},onError:()=>{}});\nconsole.log('SDK_DEV_READY');\nconst input=createInterface({input:process.stdin});input.once('line',async()=>{input.close();await session.close()});\n`)
  developer = spawn(process.execPath, [controller], { cwd: author, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const output = createInterface({ input: developer.stdout })
  let toolError = ''
  developer.stderr.on('data', bytes => { toolError = (toolError + String(bytes)).slice(-1000) })
  await new Promise((ok, fail) => {
    const timer = setTimeout(() => { cleanup(); fail(new Error('SDK development startup timeout')) }, 30_000)
    const line = value => { if (value === 'SDK_DEV_READY') { cleanup(); ok() } }
    const exited = code => { cleanup(); fail(new Error(`SDK development startup exited ${code}: ${toolError}`)) }
    const cleanup = () => { clearTimeout(timer); output.off('line', line); developer?.off('exit', exited) }
    output.on('line', line); developer.once('exit', exited)
  })
  assert.equal(JSON.parse(await readFile(join(author, '.webtools/development.json'), 'utf8')).pluginId, id)
  output.on('line', () => {})
}
async function stopDeveloper() {
  if (!developer || developer.exitCode !== null) return
  developer.stdin.end('close\n'); await Promise.race([once(developer, 'exit'), pause(10_000).then(() => { throw new Error('SDK developer cleanup timeout') })]); developer = null
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
  await openManager(); await api('window.desktop.pluginDevelopment.setEnabled(true)')
  await api('window.desktop.plugins.installFromUserDialog()'); await api(`window.desktop.plugins.setEnabled('${id}',true)`)
  await test('text reaches WPF only after Utility cleanup', 'REAL PACKAGED', async () => {
    await invoke('quick'); const value = await accepted('Synthetic local result: synthetic selection'); await noUtility()
    return { requestId: value.quickResultRequestId, bodySha256: value.quickResultBodySha256, characterCount: value.quickResultCharacters, windowHandle: value.windowHandle }
  })
  for (const feature of ['void', 'invalid', 'extra', 'failure', 'childexit']) await test(`${feature}: no result released`, 'REAL PACKAGED', async () => { await invoke(feature); const value = await finished(); await noUtility(); return { hasQuickResult: value.hasQuickResult } })
  await test('long text has bounded WPF scroll', 'REAL PACKAGED', async () => { await invoke('long'); const value = await accepted('Long synthetic result '.repeat(390).slice(0, 8192)); assert.ok(value.quickResultScrollBounded); return { characterCount: value.quickResultCharacters, scrollBounded: true } })
  await test('dismiss cancels pending result; no reopen', 'REAL PACKAGED', async () => {
    await invoke('slow'); assert.ok((await panel()).quickResultPending); await control({ type: 'super-panel-dismiss' }); await noUtility(); await pause(2300)
    const value = await panel(); assert.equal(value.hasQuickResult, false); assert.equal(value.visible, false)
  })
  await test('new invocation rejects old late result', 'REAL PACKAGED', async () => { await invoke('slow'); await invoke('quick'); await accepted('Synthetic local result: synthetic selection'); await pause(2300); await accepted('Synthetic local result: synthetic selection') })
  await test('external disable clears matching accepted source', 'REAL PACKAGED', async () => {
    await api(`window.desktop.plugins.setEnabled('${id}',false)`); await until(panel, value => !value.hasQuickResult, 'explicit source clear'); await api(`window.desktop.plugins.setEnabled('${id}',true)`)
  })
  await test('AI cancel does not send; approve sends once with free stub', 'REAL PACKAGED', async () => {
    const effects = async () => JSON.parse(await readFile(join(profile, 'plugin-runtime-effects.json'), 'utf8'))
    const before = (await effects()).aiCalls
    await invoke('ai'); await until(panel, value => value.quickResultConfirmationVisible, 'same-panel AI confirmation'); assert.equal((await effects()).aiCalls, before)
    await control({ type: 'quick-result-decision', approved: false }); await finished(); assert.equal((await effects()).aiCalls, before)
    await invoke('ai'); await until(panel, value => value.quickResultConfirmationVisible, 'second AI confirmation'); await control({ type: 'quick-result-decision', approved: true })
    await accepted('Isolated acceptance response: synthetic selection'); assert.equal((await effects()).aiCalls, before + 1)
    await control({ type: 'quick-result-decision', approved: true }); assert.equal((await effects()).aiCalls, before + 1)
    return { realProviderCalls: 0, stubCalls: 1, clipboardWrites: (await effects()).clipboardWriteCount }
  })
  if (args.has('update-package')) await test('validated package replacement clears displayed old source', 'REAL PACKAGED', async () => {
    await controls('update'); await api('window.desktop.plugins.installFromUserDialog()'); await until(panel, value => !value.hasQuickResult, 'replacement clear'); await controls('fixture')
  })
  await test('SDK tarball development attach and real Node result', 'DEVELOPMENT WORKFLOW', async () => {
    await startDeveloper(); await api('window.desktop.pluginDevelopment.setEnabled(true)'); await api('window.desktop.pluginDevelopment.connectFromDialog()')
    await until(() => api('window.desktop.pluginDevelopment.get()'), value => value.connected && value.project?.revision >= 1, 'validated development snapshot')
    await until(panel, value => value.developmentFeatureCount > 0, 'ephemeral development overlay')
    await invoke('quick'); await accepted('Synthetic local result: synthetic selection')
  })
  await test('development reload clears old result; new revision executes', 'DEVELOPMENT WORKFLOW', async () => {
    const path = join(author, 'assets/quick.cjs'); const previous = await readFile(path, 'utf8'); const state = await api('window.desktop.pluginDevelopment.get()')
    await writeFile(path, previous.replace('Synthetic local result:', 'Synthetic revised result:'))
    await until(() => api('window.desktop.pluginDevelopment.get()'), value => value.project?.revision > state.project.revision, 'SDK build revision')
    await until(panel, value => !value.hasQuickResult, 'development source clear')
    await invoke('quick'); await accepted('Synthetic revised result: synthetic selection')
    await api('window.desktop.pluginDevelopment.disconnect()'); await until(panel, value => !value.hasQuickResult && value.developmentFeatureCount === 0, 'explicit development disconnect clear')
    await stopDeveloper(); await writeFile(path, previous)
  })
  await test('accepted result survives normal Electron idle exit and reconnect', 'REAL PACKAGED', async () => {
    await invoke('quick'); const value = await accepted('Synthetic local result: synthetic selection'); await closeManager()
    const after = await panel(); assert.equal(after.quickResultBodySha256, value.quickResultBodySha256); assert.equal(after.hasQuickResult, true)
    await openManager(); assert.equal((await panel()).hasQuickResult, true)
    await api(`window.desktop.plugins.setEnabled('${id}',false)`)
    await until(panel, value => !value.hasQuickResult, 'source disable clears pre-reconnect accepted result')
    await api(`window.desktop.plugins.setEnabled('${id}',true)`); await invoke('quick'); await accepted('Synthetic local result: synthetic selection')
    return { closedElectronCount: 0, nativePid: native.pid, acceptedAfterReconnect: true, sourceClearAfterReconnect: true }
  })
  await test('cold command starts a headless Host then returns to Electron zero', 'REAL PACKAGED', async () => {
    await closeManager(); await invoke('slow')
    const live = await until(inventory, rows => commandChildren(rows).length > 0, 'cold command Utility')
    assert.ok(managerIdentity(live))
    assert.equal(electrons(live).flatMap(row => row.windows ?? []).filter(win => win.title === 'WebTools').length, 0, 'Command must not open Manager')
    assert.equal(electrons(live).filter(row => row.role === 'renderer').length, 0, 'Command must not create a Manager renderer')
    await accepted('Synthetic slow result'); await until(inventory, rows => electrons(rows).length === 0, 'headless Host normal idle exit')
    assert.equal((await panel()).hasQuickResult, true)
    await openManager()
    return { managerWindowCount: 0, rendererCount: 0, idleElectronCount: 0, nativePid: native.pid }
  })
  await test('pending Pipe peer loss rejects late output and cleans Utility', 'REAL PACKAGED', async () => {
    await invoke('slow'); const rows = await until(inventory, value => commandChildren(value).length > 0, 'real pending command Utility')
    const identity = managerIdentity(rows); assert.ok(identity); assert.equal((await panel()).quickResultPending, true)
    manager.close(); manager = null
    await inventory('terminate-main', identity); await until(inventory, rows => electrons(rows).length === 0, 'isolated failed peer group exit')
    const value = await panel(); assert.equal(value.hasQuickResult, false); assert.equal(value.quickResultPending, false)
    await openManager(); await invoke('quick'); await accepted('Synthetic local result: synthetic selection')
  })
  await closeManager(); await control({ type: 'super-panel-dismiss' }); await control({ type: 'exit' })
  await until(inventory, rows => rows.length === 0, 'final exact-path process count zero')
  report.status = 'AUTOMATED PASS'; report.remainingProcessCount = 0
} catch (error) {
  report.status = 'FAIL'; report.error = error.message.slice(0, 500); process.exitCode = 1; console.error(error.message)
} finally {
  for (const cdp of connections) cdp.close()
  await stopDeveloper().catch(error => { report.developerCleanup = error.message; report.status = 'FAIL'; process.exitCode = 1 })
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
  socket?.destroy(); reader?.close(); probe?.stdin.end()
  report.finishedAt = new Date().toISOString(); await save()
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, passed: report.cases.filter(value => value.status === 'PASS').length, evidence, remaining: report.remainingProcessCount }))
}
