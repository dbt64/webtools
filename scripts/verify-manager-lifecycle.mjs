import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createConnection, createServer } from 'node:net'
import { createInterface } from 'node:readline'
import { mkdir, readFile, writeFile, appendFile, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDefaultAppData } from '../src/shared/domain.ts'
import { assertSafeManagerEvidenceRoot, createManagerLifecycleManifest, validateManagerLifecycleDSupplement, validateManagerLifecycleEvidence } from './lib/manager-lifecycle-evidence.mjs'

// Real Release Manager driven through the explicitly isolated Native resource pipe.
// No UIA, synthetic Manager, forced GC, installer, or live-profile mutation.
const repo = resolve(fileURLToPath(new URL('..', import.meta.url)))
assert.ok(process.argv[2] && isAbsolute(process.argv[2]), 'Evidence/build root must be an absolute path')
const root = resolve(process.argv[2] ?? '')
assertSafeManagerEvidenceRoot(root)
const scenarioDOnly = process.argv.includes('--scenario-d-only')
const artifactRoot = resolve(process.env.WEBTOOLS_PHASE4G3_ARTIFACT_ROOT ?? root)
const nativeArtifactRoot = resolve(process.env.WEBTOOLS_PHASE4G3_NATIVE_ROOT ?? artifactRoot)
const managerArtifactRoot = resolve(process.env.WEBTOOLS_PHASE4G3_MANAGER_ROOT ?? artifactRoot)
const previous = process.argv.includes('--resume') ? JSON.parse(await readFile(join(root, 'report.json'), 'utf8')) : null
if (previous?.result === 'A-F PASS') {
  const eventsText = await readFile(join(root, 'events.jsonl'), 'utf8').catch(() => '')
  const validation = validateManagerLifecycleEvidence(previous, eventsText)
  assert.equal(validation.status, 'PASS', `${validation.status}: ${validation.issues.join('; ')}`)
  console.log(`Already complete; no runtime workload repeated. Evidence: ${root}`)
  process.exit(0)
}
assert.ok(scenarioDOnly || !previous?.scenarios.C?.length || previous.scenarios.C.length === 30,
  'Partial Scenario C cannot resume on a new Native PID; retain evidence and resolve same-PID continuity first.')
await unlink(join(root, 'sampler.stop')).catch(error => { if (error.code !== 'ENOENT') throw error })
const profile = join(root, 'profile')
const nativeExe = join(nativeArtifactRoot, 'Native', 'WebTools.NativeHost.exe')
const managerExe = join(managerArtifactRoot, 'manager-build', 'win-unpacked', 'WebTools.exe')
const probeScript = join(repo, 'native', 'scripts', 'Measure-Phase4G3Processes.ps1')
const liveProfile = join(process.env.APPDATA, 'Nook')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const log = async (type, data = {}) => appendFile(join(root, 'events.jsonl'), `${JSON.stringify({ utc: new Date().toISOString(), type, ...data })}\n`)
async function fileHash(path) { try { return createHash('sha256').update(await readFile(path)).digest('hex') } catch (error) { if (error.code === 'ENOENT') return null; throw error } }
async function liveHashes() { return Object.fromEntries(await Promise.all(['nook-data.json', 'launcher-state.json', 'secrets.json'].map(async name => [name, await fileHash(join(liveProfile, name))]))) }
const hashesBefore = await liveHashes()
await mkdir(profile, { recursive: true })
const data = createDefaultAppData()
data.settings.quickSearchShortcut = 'Control+Alt+Shift+F12'
data.settings.translation.engine = 'ai' // No credentials: handoff/local UI cannot contact a provider.
data.bookmarkFolders = [{ id: 'g3-folder', name: 'Phase4G3 测试收藏夹', createdAt: 1 }]
data.webEntries = [{ id: 'g3-site', name: 'Phase4G3 Test Site', url: 'https://example.com/', description: 'isolated lifecycle test', favicon: '', folderIds: ['g3-folder'], createdAt: 1 }]
await writeFile(join(profile, 'nook-data.json'), JSON.stringify(data))
const state = {
  schemaVersion: 1, quickSearchShortcut: data.settings.quickSearchShortcut, theme: 'dark', launcherDisplayMode: 'compact', launchOnStartup: false,
  searchEngines: data.settings.searchEngines, defaultSearchEngineId: 'google', everythingEnabled: false, everythingEsPath: '',
  websites: data.webEntries.map(({ id, name, url, description, folderIds }) => ({ id, name, url, description, folderIds })), appSearchMemory: [],
}
await writeFile(join(profile, 'launcher-state.json'), JSON.stringify(state))
await writeFile(join(profile, 'catalog.json'), JSON.stringify({ schemaVersion: 1, generatedAtUtc: new Date().toISOString(), apps: [] }))
const reservation = createServer()
reservation.listen(0, '127.0.0.1')
await once(reservation, 'listening')
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const pipeName = `WebTools.NativeHost.Resource.G3${randomUUID().replaceAll('-', '')}`
const environment = { ...process.env, WEBTOOLS_MANAGER_EXE: managerExe, WEBTOOLS_MANAGER_TEST_DEBUG_PORT: String(port) }
delete environment.ELECTRON_RUN_AS_NODE
const psArgs = [
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', probeScript,
  '-TestRoot', root,
  '-NativeRoot', join(nativeArtifactRoot, 'Native'),
  '-ManagerRoot', join(managerArtifactRoot, 'manager-build', 'win-unpacked'),
]
const probe = spawn('powershell.exe', psArgs, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
let probeError = ''
probe.stderr.on('data', bytes => { probeError += bytes })
const probeReplies = []
createInterface({ input: probe.stdout }).on('line', line => {
  const reply = probeReplies.shift()
  if (reply) { try { reply.resolve(JSON.parse(line)) } catch (error) { reply.reject(error) } }
})
async function os(type = 'scan', identity) {
  const response = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Process probe timeout: ${probeError}`)), 15000)
    probeReplies.push({ resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
    probe.stdin.write(`${JSON.stringify({ type, pid: identity?.pid, created: identity?.created })}\n`)
  })
  assert.equal(response.ok, true, response.error)
  return response.processes
}
const sampler = spawn('powershell.exe', [...psArgs, '-Sampler'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
sampler.stderr.on('data', bytes => appendFile(join(root, 'sampler-errors.log'), bytes))
const native = spawn(nativeExe, ['--phase4e-resource-test', profile, join(profile, 'catalog.json'), pipeName, state.quickSearchShortcut], { env: environment, windowsHide: true, stdio: 'ignore' })
const report = { root, sourceHead: (await readFile(join(root, 'source-head.txt'), 'utf8')).trim(), nativePid: native.pid, nativeExe, managerExe, pipeName, port, scenarios: {}, checkpoints: [], artifacts: { nativeExe: await fileHash(nativeExe), nativeDll: await fileHash(join(nativeArtifactRoot, 'Native', 'WebTools.NativeHost.dll')), managerExe: await fileHash(managerExe), asar: await fileHash(join(managerArtifactRoot, 'manager-build', 'win-unpacked', 'resources', 'app.asar')) } }
if (previous) {
  assert.deepEqual(report.artifacts, previous.artifacts, 'Resume must use identical product artifacts')
  report.scenarios = previous.scenarios
  report.checkpoints = previous.checkpoints
  report.previousNativePids = [...(previous.previousNativePids ?? []), previous.nativePid]
  report.resumeReason = 'Test-only collector corrections; retain completed scenarios without repeating workloads. Scenario F uses its own isolated Host.'
}
let socket
let cdp
let nativeIdentity
let scenario = 'startup'
let cycle = 0
const resourceReplies = []
async function until(read, test, label, timeout = 30000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await read()
    if (test(value)) return value
    assert.equal(native.exitCode, null, 'NativeHost must remain alive')
    await delay(100)
  }
  throw new Error(`Timed out: ${label}`)
}
async function stage(name, index = 0) {
  scenario = name; cycle = index
  await writeFile(join(root, 'stage.json'), JSON.stringify({ scenario, cycle, nativePid: native.pid }))
}
async function control(command) {
  const response = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Resource pipe timeout: ${command.type}`)), 15000)
    resourceReplies.push({ resolve: value => { clearTimeout(timer); resolve(value) }, reject })
    socket.write(`${JSON.stringify(command)}\n`)
  })
  assert.equal(response.ok, true, JSON.stringify(response))
  assert.equal(response.processId, native.pid)
  return response
}
function group(records) { return records.filter(record => record.path !== nativeExe) }
async function inventory() {
  const records = await os()
  await log('process-probe', { scenario, cycle, records })
  const hosts = records.filter(record => record.path === nativeExe)
  assert.equal(hosts.length, 1, 'One isolated NativeHost')
  assert.equal(hosts[0].pid, native.pid)
  if (nativeIdentity) assert.equal(hosts[0].created, nativeIdentity.created)
  else nativeIdentity = hosts[0]
  return records
}
async function disconnected() {
  await until(async () => (await control({ type: 'manager-state' })).manager, state => state.processId === null && !state.connected && !state.rendererReady && !state.ensuring, 'Native controller releases exited Manager')
}
async function acknowledged() {
  return await until(async () => (await control({ type: 'manager-state' })).manager, state => state.connected && state.rendererReady && state.pendingRequestId === null && !state.ensuring, 'renderer acknowledged Native intent')
}
class CDP {
  constructor(socket) {
    this.socket = socket; this.sequence = 0; this.pending = new Map(); this.errors = []
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params)
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id); clearTimeout(pending.timer)
      if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result)
    })
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('CDP closed')) }
      this.pending.clear()
    })
  }
  async command(method, params = {}) {
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 10000)
      this.pending.set(id, { resolve, reject, timer }); this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expression) {
    const result = await this.command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
    return result.result?.value
  }
  close() { this.socket.close() }
}
async function connectRenderer() {
  const pages = await until(async () => { try { return await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() } catch { return [] } }, pages => pages.filter(page => page.type === 'page').length === 1, 'single real Manager renderer')
  const page = pages.find(page => page.type === 'page')
  assert.ok(page.url.startsWith('file:') && page.url.endsWith('/out/renderer/index.html'), 'Packaged app.asar renderer')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await once(ws, 'open')
  const session = new CDP(ws)
  await session.command('Runtime.enable')
  await until(() => session.eval(`document.readyState === 'complete' && !!document.querySelector('.app-frame') && !!window.desktop`), Boolean, 'Vue mounted / preload available')
  assert.equal(await session.eval('window.desktop.getVersion()'), '0.1.0', 'real preload IPC is responsive')
  return session
}
async function open(section = 'favorites', translationText) {
  const start = performance.now()
  await control(translationText === undefined ? { type: 'manager-open', section } : { type: 'manager-translation', text: translationText })
  const records = await until(inventory, records => group(records).filter(process => process.role === 'main').length === 1, 'Manager process creation')
  const processMs = performance.now() - start
  const main = group(records).find(process => process.role === 'main')
  assert.equal(main.parentPid, native.pid, 'Manager Main launched by real Native controller')
  await until(inventory, records => records.find(record => record.pid === main.pid)?.windows.length === 1, 'Manager single visible window')
  const windowMs = performance.now() - start
  cdp = await connectRenderer()
  await acknowledged()
  const expectedClass = section === 'settings' ? '.settings-page' : section === 'translate' || translationText !== undefined ? '.translate-page' : '.favorites-page'
  // Settings root class varies; use the settled page heading as the route assertion.
  await until(() => cdp.eval(`document.querySelector('.main-panel h1')?.textContent.trim()`), title => title === (section === 'settings' ? '设置' : section === 'translate' || translationText !== undefined ? '翻译' : '网址'), `route ${expectedClass}`)
  const readyMs = performance.now() - start
  const readyRecords = await inventory()
  assert.equal(group(readyRecords).filter(process => process.role === 'main').length, 1)
  const readyMain = readyRecords.find(record => record.pid === main.pid)
  assert.equal(readyMain.windows.length, 1)
  await log('manager-ready', { scenario, cycle, main: readyMain, members: group(readyRecords), processMs, windowMs, readyMs })
  return { main: readyMain, processMs, windowMs, readyMs, electronCount: group(readyRecords).length, rendererCount: group(readyRecords).filter(process => process.role === 'renderer').length }
}
async function close(main) {
  const errors = cdp?.errors ?? []
  cdp?.close(); cdp = null
  const start = performance.now()
  await os('close', main) // ordinary WM_CLOSE -> BrowserWindow close/destroy -> app.quit
  await until(inventory, records => group(records).length === 0, 'whole Manager group exits after normal WM_CLOSE')
  await disconnected()
  const exitMs = performance.now() - start
  assert.equal(errors.length, 0, 'no observed unhandled renderer exceptions')
  await log('manager-normal-exit', { scenario, cycle, main, exitMs, rendererErrors: errors })
  return exitMs
}
async function checkpoint(name) {
  const records = await inventory()
  const state = await control({ type: 'manager-state' })
  const item = { utc: new Date().toISOString(), stage: name, records, controller: state.manager }
  report.checkpoints.push(item); await log('checkpoint', item)
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2))
}
try {
  socket = await until(async () => {
    const candidate = createConnection(`\\\\.\\pipe\\${pipeName}`)
    try { await once(candidate, 'connect'); return candidate } catch { candidate.destroy(); return null }
  }, Boolean, 'isolated resource pipe startup')
  const lines = createInterface({ input: socket })
  const greeting = await new Promise(resolve => {
    lines.once('line', line => resolve(JSON.parse(line)))
    lines.on('line', line => { const pending = resourceReplies.shift(); if (pending) pending.resolve(JSON.parse(line)) })
  })
  assert.equal(greeting.processId, native.pid)
  assert.equal(group(await inventory()).length, 0, 'Native idle Electron=0')
  await checkpoint('initial-native-only')
  if (!scenarioDOnly) {
    report.scenarios.A ??= []
    for (let index = report.scenarios.A.length + 1; index <= 5; index++) {
      await stage('A', index)
      const ready = await open()
      ready.nativePid = native.pid
      ready.exitMs = await close(ready.main)
      report.scenarios.A.push(ready)
      console.log(`A ${index}/5 PASS`)
    }
    await checkpoint('A-complete')
  }
  if (!scenarioDOnly && !report.scenarios.B) {
  await stage('B')
  const reused = await open()
  const reuseEvidence = []
  for (let index = 1; index <= 20; index++) {
    await stage('B', index)
    await control({ type: 'manager-open', section: index % 2 ? 'entries' : 'favorites' })
    const state = await acknowledged()
    assert.equal(state.processId, reused.main.pid)
    const records = await inventory()
    assert.equal(group(records).filter(process => process.role === 'main').length, 1)
    assert.deepEqual(records.find(process => process.pid === reused.main.pid).windows, reused.main.windows)
    reuseEvidence.push({ index, controller: state, members: group(records) })
  }
  report.scenarios.B = { requests: reuseEvidence, exitMs: await close(reused.main) }
  console.log('B 20 requests same PID/window PASS')
  await checkpoint('B-complete')
  }
  if (!scenarioDOnly) {
    report.scenarios.C ??= []
    for (let index = report.scenarios.C.length + 1; index <= 30; index++) {
      await stage('C', index)
      assert.equal(group(await inventory()).length, 0)
      const ready = await open()
      assert.ok(await cdp.eval(`document.querySelector('.favorite-folder-toggle')?.textContent.includes('Phase4G3')`), 'isolated real page data loaded')
      ready.exitMs = await close(ready.main)
      report.scenarios.C.push(ready)
      if (index % 5 === 0) { await stage('C-settle', index); await delay(10000); await checkpoint(`C-${index}`) }
      console.log(`C ${index}/30 PASS`)
    }
  }
  if (report.scenarios.D?.length !== 4) {
  report.scenarios.D = []
  for (const section of ['settings', 'favorites', 'translate']) {
    await stage(`D-${section}`)
    const ready = await open(section)
    let operationProof
    if (section === 'settings') {
      const result = await cdp.eval(`window.desktop.updateSettings({ theme: 'light' })`)
      assert.equal(result.ok, true)
      const saved = JSON.parse(await readFile(join(profile, 'launcher-state.json'), 'utf8'))
      assert.equal(saved.theme, 'light', 'Manager settings projected to isolated Native state')
      operationProof = { kind: 'settings', theme: saved.theme, persisted: saved.theme === 'light' }
    } else if (section === 'favorites') {
      await cdp.eval(`[...document.querySelectorAll('.favorites-page-actions button')].find(button => button.textContent.includes('新建收藏夹')).click()`)
      await until(() => cdp.eval(`!!document.querySelector('[aria-labelledby="folder-dialog-title"] input')`), Boolean, 'pending real folder dialog')
      await cdp.command('Input.insertText', { text: 'unsaved local state' })
      const inputValue = await cdp.eval(`document.querySelector('[aria-labelledby="folder-dialog-title"] input').value`)
      assert.equal(inputValue, 'unsaved local state')
      operationProof = { kind: 'favorites', dialogOpen: true, inputValue }
    } else {
      const providerConfigured = await cdp.eval(`window.desktop.getTranslationProviderInfo().then(result => result.data.configured)`)
      assert.equal(providerConfigured, false, 'no credentials/network provider')
      await cdp.eval(`(() => { const input=document.querySelector('textarea'); input.value='local unsent test'; input.dispatchEvent(new Event('input',{bubbles:true})); })()`)
      const sourceText = await cdp.eval(`document.querySelector('textarea').value`)
      assert.equal(sourceText, 'local unsent test')
      operationProof = { kind: 'translate', sourceText, providerConfigured }
    }
    await log('manager-operation', { scenario, cycle: 0, main: ready.main, operationProof })
    ready.exitMs = await close(ready.main)
    report.scenarios.D.push({ section, ...ready, operationProof })
  }
  // Normal page switches then close: exercised on the same real mounted Manager.
  await stage('D-page-switch')
  const switched = await open()
  const routes = []
  for (const section of ['settings', 'favorites', 'translate', 'favorites']) {
    await control({ type: 'manager-open', section }); await acknowledged()
    const expectedTitle = section === 'settings' ? '设置' : section === 'translate' ? '翻译' : '网址'
    routes.push(await until(() => cdp.eval(`document.querySelector('.main-panel h1')?.textContent.trim()`), title => title === expectedTitle, `page-switch route ${expectedTitle}`))
  }
  assert.deepEqual(routes, ['设置', '网址', '翻译', '网址'])
  const operationProof = { kind: 'page-switch', routes }
  await log('manager-operation', { scenario, cycle: 0, main: switched.main, operationProof })
  report.scenarios.D.push({ section: 'page-switch', ...switched, exitMs: await close(switched.main), operationProof })
  await checkpoint('D-complete')
  console.log('D active local UI and settings sync PASS')
  }
  if (!scenarioDOnly && !report.scenarios.E) {
  await stage('E-cold-handoff')
  const exact = "  Phase G test don't alter text  "
  const handoff = await open('translate', exact)
  assert.equal(await cdp.eval(`document.querySelector('textarea').value`), exact, 'cold Launcher action exact original text')
  await cdp.eval(`window.g3Intents=[]; window.desktop.onNativeManagerIntent(intent => window.g3Intents.push(intent))`)
  const next = "Second handoff exact text"
  await control({ type: 'manager-translation', text: next }); await acknowledged()
  assert.equal(await cdp.eval(`document.querySelector('textarea').value`), next)
  const intents = await cdp.eval(`window.g3Intents`)
  assert.equal(intents.length, 1, 'one warm handoff consumed')
  assert.equal(intents[0].text, next)
  assert.equal((await control({ type: 'manager-state' })).manager.processId, handoff.main.pid)
  const firstExit = await close(handoff.main)
  await stage('E-reconnect')
  const reopened = await open('settings')
  const secondExit = await close(reopened.main)
  const shown = await control({ type: 'show' }); assert.equal(shown.windowVisible, true)
  const queried = await control({ type: 'query', query: '/Phase4G3' }); assert.equal(queried.resultCount, 1)
  const hidden = await control({ type: 'hide' }); assert.equal(hidden.windowVisible, false); assert.equal(hidden.query, '')
  report.scenarios.E = { exact, next, intents, mainPid: handoff.main.pid, reopenedPid: reopened.main.pid, firstExit, secondExit, shown, queried, hidden }
  await checkpoint('E-complete')
  console.log('E exact handoff / reconnect / Native launcher PASS')
  }
  if (!scenarioDOnly && !report.scenarios.F) {
  await stage('F-terminate-main')
  const crashed = await open()
  const beforeCrash = group(await inventory())
  cdp.close(); cdp = null
  await os('terminate-main', crashed.main)
  // Observe product child cleanup BEFORE any test cleanup. Orphans are a failure.
  await until(inventory, records => group(records).length === 0, 'Chromium children self-exit after isolated Main termination', 30000)
  await disconnected()
  await checkpoint('F-crash-recovered-native-only')
  const recovery = await open()
  assert.notEqual(recovery.main.pid, crashed.main.pid)
  report.scenarios.F = { terminatedMain: crashed.main, beforeCrash, recoveredMain: recovery.main, exitMs: await close(recovery.main) }
  await checkpoint('F-complete')
  console.log('F isolated Main unexpected exit / reopen PASS')
  }
  report.liveProfileHashesBefore = hashesBefore
  report.liveProfileHashesAfter = await liveHashes()
  assert.deepEqual(report.liveProfileHashesAfter, hashesBefore, 'Real Nook profile untouched')
  if (scenarioDOnly) {
    assert.equal(report.scenarios.D?.length, 4, 'D supplement requires four completed representative cases')
    assert.deepEqual(report.scenarios.D.map(run => run.operationProof?.kind), ['settings', 'favorites', 'translate', 'page-switch'])
    report.result = 'D SUPPLEMENT PASS'
    const eventsText = await readFile(join(root, 'events.jsonl'), 'utf8')
    report.evidenceManifest = createManagerLifecycleManifest(report, eventsText)
    const validation = validateManagerLifecycleDSupplement(report, eventsText)
    assert.equal(validation.status, 'PASS', `${validation.status}: ${validation.issues.join('; ')}`)
    report.evidenceValidation = validation
  } else {
    report.result = 'A-F PASS'
    const eventsText = await readFile(join(root, 'events.jsonl'), 'utf8')
    report.evidenceManifest = createManagerLifecycleManifest(report, eventsText)
    const validation = validateManagerLifecycleEvidence(report, eventsText)
    assert.equal(validation.status, 'PASS', `${validation.status}: ${validation.issues.join('; ')}`)
    report.evidenceValidation = validation
  }
  await control({ type: 'exit' })
  if (native.exitCode === null) await once(native, 'exit')
} catch (error) {
  report.result = 'INCOMPLETE'
  report.error = { message: error.message, stack: error.stack, scenario, cycle }
  await log('failure', report.error)
  console.error(error)
  process.exitCode = 1
  // Preserve live isolated runtime and evidence for attribution; do not hide product failures by cleanup.
} finally {
  await writeFile(join(root, 'sampler.stop'), '')
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2))
  cdp?.close(); socket?.destroy(); probe.stdin.end()
  native.unref()
  await until(async () => sampler.exitCode !== null, Boolean, 'sampler stops', 5000).catch(() => {})
  console.log(`Evidence: ${root}`)
}
