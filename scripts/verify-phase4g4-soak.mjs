import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createConnection, createServer } from 'node:net'
import { createInterface } from 'node:readline'
import { mkdir, readFile, writeFile, rename, open, lstat, realpath, stat, readdir } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { resolve, join, relative, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { createDefaultAppData } from '../src/shared/domain.ts'

const execFileAsync = promisify(execFile)
const mode = process.argv[2]
const root = process.argv[3] ? resolve(process.argv[3]) : ''
const runtimeRoot = process.argv[4] ? resolve(process.argv[4]) : ''
const repo = resolve(fileURLToPath(new URL('..', import.meta.url)))
const probeScript = join(repo, 'native', 'scripts', 'Measure-Phase4G3Processes.ps1')
const expectedSourceHead = '926c8bf799ee36deb6898865a78399af85991035'
const safeModes = new Set(['preflight', 'soak'])
assert.ok(safeModes.has(mode), 'Mode must be preflight or soak.')
assert.ok(isAbsolute(root) && isAbsolute(runtimeRoot), 'Evidence and runtime roots must be absolute.')
const tempRoot = resolve(process.env.TEMP || tmpdir())
const liveInstallRoot = 'D:\\webtools'
const userProfile = resolve(process.env.APPDATA || '', 'Nook')
const profileRoot = join(root, 'profile')
const nativeExe = join(runtimeRoot, 'WebTools.NativeHost.exe')
const nativeDll = join(runtimeRoot, 'WebTools.NativeHost.dll')
const managerRoot = join(runtimeRoot, 'Manager')
const managerExe = join(managerRoot, 'WebTools.exe')
const managerAsar = join(managerRoot, 'resources', 'app.asar')
const pipeName = 'WebTools.NativeHost.Resource.G4' + randomUUID().replaceAll('-', '')
const hotkey = 'Control+Alt+Shift+F12'
const delay = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms))
const lower = value => value.toLocaleLowerCase('en-US')
let interruptionSignal = null
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { interruptionSignal ??= signal })
function throwIfInterrupted() {
  if (interruptionSignal) throw new Error('Interrupted by ' + interruptionSignal + '.')
}
async function waitWithInterrupt(promise, timeoutMs, label) {
  throwIfInterrupted()
  let timer
  const signalHandlers = new Map()
  const interrupted = new Promise((_, reject) => {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const handler = () => reject(new Error('Interrupted by ' + signal + ' while waiting for ' + label + '.'))
      signalHandlers.set(signal, handler)
      process.once(signal, handler)
    }
  })
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Timed out waiting for ' + label + '.')), timeoutMs)
  })
  try { return await Promise.race([promise, interrupted, timeout]) }
  finally {
    clearTimeout(timer)
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler)
  }
}
const isWithin = (base, candidate) => {
  const rel = relative(resolve(base), resolve(candidate))
  return rel !== '' && rel !== '.' && rel !== '..' && !rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) && !isAbsolute(rel)
}
const pathsOverlap = (left, right) => resolve(left).toLocaleLowerCase('en-US') === resolve(right).toLocaleLowerCase('en-US') || isWithin(left, right) || isWithin(right, left)
const witnessValue = witness => ({ processes: witness.processes, profileSha256: witness.profileSha256 })

async function assertNoReparsePath(base, target, label) {
  assert.ok(isWithin(base, target), label + ' must be a strict descendant of TEMP.')
  const canonicalBase = resolve(await realpath(base))
  const canonicalTarget = resolve(await realpath(target))
  assert.equal(lower(canonicalTarget), lower(resolve(target)), label + ' resolves through a reparse point.')
  let current = canonicalBase
  for (const part of relative(canonicalBase, canonicalTarget).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part)
    const info = await lstat(current)
    assert.ok(!info.isSymbolicLink(), label + ' cannot traverse a reparse point.')
  }
}
async function assertNoReparseTree(root, label) {
  const pending = [resolve(root)]
  while (pending.length) {
    const directory = pending.pop()
    for (const entry of await readdir(directory)) {
      const path = join(directory, entry)
      const info = await lstat(path)
      assert.ok(!info.isSymbolicLink(), label + ' contains a symbolic link or junction: ' + path)
      if (info.isDirectory()) pending.push(path)
    }
  }
}
async function hashFile(path) {
  try { return createHash('sha256').update(await readFile(path)).digest('hex') }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
async function profileHashes() {
  const items = {}
  for (const name of ['nook-data.json', 'launcher-state.json', 'secrets.json']) items[name] = await hashFile(join(userProfile, name))
  return items
}
async function productionWitness() {
  const command = "$root='D:\\webtools'; $exe=Join-Path $root 'WebTools.NativeHost.exe'; $rows=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $exe -or ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($root + '\\',[StringComparison]::OrdinalIgnoreCase)) } | Select-Object ProcessId,ParentProcessId,ExecutablePath,CreationDate); ConvertTo-Json -InputObject $rows -Compress"
  const result = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true, maxBuffer: 1024 * 1024 })
  const parsed = JSON.parse(result.stdout.trim() || '[]')
  return {
    capturedAtUtc: new Date().toISOString(),
    processes: Array.isArray(parsed) ? parsed : parsed ? [parsed] : [],
    profileSha256: await profileHashes(),
  }
}
async function durableAppend(path, line) {
  const handle = await open(path, 'a')
  try { await handle.writeFile(line + '\n', 'utf8'); await handle.sync() }
  finally { await handle.close() }
}
async function writeAtomicJson(path, value) {
  const temporary = path + '.tmp'
  const handle = await open(temporary, 'w')
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n', 'utf8'); await handle.sync() }
  finally { await handle.close() }
  await rename(temporary, path)
}
function csv(value) {
  const text = value === null || value === undefined ? '' : String(value)
  return '"' + text.replaceAll('"', '""') + '"'
}
async function appendProcessRows(rows, eventName) {
  const output = join(root, 'manager-processes.csv')
  const info = await stat(output).catch(() => null)
  if (!info) await durableAppend(output, ['utc', 'event', 'pid', 'parentPid', 'path', 'created', 'role', 'privateBytes', 'workingSet', 'handles', 'threads', 'gdi', 'user', 'windows'].join(','))
  for (const row of rows) {
    await durableAppend(output, [
      new Date().toISOString(), eventName, row.pid, row.parentPid, row.path, row.created, row.role,
      row.privateBytes, row.workingSet, row.handles, row.threads, row.gdi, row.user,
      JSON.stringify(row.windows ?? []),
    ].map(csv).join(','))
  }
}
async function appendError(error, stage) {
  const path = join(root, 'errors.json')
  let data = []
  try { data = JSON.parse(await readFile(path, 'utf8')) } catch { }
  data.push({ utc: new Date().toISOString(), stage, message: error?.message || String(error), stack: error?.stack || null })
  await writeAtomicJson(path, data)
}
let native
let nativeCreatedUtc = null
let currentStage = null
let manifest = {}
async function setStage(phase, step, extra = {}) {
  const value = { utc: new Date().toISOString(), phase, step, nativePid: native?.pid ?? null, ...extra }
  currentStage = value
  await writeAtomicJson(join(root, 'stage.json'), value)
}
async function recordEvent(type, details = {}) {
  const item = { utc: new Date().toISOString(), mode, phase: currentStage?.phase ?? mode, step: currentStage?.step ?? 'initializing', type, nativePid: native?.pid ?? null, ...details }
  await durableAppend(join(root, 'lifecycle-events.jsonl'), JSON.stringify(item))
}
async function updateManifest(patch = {}) {
  manifest = { ...manifest, ...patch, updatedAtUtc: new Date().toISOString() }
  await writeAtomicJson(join(root, 'manifest.json'), manifest)
}
async function makeProfile() {
  await mkdir(profileRoot, { recursive: true })
  const data = createDefaultAppData()
  data.settings.quickSearchShortcut = hotkey
  data.bookmarkFolders = [{ id: 'phase4g4-folder', name: 'Phase4G4 Soak', createdAt: 1 }]
  data.webEntries = [{
    id: 'phase4g4-site',
    name: 'Phase4G4 Local Test Site',
    url: 'https://phase4g4.invalid/',
    description: 'isolated no-network search fixture',
    favicon: '',
    folderIds: ['phase4g4-folder'],
    createdAt: 1,
  }]
  const state = {
    schemaVersion: 1,
    quickSearchShortcut: hotkey,
    theme: 'dark',
    launcherDisplayMode: 'compact',
    launchOnStartup: false,
    searchEngines: data.settings.searchEngines,
    defaultSearchEngineId: 'google',
    everythingEnabled: false,
    everythingEsPath: '',
    websites: data.webEntries.map(({ id, name, url, description, folderIds }) => ({ id, name, url, description, folderIds })),
    appSearchMemory: [],
  }
  await writeFile(join(profileRoot, 'nook-data.json'), JSON.stringify(data), 'utf8')
  await writeFile(join(profileRoot, 'launcher-state.json'), JSON.stringify(state), 'utf8')
  await writeFile(join(profileRoot, 'catalog.json'), JSON.stringify({ schemaVersion: 1, generatedAtUtc: new Date().toISOString(), apps: [] }), 'utf8')
  return state
}

assert.ok(await lstat(root).then(info => info.isDirectory()), 'Evidence root must already exist.')
assert.ok(await lstat(runtimeRoot).then(info => info.isDirectory()), 'Runtime root must already exist.')
await assertNoReparsePath(tempRoot, root, 'Evidence root')
await assertNoReparsePath(tempRoot, runtimeRoot, 'Runtime root')
await assertNoReparseTree(runtimeRoot, 'Release runtime')
assert.ok(!pathsOverlap(root, userProfile), 'Evidence/profile root must not overlap real %APPDATA%\\Nook.')
assert.ok(!pathsOverlap(runtimeRoot, userProfile), 'Runtime root must not overlap real %APPDATA%\\Nook.')
assert.ok(!pathsOverlap(root, liveInstallRoot), 'Evidence root must not overlap D:\\webtools.')
assert.ok(!pathsOverlap(runtimeRoot, liveInstallRoot), 'Runtime root must not overlap D:\\webtools.')
assert.ok(!pathsOverlap(root, runtimeRoot), 'Evidence root and Runtime root must be separate.')
for (const path of [nativeExe, nativeDll, managerExe, managerAsar]) assert.ok(await lstat(path).then(info => info.isFile()), 'Missing current Release artifact: ' + path)
assert.equal((await readdir(root)).length, 0, 'Evidence root must be fresh; refusing to overwrite or mix prior evidence.')
const sourceHead = (await execFileAsync('git.exe', ['rev-parse', 'HEAD'], { cwd: repo, windowsHide: true })).stdout.trim()
assert.equal(sourceHead, expectedSourceHead, 'Release runtime must be built from the approved Phase 4G-3 checkpoint source.')
const initialProductionWitness = await productionWitness()
const artifactHashes = {
  nativeExe: await hashFile(nativeExe),
  nativeDll: await hashFile(nativeDll),
  managerExe: await hashFile(managerExe),
  appAsar: await hashFile(managerAsar),
}
const state = await makeProfile()
const portServer = createServer()
portServer.listen(0, '127.0.0.1')
await once(portServer, 'listening')
const debugPort = portServer.address().port
await new Promise((resolvePromise, reject) => portServer.close(error => error ? reject(error) : resolvePromise()))
const environment = { ...process.env, WEBTOOLS_MANAGER_EXE: managerExe, WEBTOOLS_MANAGER_TEST_DEBUG_PORT: String(debugPort) }
delete environment.ELECTRON_RUN_AS_NODE
const probeArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', probeScript, '-TestRoot', root, '-NativeRoot', runtimeRoot, '-ManagerRoot', managerRoot]
const probe = spawn('powershell.exe', probeArgs, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
let probeStderr = ''
probe.stderr.on('data', bytes => { probeStderr += bytes.toString('utf8') })
const probeReplies = []
createInterface({ input: probe.stdout }).on('line', line => {
  const pending = probeReplies.shift()
  if (!pending) return
  try { pending.resolve(JSON.parse(line)) } catch (error) { pending.reject(error) }
})
const sampler = spawn('powershell.exe', [...probeArgs, '-SampleIntervalSeconds', '5', '-Sampler'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
sampler.stderr.on('data', bytes => { void durableAppend(join(root, 'sampler-stderr.log'), bytes.toString('utf8').replaceAll(/\r?\n/g, ' ')) })
const replies = []
let greetingResolve
let greetingReject
const greetingPromise = new Promise((resolvePromise, reject) => { greetingResolve = resolvePromise; greetingReject = reject })
let socket
let cdp
let activeManagerMain
let nativeIdentity
let cdpErrors = []
let soakStartedPerf = performance.now()
const heartbeatEveryMs = 60000
let nextHeartbeatAt = performance.now() + heartbeatEveryMs
const childExit = new Map()
const childErrors = new Map()
function watchExit(child, name) {
  childExit.set(name, null)
  child.on('error', error => childErrors.set(name, error))
  child.once('exit', (code, signal) => childExit.set(name, { code, signal, utc: new Date().toISOString() }))
}
watchExit(probe, 'probe')
watchExit(sampler, 'sampler')

function ensureHostAlive() {
  assert.ok(!childErrors.has('native'), 'Isolated NativeHost failed to start: ' + childErrors.get('native')?.message)
  assert.ok(!childErrors.has('sampler'), 'Five-second process sampler failed to start: ' + childErrors.get('sampler')?.message)
  assert.ok(!childErrors.has('probe'), 'Exact-path process probe failed to start: ' + childErrors.get('probe')?.message)
  assert.ok(native && native.exitCode === null, 'Isolated NativeHost exited unexpectedly.')
  assert.ok(sampler.exitCode === null, 'Five-second process sampler exited unexpectedly.')
  assert.ok(probe.exitCode === null, 'Exact-path process probe exited unexpectedly.')
}
async function processProbe(type = 'scan', identity) {
  if (childErrors.has('probe')) throw new Error('Exact-path process probe failed: ' + childErrors.get('probe').message)
  if (probe.exitCode !== null) throw new Error('Exact-path process probe exited unexpectedly: ' + probeStderr)
  const value = await new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error('Process probe timed out: ' + probeStderr)), 20000)
    probeReplies.push({ resolve: result => { clearTimeout(timeout); resolvePromise(result) }, reject: error => { clearTimeout(timeout); reject(error) } })
    probe.stdin.write(JSON.stringify({ type, pid: identity?.pid, created: identity?.created }) + '\n')
  })
  assert.equal(value.ok, true, value.error)
  return value.processes
}
function targetGroup(records) { return records.filter(record => lower(record.path || '') !== lower(nativeExe)) }
async function inventory(label) {
  const records = await processProbe('scan')
  const hosts = records.filter(record => lower(record.path || '') === lower(nativeExe))
  assert.equal(hosts.length, 1, 'Exactly one NativeHost from this isolated runtime root.')
  assert.equal(hosts[0].pid, native.pid, 'Formal/preflight NativeHost PID remains unchanged.')
  if (nativeIdentity) assert.equal(hosts[0].created, nativeIdentity.created, 'NativeHost creation time remains unchanged.')
  else nativeIdentity = hosts[0]
  await appendProcessRows(records, label)
  return records
}
async function connectPipe() {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    throwIfInterrupted()
    ensureHostAlive()
    const candidate = createConnection('\\\\.\\pipe\\' + pipeName)
    try {
      await waitWithInterrupt(new Promise((resolvePromise, reject) => {
        const onConnect = () => { candidate.removeListener('error', onError); resolvePromise() }
        const onError = error => { candidate.removeListener('connect', onConnect); reject(error) }
        candidate.once('connect', onConnect)
        candidate.once('error', onError)
      }), Math.min(2000, deadline - Date.now()), 'isolated NativeHost pipe connection')
    } catch (error) {
      candidate.destroy()
      if (interruptionSignal) throw error
      if (Date.now() >= deadline) throw error
      await delay(250)
      continue
    }

    socket = candidate
    const rejectGreeting = error => {
      if (greetingDone) return
      greetingDone = true
      greetingReject(error)
    }
    socket.once('close', () => rejectGreeting(new Error('NativeHost pipe closed before its ready greeting.')))
    socket.on('error', error => {
      if (!greetingDone) rejectGreeting(error)
      if (native?.exitCode === null) void appendError(error, 'resource-pipe')
    })
    const lines = createInterface({ input: socket })
    lines.on('line', line => {
      let parsed
      try { parsed = JSON.parse(line) } catch (error) { rejectGreeting(error); return }
      if (!greetingDone) {
        greetingDone = true
        greetingResolve(parsed)
      } else {
        const pending = replies.shift()
        if (pending) pending.resolve(parsed)
      }
    })
    try {
      return await waitWithInterrupt(greetingPromise, Math.max(1, deadline - Date.now()), 'isolated NativeHost ready greeting')
    } catch (error) {
      socket.destroy()
      socket = null
      throw error
    }
  }
  throw new Error('Timed out waiting for the isolated NativeHost control pipe.')
}
let greetingDone = false
async function control(command, allowInterrupted = false) {
  if (!allowInterrupted) throwIfInterrupted()
  ensureHostAlive()
  return await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error('Resource control timed out: ' + command.type)), 20000)
    replies.push({ resolve: value => { clearTimeout(timer); resolvePromise(value) }, reject })
    socket.write(JSON.stringify(command) + '\n')
  }).then(value => {
    assert.equal(value.ok, true, JSON.stringify(value))
    assert.equal(value.processId, native.pid, 'Named Pipe response must identify the current NativeHost.')
    return value
  })
}
async function until(read, predicate, label, timeoutMs = 45000, allowInterrupted = false) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!allowInterrupted) throwIfInterrupted()
    ensureHostAlive()
    const value = await read()
    if (predicate(value)) return value
    await delay(250)
  }
  throw new Error('Timed out: ' + label)
}
class CDP {
  constructor(webSocket) {
    this.socket = webSocket
    this.sequence = 0
    this.pending = new Map()
    this.errors = []
    webSocket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params)
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
    })
    webSocket.addEventListener('close', () => {
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('CDP connection closed.')) }
      this.pending.clear()
    })
  }
  command(method, params = {}) {
    const id = ++this.sequence
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP command timed out: ' + method)) }, 15000)
      this.pending.set(id, { resolve: resolvePromise, reject, timer })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const result = await this.command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
    return result.result?.value
  }
  close() { this.socket.close() }
}
async function connectRenderer() {
  const pages = await until(async () => {
    try { return await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json() }
    catch { return [] }
  }, value => value.filter(page => page.type === 'page').length === 1, 'single packaged Manager renderer')
  const page = pages.find(item => item.type === 'page')
  assert.ok(page.url.startsWith('file:') && page.url.endsWith('/out/renderer/index.html'), 'Manager uses packaged local renderer.')
  const WebSocketClass = globalThis.WebSocket
  assert.ok(WebSocketClass, 'Node WebSocket is unavailable.')
  const webSocket = new WebSocketClass(page.webSocketDebuggerUrl)
  await once(webSocket, 'open')
  const session = new CDP(webSocket)
  await session.command('Runtime.enable')
  await until(() => session.evaluate('document.readyState === "complete" && !!document.querySelector(".app-frame") && !!window.desktop'), Boolean, 'Vue mount and preload bridge')
  assert.equal(await session.evaluate('window.desktop.getVersion()'), '0.1.0', 'Packaged preload responds.')
  return session
}
async function waitManagerDisconnected() {
  return await until(async () => (await control({ type: 'manager-state' })).manager,
    value => value?.processId === null && !value.connected && !value.rendererReady && !value.ensuring,
    'Native Manager controller disconnect')
}
async function openManager(section, translationText) {
  const started = performance.now()
  if (translationText === undefined) await control({ type: 'manager-open', section })
  else await control({ type: 'manager-translation', text: translationText })
  const records = await until(() => processProbe('scan'), value => targetGroup(value).filter(item => item.role === 'main' && lower(item.path) === lower(managerExe)).length === 1, 'exactly one packaged Manager Main')
  const group = targetGroup(records)
  const main = group.find(item => item.role === 'main' && lower(item.path) === lower(managerExe))
  activeManagerMain = main
  assert.equal(main.parentPid, native.pid, 'Manager Main is a child of the isolated NativeHost.')
  const ready = await until(() => processProbe('scan'), value => value.find(item => item.pid === main.pid)?.windows?.length === 1, 'visible Manager window')
  const readyGroup = targetGroup(ready)
  assert.equal(readyGroup.filter(item => item.role === 'main' && lower(item.path) === lower(managerExe)).length, 1, 'No duplicate independent Manager Main.')
  await appendProcessRows(readyGroup, 'manager-visible')
  cdp = await connectRenderer()
  const managerState = await until(async () => (await control({ type: 'manager-state' })).manager,
    value => value?.connected && value.rendererReady && value.pendingRequestId === null && !value.ensuring,
    'Manager renderer readiness acknowledgement')
  const expectedTitle = section === 'settings' ? '设置' : section === 'translate' ? '翻译' : '网址'
  await until(() => cdp.evaluate('document.querySelector(".main-panel h1")?.textContent.trim()'), title => title === expectedTitle, 'expected Manager route ' + expectedTitle)
  let prefill = null
  if (translationText !== undefined) {
    prefill = await cdp.evaluate('document.querySelector("textarea")?.value')
    assert.equal(prefill, translationText, 'Translation handoff preserves the exact local test text.')
  }
  cdpErrors = cdp.errors
  await recordEvent('manager-ready', {
    section, mainPid: main.pid, mainCreated: main.created, memberPids: readyGroup.map(item => item.pid),
    pageTitle: expectedTitle, translationPrefill: prefill, rendererAcknowledged: true,
    providerInvocations: 0, elapsedMs: Math.round(performance.now() - started), controller: managerState,
  })
  return main
}
async function closeManager(main, groupLabel) {
  cdp?.close()
  cdp = null
  await processProbe('close', main)
  await until(() => processProbe('scan'), records => targetGroup(records).length === 0, 'whole isolated Electron process group exits after WM_CLOSE')
  await waitManagerDisconnected()
  assert.equal(cdpErrors.length, 0, 'Manager renderer did not report unhandled exceptions.')
  await recordEvent('manager-normal-close', { sectionGroup: groupLabel, mainPid: main.pid, created: main.created, processGroupCount: 0 })
  activeManagerMain = null
}
async function saveCheckpoint(name, phase, extra = {}) {
  const started = performance.now()
  const [records, managerState, snapshot] = await Promise.all([
    processProbe('scan'), control({ type: 'manager-state' }), control({ type: 'snapshot' }),
  ])
  const hosts = records.filter(item => lower(item.path || '') === lower(nativeExe))
  const group = targetGroup(records)
  assert.equal(hosts.length, 1)
  assert.equal(hosts[0].pid, native.pid)
  assert.equal(group.length, 0, 'Checkpoints require target Manager/Electron group=0.')
  assert.equal(managerState.manager.processId, null)
  assert.equal(snapshot.windowVisible, false, 'Launcher remains hidden at idle checkpoint.')
  assert.equal(snapshot.query, '', 'Query has been cleared at idle checkpoint.')
  await appendProcessRows(records, name)
  const checkpoint = {
    utc: new Date().toISOString(), name, phase, nativePid: native.pid, nativeCreatedUtc: hosts[0].created,
    nativeMetrics: {
      privateBytes: hosts[0].privateBytes, workingSet: hosts[0].workingSet, handles: hosts[0].handles,
      threads: hosts[0].threads, gdi: hosts[0].gdi, user: hosts[0].user,
    },
    managerProcessCount: 0, electronProcessGroupCount: 0,
    responsive: true, pipeRoundTripMs: Math.round(performance.now() - started),
    launcher: { visible: snapshot.windowVisible, query: snapshot.query, resultCount: snapshot.resultCount, hwnd: snapshot.windowHandle },
    controller: managerState.manager,
    ...extra,
  }
  let checkpoints = []
  try { checkpoints = JSON.parse(await readFile(join(root, 'checkpoints.json'), 'utf8')) } catch { }
  checkpoints.push(checkpoint)
  await writeAtomicJson(join(root, 'checkpoints.json'), checkpoints)
  const sampling = await sampleCount()
  await recordEvent('formal-checkpoint', checkpoint)
  await updateManifest({ lastCheckpoint: checkpoint, sampleCount: sampling.count, latestSampleUtc: sampling.lastUtc })
  console.log(new Date().toISOString() + ' CHECKPOINT ' + name + ' PASS pid=' + native.pid + ' private=' + hosts[0].privateBytes + ' handles=' + hosts[0].handles + ' gdi=' + hosts[0].gdi + ' user=' + hosts[0].user + ' pipeMs=' + checkpoint.pipeRoundTripMs)
  return checkpoint
}
async function sampleCount() {
  const text = await readFile(join(root, 'process-samples.jsonl'), 'utf8').catch(() => '')
  const lines = text.split(/\r?\n/).filter(Boolean)
  const rows = lines.map(line => JSON.parse(line.replace(/^\uFEFF/, '')))
  return { count: rows.length, lastUtc: rows.at(-1)?.utc ?? null }
}
async function sampleProgress() {
  const info = await stat(join(root, 'process-samples.jsonl'))
  return { bytes: info.size, modifiedAtUtc: info.mtime.toISOString() }
}
async function sleepTo(targetMs, phase) {
  while (performance.now() < targetMs) {
    throwIfInterrupted()
    ensureHostAlive()
    const remaining = targetMs - performance.now()
    await delay(Math.min(5000, remaining))
    if (performance.now() >= nextHeartbeatAt) {
      nextHeartbeatAt = performance.now() + heartbeatEveryMs
      const progress = await sampleProgress()
      const records = await processProbe('scan')
      const hosts = records.filter(item => lower(item.path || '') === lower(nativeExe))
      assert.equal(hosts.length, 1, 'Heartbeat verifies the same isolated NativeHost remains alive.')
      assert.equal(hosts[0].pid, native.pid)
      assert.equal(targetGroup(records).length, 0, 'No Manager/Electron process may remain during soak idle intervals.')
      const elapsedSeconds = Math.round((performance.now() - soakStartedPerf) / 1000)
      await recordEvent('soak-heartbeat', { phase, elapsedSeconds, sampleFileBytes: progress.bytes, sampleFileModifiedAtUtc: progress.modifiedAtUtc, managerProcessCount: 0, electronProcessGroupCount: 0 })
      console.log(new Date().toISOString() + ' HEARTBEAT phase=' + phase + ' elapsedSeconds=' + elapsedSeconds + ' sampleBytes=' + progress.bytes + ' pid=' + native.pid)
    }
  }
}
async function queryShowHide(label) {
  const before = await control({ type: 'show' })
  assert.equal(before.windowVisible, true, 'Launcher shows.')
  const query = await control({ type: 'query', query: 'Control Panel' })
  assert.equal(query.searchMode, 'Local')
  assert.ok(query.resultKinds.includes('Application'), 'Representative local built-in app query returned an application.')
  await recordEvent('launcher-search', { label, query: 'Control Panel', resultCount: query.resultCount, resultKinds: query.resultKinds, hwnd: query.windowHandle })
  const cleared = await control({ type: 'query', query: '' })
  assert.equal(cleared.query, '', 'Launcher query is cleared explicitly.')
  const hidden = await control({ type: 'hide' })
  assert.equal(hidden.windowVisible, false, 'Launcher hides.')
  assert.equal(hidden.query, '', 'Hidden Launcher has no transient query.')
  await recordEvent('launcher-hidden', { label, hwnd: hidden.windowHandle, query: hidden.query })
}
async function startProcesses(label) {
  await setStage(mode, label)
  native = spawn(nativeExe, ['--phase4e-resource-test', profileRoot, join(profileRoot, 'catalog.json'), pipeName, state.quickSearchShortcut],
    { cwd: runtimeRoot, env: environment, windowsHide: true, stdio: 'ignore' })
  watchExit(native, 'native')
  manifest.nativePid = native.pid
  await updateManifest({ stage: 'NativeHost starting', nativePid: native.pid })
  const identityRecords = await until(() => processProbe('scan'), records => records.some(item => item.pid === native.pid && lower(item.path || '') === lower(nativeExe) && item.role === 'native'), 'exact isolated NativeHost process identity', 15000)
  nativeIdentity = identityRecords.find(item => item.pid === native.pid && lower(item.path || '') === lower(nativeExe) && item.role === 'native')
  nativeCreatedUtc = nativeIdentity.created
  const greeting = await connectPipe()
  assert.equal(greeting.ok, true)
  assert.equal(greeting.type, 'ready')
  assert.equal(greeting.processId, native.pid)
  await inventory(label + '-startup')
  const initial = await control({ type: 'manager-state' })
  assert.equal(initial.manager.processId, null)
  assert.equal(targetGroup(await processProbe('scan')).length, 0, 'No Electron process before opening Manager.')
  await recordEvent('native-ready', { label, nativePid: native.pid, nativeCreatedUtc, pipeName, managerCount: 0, electronCount: 0 })
}
async function stopSampler() {
  await writeFile(join(root, 'sampler.stop'), 'stop\n', 'utf8')
  const deadline = Date.now() + 15000
  while (sampler.exitCode === null && Date.now() < deadline) await delay(100)
  assert.equal(sampler.exitCode, 0, 'Sampler exits successfully after stop signal.')
}
async function waitForExit(child, timeoutMs = 20000) {
  if (child.exitCode !== null) return
  await Promise.race([
    once(child, 'exit'),
    delay(timeoutMs).then(() => { throw new Error('Timed out waiting for normal process exit: ' + child.spawnfile) }),
  ])
}
async function stopNativeNormally() {
  if (!native) return
  const current = await processProbe('scan')
  const managerMains = targetGroup(current).filter(item => lower(item.path || '') === lower(managerExe) && item.role === 'main')
  for (const main of managerMains) {
    try {
      await processProbe('close', { pid: main.pid, created: main.created })
    } catch (error) {
      const latest = await processProbe('scan')
      const stillRunning = targetGroup(latest).some(item => item.pid === main.pid && item.created === main.created && lower(item.path || '') === lower(managerExe) && item.role === 'main')
      if (stillRunning) throw error
    }
  }
  const managerDeadline = Date.now() + 30000
  let remaining = targetGroup(current)
  while (remaining.length && Date.now() < managerDeadline) {
    await delay(250)
    remaining = targetGroup(await processProbe('scan'))
  }
  assert.equal(remaining.length, 0, 'Safe normal Manager close during cleanup must leave no isolated Electron process.')
  activeManagerMain = null
  let records = await processProbe('scan')
  let host = records.find(item => item.pid === native.pid && lower(item.path || '') === lower(nativeExe) && item.role === 'native')
  if (host) {
    assert.equal(host.created, nativeIdentity?.created, 'NativeHost cleanup must match the recorded PID creation time.')
    if (socket && !socket.destroyed && native.exitCode === null) {
      try {
        await control({ type: 'exit' }, true)
        await waitForExit(native)
      } catch {
        records = await processProbe('scan')
        host = records.find(item => item.pid === native.pid && lower(item.path || '') === lower(nativeExe) && item.role === 'native')
        if (host) {
          assert.equal(host.created, nativeIdentity?.created, 'Fallback NativeHost close must match the recorded PID creation time.')
          await processProbe('close-native', { pid: native.pid, created: host.created })
          await waitForExit(native)
        } else if (native.exitCode === null) {
          await waitForExit(native)
        }
      }
    } else {
      await processProbe('close-native', { pid: native.pid, created: host.created })
      await waitForExit(native)
    }
  } else if (native.exitCode === null) {
    await waitForExit(native)
  }
  records = await processProbe('scan')
  assert.equal(records.filter(item => item.pid === native.pid && lower(item.path || '') === lower(nativeExe)).length, 0, 'Isolated NativeHost exited during cleanup.')
  assert.equal(targetGroup(records).length, 0, 'No isolated Manager/Electron process remains after cleanup.')
}
async function runPreflight() {
  await updateManifest({ status: 'PREFLIGHT RUNNING' })
  await setStage('preflight', 'startup')
  await startProcesses('preflight')
  await queryShowHide('preflight')
  for (const section of ['favorites', 'settings', 'translate']) {
    const text = section === 'translate' ? 'Phase four G four preflight exact handoff' : undefined
    const main = await openManager(section, text)
    activeManagerMain = main
    await closeManager(main, 'preflight-' + section)
  }
  await queryShowHide('preflight-after-manager')
  const samples = await sampleCount()
  assert.ok(samples.count >= 2, 'Preflight needs multiple incrementally written OS samples.')
  await recordEvent('preflight-pass', { sampleCount: samples.count, finalSampleUtc: samples.lastUtc })
  await control({ type: 'exit' })
  await waitForExit(native)
  const remaining = await processProbe('scan')
  assert.equal(remaining.length, 0, 'Preflight test NativeHost and Manager processes exit normally.')
  await stopSampler()
  await updateManifest({
    status: 'PREFLIGHT PASS',
    completedAtUtc: new Date().toISOString(),
    nativeExit: childExit.get('native'),
    samplerSamples: samples.count,
    finalArchitecture: { nativeCount: 0, managerCount: 0, electronCount: 0, exit: 'normal control-pipe exit' },
    liveProductionWitnessAfter: await productionWitness(),
  })
  console.log('PREFLIGHT PASS; evidence=' + root + '; runtime=' + runtimeRoot)
}
async function runSoak() {
  await updateManifest({ status: 'SOAK RUNNING', stage: 'preparing formal 3-hour run' })
  await setStage('soak', 'startup')
  await startProcesses('formal-soak')
  assert.equal((await control({ type: 'manager-state' })).manager.processId, null)
  assert.equal(targetGroup(await processProbe('scan')).length, 0)
  soakStartedPerf = performance.now()
  nextHeartbeatAt = soakStartedPerf + heartbeatEveryMs
  const aStart = soakStartedPerf
  const aStartUtc = new Date().toISOString()
  const aCheckpoints = []
  await setStage('A', 'nativehost-only-idle')
  await recordEvent('scenario-start', { scenario: 'A', expectedDurationMinutes: 90, startedAtUtc: aStartUtc, nativePid: native.pid, samePidForScenarioAAndB: true })
  await updateManifest({ status: 'SCENARIO A RUNNING', scenarioA: { status: 'RUNNING', startedAtUtc: aStartUtc, expectedDurationMinutes: 90, checkpoints: 0 } })
  aCheckpoints.push(await saveCheckpoint('A-00', 'A', { elapsedMinutes: 0 }))
  for (const minute of [15, 30, 45, 60, 75, 90]) {
    await sleepTo(aStart + minute * 60000, 'A')
    await setStage('A', 'nativehost-only-idle', { checkpointMinutes: minute })
    const checkpoint = await saveCheckpoint('A-' + String(minute).padStart(2, '0'), 'A', { elapsedMinutes: minute })
    aCheckpoints.push(checkpoint)
    await updateManifest({ status: minute === 90 ? 'SCENARIO A COMPLETE' : 'SCENARIO A RUNNING', scenarioA: { status: minute === 90 ? 'PASS' : 'RUNNING', startedAtUtc: aStartUtc, endedAtUtc: minute === 90 ? checkpoint.utc : null, expectedDurationMinutes: 90, elapsedMilliseconds: performance.now() - aStart, checkpoints: aCheckpoints.length, latestCheckpoint: checkpoint } })
  }
  const aDuration = performance.now() - aStart
  assert.ok(aDuration >= 90 * 60 * 1000, 'Scenario A elapsed less than its required 90 minutes.')
  assert.equal(aCheckpoints.length, 7)
  await recordEvent('scenario-complete', { scenario: 'A', elapsedMilliseconds: aDuration, checkpoints: aCheckpoints.length, nativePid: native.pid })
  const bStart = performance.now()
  const bStartUtc = new Date().toISOString()
  const bCheckpoints = []
  await setStage('B', 'intermittent-usage-idle')
  await recordEvent('scenario-start', { scenario: 'B', expectedDurationMinutes: 90, groups: 6, spacingMinutes: 15, startedAtUtc: bStartUtc, nativePid: native.pid })
  await updateManifest({ status: 'SCENARIO B RUNNING', scenarioB: { status: 'RUNNING', startedAtUtc: bStartUtc, expectedDurationMinutes: 90, operations: [] } })
  for (let index = 0; index < 6; index++) {
    const scheduledStart = bStart + index * 15 * 60000
    await sleepTo(scheduledStart, 'B')
    await runUsageGroup(index)
    await setStage('B', 'intermittent-usage-idle', { completedGroups: index + 1 })
    const checkpoint = await saveCheckpoint('B-' + String(index * 15).padStart(2, '0'), 'B', { completedGroups: index + 1, elapsedMinutes: index * 15 })
    bCheckpoints.push(checkpoint)
    await updateManifest({ status: 'SCENARIO B RUNNING', scenarioB: { status: 'RUNNING', startedAtUtc: bStartUtc, expectedDurationMinutes: 90, operations: bCheckpoints.map(item => ({ checkpoint: item.name, completedGroups: item.completedGroups, utc: item.utc })) } })
  }
  await sleepTo(bStart + 90 * 60000, 'B')
  await setStage('B', 'intermittent-usage-idle', { completedGroups: 6, elapsedMinutes: 90 })
  const finalB = await saveCheckpoint('B-90', 'B', { completedGroups: 6, elapsedMinutes: 90 })
  bCheckpoints.push(finalB)
  const bDuration = performance.now() - bStart
  assert.ok(bDuration >= 90 * 60 * 1000, 'Scenario B elapsed less than its required 90 minutes.')
  assert.equal(bCheckpoints.length, 7)
  await recordEvent('scenario-complete', { scenario: 'B', elapsedMilliseconds: bDuration, checkpoints: bCheckpoints.length, operationGroups: 6, nativePid: native.pid })
  const samples = await sampleCount()
  const finalRecords = await inventory('final-before-normal-exit')
  assert.equal(targetGroup(finalRecords).length, 0)
  assert.equal(finalRecords.find(item => lower(item.path || '') === lower(nativeExe)).pid, native.pid)
  const finalState = await control({ type: 'manager-state' })
  const finalPresentation = await control({ type: 'snapshot' })
  assert.equal(finalState.manager.processId, null)
  assert.equal(finalPresentation.windowVisible, false)
  assert.equal(finalPresentation.query, '')
  await updateManifest({ status: 'FINAL ARCHITECTURE GATE RUNNING', scenarioA: { status: 'PASS', startedAtUtc: aStartUtc, elapsedMilliseconds: aDuration, checkpoints: aCheckpoints }, scenarioB: { status: 'PASS', startedAtUtc: bStartUtc, elapsedMilliseconds: bDuration, operationGroups: 6, checkpoints: bCheckpoints }, sampleCount: samples.count, finalArchitectureBeforeExit: { nativePid: native.pid, managerCount: 0, electronCount: 0, pipeResponsive: true, launcherHidden: true, queryCleared: true } })
  await recordEvent('final-normal-exit-requested', { nativePid: native.pid, source: 'isolated control pipe' })
  await control({ type: 'exit' })
  await waitForExit(native)
  const afterExit = await processProbe('scan')
  assert.equal(afterExit.length, 0, 'All isolated NativeHost and Manager processes exited normally.')
  await recordEvent('final-normal-exit-observed', { exitCode: native.exitCode, remainingTargetProcesses: afterExit.length })
  await stopSampler()
  const finalSamples = await sampleCount()
  const productionAfter = await productionWitness()
  const report = await calculateResourceTrend(finalSamples.count, aCheckpoints, bCheckpoints)
  await updateManifest({
    status: 'SOAK EVIDENCE COMPLETE — REVIEW PENDING',
    completedAtUtc: new Date().toISOString(),
    nativeExit: childExit.get('native'),
    finalArchitecture: { nativeCount: 0, managerCount: 0, electronCount: 0, exit: 'normal control-pipe exit', result: 'PASS' },
    liveProductionWitnessAfter: productionAfter,
    liveProductionUnchanged: JSON.stringify(witnessValue(initialProductionWitness)) === JSON.stringify(witnessValue(productionAfter)),
    sampleCount: finalSamples.count,
    samplerIntervalSeconds: 5,
    sampleFirstUtc: report.sampleFirstUtc,
    sampleLastUtc: report.sampleLastUtc,
    sampleCoverage: report.sampleCoverage,
    resourceTrend: report,
    evidenceSha256: await evidenceHashes(),
    phaseDecision: 'REVIEW PENDING',
  })
  console.log('SOAK WORKLOAD COMPLETE; samples=' + finalSamples.count + '; evidence=' + root)
}
async function runUsageGroup(index) {
  const groupLabel = 'B-GROUP-' + String(index + 1).padStart(2, '0')
  const section = ['favorites', 'settings', 'translate', 'favorites', 'settings', 'translate'][index]
  const started = performance.now()
  await setStage('B', groupLabel + '-start', { group: index + 1, managerSection: section })
  await recordEvent('usage-group-start', { group: index + 1, section })
  await queryShowHide(groupLabel)
  await recordEvent('usage-group-launcher-complete', { group: index + 1 })
  const handoff = section === 'translate' ? 'Phase four G four local UI handoff ' + ['one', 'two', 'three', 'four', 'five', 'six'][index] : undefined
  const main = await openManager(section, handoff)
  activeManagerMain = main
  const runningRecords = await processProbe('scan')
  const runningGroup = targetGroup(runningRecords)
  assert.equal(runningGroup.filter(item => item.role === 'main' && lower(item.path) === lower(managerExe)).length, 1)
  await appendProcessRows(runningGroup, groupLabel + '-manager-running')
  await recordEvent('usage-group-manager-open', { group: index + 1, section, mainPid: main.pid, processGroupMembers: runningGroup.map(item => item.pid) })
  await closeManager(main, groupLabel)
  await recordEvent('usage-group-electron-zero', { group: index + 1, section, elapsedMs: performance.now() - started })
  await queryShowHide(groupLabel + '-after-manager')
  await recordEvent('usage-group-complete', { group: index + 1, section, nativePid: native.pid, elapsedMs: performance.now() - started })
}
async function calculateResourceTrend(sampleTotal, aCheckpoints, bCheckpoints) {
  const text = await readFile(join(root, 'process-samples.jsonl'), 'utf8')
  const samples = text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line.replace(/^\uFEFF/, '')))
  const nativeRows = []
  const managerRows = []
  const timestamps = []
  for (const sample of samples) {
    const item = sample.processes.find(process => lower(process.path || '') === lower(nativeExe) && process.pid === native.pid)
    if (item) {
      timestamps.push(Date.parse(sample.utc))
      nativeRows.push({
        utc: sample.utc, stage: sample.stage, privateBytes: item.privateBytes, workingSet: item.workingSet,
        handles: item.handles, threads: item.threads, gdi: item.gdi, user: item.user,
        managerCount: sample.processes.filter(process => lower(process.path || '') !== lower(nativeExe)).length,
      })
    }
    for (const proc of sample.processes) if (lower(proc.path || '').startsWith(lower(managerRoot) + '\\')) managerRows.push(proc)
  }
  const intervals = timestamps.slice(1).map((value, index) => (value - timestamps[index]) / 1000).filter(value => Number.isFinite(value) && value > 0)
  const median = values => {
    if (!values.length) return null
    const sorted = [...values].sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  }
  const numericValues = values => values.filter(value => value !== null && value !== undefined && value !== '').map(Number).filter(Number.isFinite)
  const summarize = values => {
    const numbers = numericValues(values)
    return numbers.length ? { count: numbers.length, min: Math.min(...numbers), median: median(numbers), max: Math.max(...numbers), first: numbers[0], last: numbers.at(-1) } : { count: 0, min: null, median: null, max: null, first: null, last: null }
  }
  const metric = name => {
    return summarize(nativeRows.map(row => row[name]))
  }
  const idleAtCheckpoints = [...aCheckpoints, ...bCheckpoints]
  const idleStats = {}
  for (const key of ['privateBytes', 'workingSet', 'handles', 'threads', 'gdi', 'user']) {
    idleStats[key] = summarize(idleAtCheckpoints.map(item => item.nativeMetrics[key]))
  }
  const eventLines = (await readFile(join(root, 'lifecycle-events.jsonl'), 'utf8')).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line.replace(/^\uFEFF/, '')))
  const operationStarts = eventLines.filter(item => item.type === 'usage-group-start').length
  const elapsedMs = timestamps.length > 1 ? timestamps.at(-1) - timestamps[0] : 0
  const largeGaps = intervals.filter(value => value > 15)
  return {
    sampleCount: sampleTotal,
    nativeSampleCount: nativeRows.length,
    managerProcessSampleRecords: managerRows.length,
    sampleFirstUtc: nativeRows[0]?.utc ?? null,
    sampleLastUtc: nativeRows.at(-1)?.utc ?? null,
    elapsedMilliseconds: elapsedMs,
    elapsedHours: Number((elapsedMs / 3600000).toFixed(3)),
    expectedMinimumHours: 3,
    medianSampleIntervalSeconds: median(intervals),
    maximumSampleIntervalSeconds: intervals.length ? Math.max(...intervals) : null,
    intervalsOver15Seconds: largeGaps.length,
    sampleCoveragePercent: Number((nativeRows.length / Math.max(1, elapsedMs / 5000) * 100).toFixed(2)),
    nativeMetricsAcrossSoak: {
      privateBytes: metric('privateBytes'), workingSet: metric('workingSet'), handles: metric('handles'),
      threads: metric('threads'), gdi: metric('gdi'), user: metric('user'),
    },
    equivalentHiddenLauncherManagerClosedCheckpoints: idleStats,
    scenarioACheckpoints: aCheckpoints.map(item => ({ name: item.name, utc: item.utc, nativeMetrics: item.nativeMetrics, pipeRoundTripMs: item.pipeRoundTripMs })),
    scenarioBCheckpoints: bCheckpoints.map(item => ({ name: item.name, utc: item.utc, nativeMetrics: item.nativeMetrics, pipeRoundTripMs: item.pipeRoundTripMs })),
    usageGroupStarts: operationStarts,
    trendAssessment: 'Review time series and equivalent idle checkpoint medians; no absolute MB threshold is applied.',
  }
}
async function evidenceHashes() {
  const result = {}
  for (const name of ['process-samples.jsonl', 'manager-processes.csv', 'lifecycle-events.jsonl', 'checkpoints.json', 'errors.json']) result[name] = await hashFile(join(root, name))
  return result
}

try {
  throwIfInterrupted()
  await assertNoReparsePath(tempRoot, root, 'Evidence root')
  await assertNoReparsePath(tempRoot, runtimeRoot, 'Runtime root')
  await mkdir(profileRoot, { recursive: true })
  await writeAtomicJson(join(root, 'errors.json'), [])
  await durableAppend(join(root, 'lifecycle-events.jsonl'), JSON.stringify({ utc: new Date().toISOString(), type: 'manifest-initialized', sourceHead, mode, runtimeRoot, artifacts: artifactHashes }))
  await updateManifest({
    phase: 'Phase 4G-4',
    mode,
    status: 'STARTING',
    sourceHead,
    nativePid: null,
    nativeCreatedUtc: null,
    runtimeRoot,
    evidenceRoot: root,
    profileRoot,
    controlPipeName: pipeName,
    debuggerPort: debugPort,
    startedAtUtc: new Date().toISOString(),
    scenarioA: { status: mode === 'soak' ? 'PENDING' : 'NOT_APPLICABLE' },
    scenarioB: { status: mode === 'soak' ? 'PENDING' : 'NOT_APPLICABLE' },
    artifactSha256: artifactHashes,
    liveProductionWitnessBefore: initialProductionWitness,
    eventFiles: ['process-samples.jsonl', 'manager-processes.csv', 'lifecycle-events.jsonl', 'checkpoints.json', 'errors.json'],
  })
  probe.stdin.on('error', error => { void appendError(error, 'process-probe-stdin') })
  const samplerStartDeadline = Date.now() + 10000
  while (sampler.exitCode === null && !childErrors.has('sampler') && !await stat(join(root, 'process-samples.jsonl')).then(() => true).catch(() => false) && Date.now() < samplerStartDeadline) await delay(100)
  assert.ok(!childErrors.has('sampler'), 'Sampler failed to start: ' + childErrors.get('sampler')?.message)
  assert.equal(sampler.exitCode, null, 'Sampler starts successfully.')
  assert.ok(await stat(join(root, 'process-samples.jsonl')).then(() => true).catch(() => false), 'Sampler wrote its first process sample.')
  throwIfInterrupted()
  if (mode === 'preflight') await runPreflight()
  else await runSoak()
} catch (error) {
  await appendError(error, currentStage?.step || mode).catch(() => {})
  await recordEvent('failure', { message: error.message, stack: error.stack }).catch(() => {})
  await updateManifest({ status: 'INCOMPLETE — REVIEW REQUIRED', failure: { message: error.message, stack: error.stack, stage: currentStage?.step || mode }, phaseDecision: 'INCOMPLETE' }).catch(() => {})
  console.error(error)
  process.exitCode = interruptionSignal === 'SIGINT' ? 130 : interruptionSignal === 'SIGTERM' ? 143 : 1
} finally {
  cdp?.close()
  if (native) await stopNativeNormally().catch(error => appendError(error, 'safe-normal-cleanup'))
  socket?.destroy()
  await writeFile(join(root, 'sampler.stop'), 'stop\n', 'utf8').catch(() => {})
  if (sampler.exitCode === null) {
    const deadline = Date.now() + 15000
    while (sampler.exitCode === null && Date.now() < deadline) await delay(100)
    if (sampler.exitCode === null) await appendError(new Error('Sampler did not exit after the bounded stop wait; it was left running rather than terminated by process name.'), 'sampler-cleanup').catch(() => {})
  }
  if (probe.exitCode === null) {
    probe.stdin.end()
    await waitForExit(probe, 5000).catch(error => appendError(error, 'probe-cleanup'))
  }
  const productionAfter = await productionWitness().catch(error => ({ error: error.message }))
  const manifestStatus = manifest.status
  await updateManifest({
    finalizerAtUtc: new Date().toISOString(),
    finalizerNativeExit: native ? childExit.get('native') : null,
    finalizerSamplerExit: childExit.get('sampler'),
    finalizerProbeExit: childExit.get('probe'),
    liveProductionWitnessAfterFinalizer: productionAfter,
    liveProductionUnchanged: JSON.stringify(witnessValue(initialProductionWitness)) === JSON.stringify(witnessValue(productionAfter)),
    phaseDecision: manifestStatus === 'PREFLIGHT PASS' ? 'PREFLIGHT PASS' : manifestStatus === 'SOAK EVIDENCE COMPLETE — REVIEW PENDING' ? 'REVIEW PENDING' : 'INCOMPLETE',
  }).catch(() => {})
  console.log('Evidence: ' + root)
}
