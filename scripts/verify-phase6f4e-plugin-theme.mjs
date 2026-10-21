import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createHash, randomUUID } from 'node:crypto'
import { createConnection, createServer } from 'node:net'
import { createInterface } from 'node:readline'
import { copyFile, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDefaultAppData } from '../src/shared/domain.ts'
import { ThemeAcceptanceOwnership } from './lib/plugin-theme-acceptance-ownership.mjs'

// This runner uses only the existing packaged/TEMP acceptance opt-in. It never
// adds a production theme control, permission or private plugin API.
const repo = resolve(fileURLToPath(new URL('..', import.meta.url)))
const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  assert.ok(process.argv[i].startsWith('--') && process.argv[i + 1], 'Expected --name value arguments')
  args.set(process.argv[i].slice(2), process.argv[i + 1])
}
function required(name) { const value = args.get(name); assert.ok(value, `Missing --${name}`); return value }
function within(parent, path) { const rel = relative(parent, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`) }
async function tempPath(path, directory = true) {
  assert.ok(isAbsolute(path), 'Acceptance path must be absolute')
  const temp = await realpath(tmpdir()); const full = resolve(path)
  assert.ok(within(temp, full) && temp.toLowerCase() !== full.toLowerCase(), 'Acceptance paths must be strict TEMP descendants')
  let current = temp
  for (const part of relative(temp, full).split(sep)) {
    current = join(current, part)
    assert.equal((await lstat(current)).isSymbolicLink(), false, `Links/reparse points are not allowed: ${current}`)
  }
  assert.equal((await realpath(full)).toLowerCase(), full.toLowerCase())
  assert.equal((await lstat(full)).isDirectory(), directory)
  return full
}
const root = await tempPath(required('root'))
const nativeRoot = await tempPath(required('native-root'))
const managerRoot = await tempPath(required('manager-root'))
const nativeExe = await tempPath(join(nativeRoot, 'WebTools.NativeHost.exe'), false)
const managerExe = await tempPath(join(managerRoot, 'WebTools.exe'), false)
const fixture = await tempPath(required('package'), false)
const fault = args.get('fault')
assert.ok(!fault || ['before-pipe', 'interrupt-before-identity', 'interrupt-after-native'].includes(fault), 'Unknown test-only failure injection')
const ownership = new ThemeAcceptanceOwnership(nativeExe, managerExe)
const profile = join(root, 'profile')
await mkdir(profile) // Refuse profile reuse, including a previous failed run.
await mkdir(join(root, 'fixtures'))
for (const name of ['fixture', 'update', 'isolation']) await copyFile(fixture, join(root, 'fixtures', `plugin-runtime-${name}.wtplugin`))
const data = createDefaultAppData()
data.settings.theme = 'light'; data.settings.quickSearchShortcut = 'Control+Alt+Shift+F12'
await writeFile(join(profile, 'nook-data.json'), JSON.stringify(data))
await writeFile(join(profile, 'launcher-state.json'), JSON.stringify({ schemaVersion: 1,
  quickSearchShortcut: data.settings.quickSearchShortcut, theme: 'light', launcherDisplayMode: 'compact', launchOnStartup: false,
  searchEngines: data.settings.searchEngines, defaultSearchEngineId: 'google', everythingEnabled: false, everythingEsPath: '', websites: [], appSearchMemory: [] }))
await writeFile(join(profile, 'catalog.json'), JSON.stringify({ schemaVersion: 1, generatedAtUtc: new Date().toISOString(), apps: [] }))
await writeFile(join(profile, 'plugin-runtime-controls.json'), JSON.stringify({ package: 'fixture', deleteData: true }))
const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex')
const report = { status: 'IN_PROGRESS', startedAt: new Date().toISOString(), root, profile,
  artifacts: { nativeExe, managerExe, nativeSha256: await hash(nativeExe), managerSha256: await hash(managerExe), asarSha256: await hash(join(managerRoot, 'resources', 'app.asar')), packageSha256: await hash(fixture) },
  cases: [], manual: { actualWindowsThemeSwitch: 'MANUAL VERIFICATION REQUIRED', physicalKeyboardAndVisualSanity: 'MANUAL VERIFICATION REQUIRED' } }
const save = () => writeFile(join(root, 'theme-acceptance.json'), `${JSON.stringify(report, null, 2)}\n`)
const pause = ms => new Promise(done => setTimeout(done, ms))
let native; let probe; let controlSocket; let controlReader; let manager; let interrupted = false
const connections = new Set(); const pendingControlSockets = new Set()
async function until(read, accepts, label, milliseconds = 30_000) {
  const end = Date.now() + milliseconds; let value
  while (Date.now() < end) { assert.equal(interrupted, false, 'Acceptance interrupted'); value = await read(); if (accepts(value)) return value; await pause(100) }
  throw new Error(`Timed out: ${label}; last=${JSON.stringify(value)}`)
}
async function run(file, args) {
  const child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''; let error = ''; child.stdout.on('data', value => { out += value }); child.stderr.on('data', value => { error += value })
  let timer
  const result = await Promise.race([once(child, 'exit'), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out: ${file}`)), 20_000) })]).finally(() => clearTimeout(timer))
  assert.equal(result[0], 0, error || out); return out.trim()
}
const requests = []
async function inventory(type = 'scan', identity) {
  return new Promise((resolveReply, reject) => {
    const timer = setTimeout(() => reject(new Error('Identity probe timed out')), 15_000)
    requests.push({ resolve: value => { clearTimeout(timer); if (value.ok) { ownership.observe(value.processes); resolveReply(value.processes) } else reject(new Error(value.error)) }, reject: error => { clearTimeout(timer); reject(error) } })
    probe.stdin.write(`${JSON.stringify({ type, pid: identity?.pid, created: identity?.created })}\n`)
  })
}
const electron = rows => rows.filter(row => row.path?.toLowerCase().startsWith(`${managerRoot}${sep}`.toLowerCase()))
const main = rows => electron(ownership.live(rows)).find(row => row.role === 'main')
const hosts = rows => rows.filter(row => row.path?.toLowerCase() === nativeExe.toLowerCase())
const pipeName = `WebTools.NativeHost.Resource.6F4E_${randomUUID().replaceAll('-', '')}`
async function connectControl() {
  await until(async () => {
    const socket = createConnection(`\\\\.\\pipe\\${pipeName}`)
    pendingControlSockets.add(socket)
    try {
      await new Promise((ok, fail) => { const timer = setTimeout(() => fail(new Error('pipe connect timed out')), 1500); socket.once('connect', () => { clearTimeout(timer); ok() }); socket.once('error', error => { clearTimeout(timer); fail(error) }) })
      const reader = createInterface({ input: socket }); const value = await nextLine(reader, 60_000)
      assert.equal(value.processId, native.pid); assert.equal(value.ok, true)
      controlSocket = socket; controlReader = reader; return true
    } catch { socket.destroy(); return false }
    finally { pendingControlSockets.delete(socket) }
  }, Boolean, 'isolated NativeHost pipe', 90_000)
}
function nextLine(reader, timeout = 20_000) {
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => { cleanup(); fail(new Error('Control response timed out')) }, timeout)
    const cleanup = () => { clearTimeout(timer); reader.off('line', line); reader.off('close', closed) }
    const line = text => { cleanup(); try { ok(JSON.parse(text)) } catch (error) { fail(error) } }
    const closed = () => { cleanup(); fail(new Error('Control pipe closed')) }
    reader.once('line', line); reader.once('close', closed)
  })
}
async function control(command) { const answer = nextLine(controlReader); controlSocket.write(`${JSON.stringify(command)}\n`); const value = await answer; assert.equal(value.ok, true); assert.equal(value.processId, native.pid); return value }
const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening')
const port = server.address().port; await new Promise(done => server.close(done))
class CDP {
  constructor(socket, target) {
    this.socket = socket; this.target = target; this.next = 0; this.pending = new Map()
    socket.addEventListener('message', ({ data }) => {
      const value = JSON.parse(data); const task = this.pending.get(value.id); if (!task) return
      this.pending.delete(value.id); clearTimeout(task.timer); value.error ? task.reject(new Error(value.error.message)) : task.resolve(value.result)
    })
    socket.addEventListener('close', () => { for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(new Error('CDP closed')) } this.pending.clear() })
    connections.add(this)
  }
  call(method, params = {}) { return new Promise((resolveReply, reject) => { const id = ++this.next; const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 20_000); this.pending.set(id, { resolve: resolveReply, reject, timer }); this.socket.send(JSON.stringify({ id, method, params })) }) }
  async evaluate(expression) { const result = await this.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result?.value }
  close() { this.socket.close(); connections.delete(this) }
}
async function targets() {
  try { const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) }); return await response.json() }
  catch (error) { if (['TypeError', 'TimeoutError'].includes(error.name)) return []; throw error }
}
async function connect(target) { const socket = new WebSocket(target.webSocketDebuggerUrl); await Promise.race([once(socket, 'open'), pause(5000).then(() => { throw new Error('CDP connect timeout') })]); const cdp = new CDP(socket, target); await cdp.call('Runtime.enable'); return cdp }
async function managerPage() { const target = await until(async () => (await targets()).find(t => t.type === 'page' && t.url.endsWith('/out/renderer/index.html')), Boolean, 'Manager target'); const cdp = await connect(target); await until(() => cdp.evaluate('!!window.desktop && document.readyState === "complete"'), Boolean, 'Manager preload'); return cdp }
const id = 'org.webtools.acceptance.runtime'
async function openFeature(feature) {
  const result = await manager.evaluate(`window.desktop.pluginCatalog.open(${JSON.stringify({ kind: 'web', id, featureId: feature })})`)
  assert.equal(result.ok, true, JSON.stringify(result))
  const target = await until(async () => (await targets()).find(t => t.type === 'page' && t.url.startsWith('webtools-plugin:') && t.url.includes(`/web/${feature}/`)), Boolean, `Plugin ${feature} target`)
  const cdp = await connect(target)
  await until(() => cdp.evaluate('!!document.querySelector("#field")'), Boolean, `${feature} framework mounted`)
  return cdp
}
async function setTheme(value) { const result = await manager.evaluate(`window.desktop.updateSettings({theme:${JSON.stringify(value)}})`); assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.data.theme, value) }
const readStyle = `(()=>{const root=getComputedStyle(document.documentElement),body=getComputedStyle(document.body);return {scheme:root.getPropertyValue('--webtools-color-scheme').trim(),controlScheme:root.colorScheme,bg:body.backgroundColor,text:body.color,width:document.querySelector('main').getBoundingClientRect().width,framework:document.documentElement.dataset.framework,viewport:innerWidth,dpr:devicePixelRatio}})()`
const helper = join(root, 'window-operation.ps1')
await writeFile(helper, String.raw`param([string]$Exe,[int]$TargetPid,[string]$Created,[string]$Title,[ValidateSet('inspect','resize','close','terminate')][string]$Action='inspect',[int]$Width=960,[int]$Height=680)
$ErrorActionPreference='Stop'
$path=[IO.Path]::GetFullPath($Exe)
if(-not $path.StartsWith([IO.Path]::GetTempPath(),[StringComparison]::OrdinalIgnoreCase)){throw 'Executable must be under TEMP'}
$p=Get-CimInstance Win32_Process -Filter "ProcessId=$TargetPid"
if(-not $p -or -not [string]::Equals($p.ExecutablePath,$path,[StringComparison]::OrdinalIgnoreCase) -or $p.CreationDate.ToUniversalTime().ToString('O') -ne $Created){throw 'Process identity mismatch'}
if($Action -eq 'terminate'){
 $target=[Diagnostics.Process]::GetProcessById($TargetPid)
 try {
  if(($target.StartTime.ToUniversalTime()-[DateTime]::Parse($Created).ToUniversalTime()).Duration().TotalMilliseconds -gt 0.01){throw 'Process handle creation time mismatch'}
  $target.Kill()
 } finally {$target.Dispose()}
 exit 0
}
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class ThemeWindow {
 public delegate bool EnumProc(IntPtr h,IntPtr l);
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb,IntPtr p);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr z,int x,int y,int w,int n,uint flags);
 [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
 public static long[] Find(int pid,string title){var list=new List<long>();EnumWindows((h,l)=>{uint p;GetWindowThreadProcessId(h,out p);var s=new StringBuilder(512);GetWindowText(h,s,s.Capacity);if(p==pid&&s.ToString()==title)list.Add(h.ToInt64());return true;},IntPtr.Zero);return list.ToArray();}
}
'@
$windows=@([ThemeWindow]::Find($TargetPid,$Title));if($windows.Count -ne 1){throw 'Expected exactly one title-matched window in authenticated process'}
$h=[IntPtr][long]$windows[0]
if($Action -eq 'resize' -and (-not [ThemeWindow]::SetWindowPos($h,[IntPtr]::Zero,0,0,$Width,$Height,22))){throw 'Resize failed'}
if($Action -eq 'close' -and (-not [ThemeWindow]::PostMessage($h,0x10,[IntPtr]::Zero,[IntPtr]::Zero))){throw 'WM_CLOSE failed'}
@{hwnd=$windows[0];visible=[ThemeWindow]::IsWindowVisible($h);dpi=[ThemeWindow]::GetDpiForWindow($h)}|ConvertTo-Json -Compress
`)
async function windowAction(feature, action = 'inspect', width = 960) {
  const identity = main(await inventory()); assert.ok(identity, 'One identity-checked Manager Main is required')
  return JSON.parse(await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Exe', managerExe, '-TargetPid', String(identity.pid), '-Created', identity.created, '-Title', `Theme ${feature}`, '-Action', action, '-Width', String(width), '-Height', '680']))
}
async function closeFeature(feature, cdp) {
  cdp.close(); await windowAction(feature, 'close')
  await until(async () => !(await targets()).some(t => t.url.startsWith('webtools-plugin:') && t.url.includes(`/web/${feature}/`)), Boolean, 'normal Plugin Window WM_CLOSE')
}

function interrupt() {
  interrupted = true; process.exitCode = 1
  report.interrupted = true
  for (const cdp of connections) cdp.close()
  for (const socket of pendingControlSockets) socket.destroy()
  controlSocket?.destroy(); controlReader?.close()
}
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt)
async function cleanupOwned() {
  // This run's captured identities are the sole authority for operations. A
  // failed preflight owns nothing, even if the configured binary is running.
  if (!ownership.identities.size && native?.pid && native.exitCode === null) {
    // An interrupt can arrive between spawn() and the first CIM observation.
    // Acquire only that still-live child, never a path-matched preflight host.
    try { ownership.claimNative(await inventory(), native.pid, process.pid) }
    catch (error) { report.cleanupWarnings = [error.message] }
  }
  if (!ownership.identities.size) {
    report.remaining = native?.exitCode === null ? 'NOT VERIFIED' : []
    if (report.remaining === 'NOT VERIFIED') { report.status = 'FAIL'; process.exitCode = 1 }
    return
  }
  controlSocket?.destroy(); controlReader?.close()
  const warnings = []; let rows
  try {
    rows = await inventory()
    const managerIdentity = main(rows)
    if (managerIdentity) await inventory('close', managerIdentity).catch(error => warnings.push(error.message))
    const nativeIdentity = ownership.live(rows).find(row => row.role === 'native')
    if (nativeIdentity) await inventory('close-native', nativeIdentity).catch(error => warnings.push(error.message))
    const end = Date.now() + 5000
    do { rows = await inventory(); if (!ownership.live(rows).length) break; await pause(100) } while (Date.now() < end)
  } catch (error) { warnings.push(error.message) }
  // Failure/interrupt fallback only. Reacquire an OS handle after checking the
  // exact path + PID + creation time; never terminate by executable name.
  const candidates = rows ? ownership.live(rows) : [...ownership.identities.values()]
  for (const identity of candidates.sort((a, b) => (a.role === 'native') - (b.role === 'native'))) {
    try {
      await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Exe', identity.path, '-TargetPid', String(identity.pid), '-Created', identity.created, '-Action', 'terminate'])
      ;(report.forcedCleanup ??= []).push({ pid: identity.pid, path: identity.path, created: identity.created })
    } catch (error) { warnings.push(error.message) }
  }
  try {
    const remaining = await inventory(); report.remaining = ownership.live(remaining)
    report.unownedObservedAtCleanup = remaining.filter(row => !ownership.same(row, ownership.identities.get(row.pid)))
  } catch (error) { report.remaining = 'NOT VERIFIED'; warnings.push(error.message) }
  if (warnings.length) report.cleanupWarnings = warnings
  if (report.remaining === 'NOT VERIFIED' || report.remaining.length || report.forcedCleanup?.length) { report.status = 'FAIL'; process.exitCode = 1 }
}

try {
  await save()
  probe = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(repo, 'scripts/measure-plugin-runtime-processes.ps1'), '-TestRoot', root, '-NativeRoot', nativeRoot, '-ManagerRoot', managerRoot], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  probe.stderr.on('data', chunk => { console.error(String(chunk)) })
  createInterface({ input: probe.stdout }).on('line', line => { const pending = requests.shift(); if (pending) { try { pending.resolve(JSON.parse(line)) } catch (error) { pending.reject(error) } } })
  probe.on('error', error => { for (const pending of requests.splice(0)) pending.reject(error) })
  probe.on('exit', () => { for (const pending of requests.splice(0)) pending.reject(new Error('Identity probe exited')) })
  const before = await inventory(); assert.equal(hosts(before).length, 0); assert.equal(electron(before).length, 0)
  const env = { ...process.env, WEBTOOLS_MANAGER_EXE: managerExe, WEBTOOLS_MANAGER_TEST_DEBUG_PORT: String(port), WEBTOOLS_PLUGIN_RUNTIME_ACCEPTANCE: '1', WEBTOOLS_PLUGIN_RUNTIME_TEST_ROOT: root, WEBTOOLS_PLUGIN_RUNTIME_TEST_PROFILE: profile, WEBTOOLS_PLUGIN_RUNTIME_TEST_DEBUG_PORT: String(port) }
  delete env.ELECTRON_RUN_AS_NODE
  native = spawn(nativeExe, ['--phase4e-resource-test', profile, join(profile, 'catalog.json'), pipeName, 'Control+Alt+Shift+F12'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  native.on('error', error => { report.spawnError = error.message })
  if (fault === 'interrupt-before-identity') process.emit('SIGINT')
  const output = []; for (const stream of [native.stdout, native.stderr]) stream.on('data', bytes => { output.push(bytes.toString()); if (output.length > 100) output.shift() })
  await until(async () => ownership.claimNative(await inventory(), native.pid, process.pid), Boolean, 'capture the launched NativeHost identity')
  if (fault === 'before-pipe') throw new Error('TEST-ONLY FAILURE: before pipe connection')
  if (fault === 'interrupt-after-native') process.emit('SIGINT')
  await connectControl()
  const first = await inventory(); assert.equal(hosts(first).length, 1); assert.equal(hosts(first)[0].pid, native.pid); assert.equal(electron(first).length, 0)
  report.nativeIdentity = hosts(first)[0]; report.nativeOnlyElectronCount = 0
  await control({ type: 'manager-open', section: 'settings' }); manager = await managerPage()
  const installed = await manager.evaluate('window.desktop.plugins.installFromUserDialog()'); assert.equal(installed.ok, true, JSON.stringify(installed))
  const enabled = await manager.evaluate(`window.desktop.plugins.setEnabled('${id}',true)`); assert.equal(enabled.ok, true, JSON.stringify(enabled))
  report.installedRegistry = JSON.parse(await readFile(join(profile, 'plugins', 'registry.json'), 'utf8')).plugins.map(p => ({ id: p.id, version: p.current.version, hash: p.current.hash }))
  for (const feature of ['vanilla', 'vue', 'react', 'svelte', 'plain']) {
    console.log(`[plugin-theme] ${feature}`)
    await setTheme('light'); const cdp = await openFeature(feature); const win = await windowAction(feature)
    assert.equal(win.visible, true)
    const light = await until(() => cdp.evaluate(readStyle), value => value.scheme === 'light', 'initial light variables')
    assert.equal(light.framework, feature)
    await setTheme('dark')
    const dark = await until(() => cdp.evaluate(readStyle), value => value.scheme === 'dark', 'live dark variables')
    if (feature === 'plain') {
      assert.equal(light.bg, 'rgb(248, 238, 221)'); assert.equal(light.text, 'rgb(68, 40, 17)')
      assert.equal(dark.bg, light.bg); assert.equal(dark.text, light.text); assert.equal(dark.width, light.width); assert.equal(dark.controlScheme, 'normal')
    } else {
      assert.equal(light.controlScheme, 'light'); assert.equal(light.bg, 'rgb(243, 245, 248)'); assert.equal(light.text, 'rgb(27, 38, 51)')
      assert.equal(dark.controlScheme, 'dark'); assert.equal(dark.bg, 'rgb(11, 12, 14)'); assert.equal(dark.text, 'rgb(244, 244, 245)')
    }
    await setTheme('system')
    const systemSignal = await cdp.evaluate('matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"')
    const system = await until(() => cdp.evaluate(readStyle), value => value.scheme === systemSignal, 'live system preference resolution')
    await manager.evaluate(`window.desktop.pluginCatalog.open(${JSON.stringify({ kind: 'web', id, featureId: feature })})`)
    assert.equal((await windowAction(feature)).hwnd, win.hwnd, 'same Feature reuses the same HWND')
    assert.equal((await targets()).filter(t => t.url === cdp.target.url).length, 1)
    await windowAction(feature, 'resize', 600); const narrow = await until(() => cdp.evaluate(readStyle), value => value.viewport < 600, 'narrow viewport')
    await windowAction(feature, 'resize', 1080); const wide = await until(() => cdp.evaluate(readStyle), value => value.viewport > narrow.viewport, 'wide viewport')
    await cdp.evaluate('document.querySelector("#field").focus()')
    await cdp.call('Input.insertText', { text: 'theme-check' })
    assert.equal(await cdp.evaluate('document.querySelector("#field").value'), 'theme-check')
    const screenshot = await cdp.call('Page.captureScreenshot', { format: 'png' }); await writeFile(join(root, `${feature}-system.png`), Buffer.from(screenshot.data, 'base64'))
    report.cases.push({ feature, result: 'PASS', light, dark, system, reusedHwnd: win.hwnd, dpi: win.dpi, narrow: narrow.viewport, wide: wide.viewport, simulatedKeyboardInput: 'PASS' })
    await closeFeature(feature, cdp)
    const reopened = await openFeature(feature); await closeFeature(feature, reopened)
    await save()
  }
  await setTheme('dark'); const reload = await openFeature('vanilla')
  await reload.call('Page.reload').catch(() => {}); reload.close()
  await until(async () => !(await targets()).some(t => t.url.startsWith('webtools-plugin:')), Boolean, 'cross-document reload revokes old runtime')
  const afterReload = await openFeature('vanilla'); assert.equal((await afterReload.evaluate(readStyle)).scheme, 'dark'); await closeFeature('vanilla', afterReload)
  report.reload = 'PASS — policy closes cross-document reload; fresh authority reapplies current theme'
  const trace = (await readFile(join(profile, 'plugin-runtime-trace.jsonl'), 'utf8')).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
  report.themeTrace = trace.filter(row => ['theme-applied', 'runtime-ready'].includes(row.event))
  for (const ready of report.themeTrace.filter(row => row.event === 'runtime-ready')) {
    assert.ok(report.themeTrace.slice(0, report.themeTrace.indexOf(ready)).some(row => row.event === 'theme-applied' && row.details.generation === ready.details.generation), 'actual runtime theme must precede READY')
  }
  manager.close(); manager = null
  await inventory('close', main(await inventory()))
  await until(async () => electron(await inventory()).length, value => value === 0, 'normal Manager close returns Electron to zero')
  report.managerCloseElectronCount = 0; assert.equal(hosts(await inventory()).length, 1)
  await control({ type: 'exit' }); await until(() => inventory(), rows => !hosts(rows).length && !electron(rows).length, 'final exact executable cleanup')
  report.status = 'AUTOMATED_PACKAGED_PASS'; report.finishedAt = new Date().toISOString()
} catch (error) {
  report.status = 'FAIL'; report.error = { message: error.message, stack: error.stack }; process.exitCode = 1
} finally {
  for (const cdp of connections) cdp.close()
  await cleanupOwned()
  controlSocket?.destroy(); controlReader?.close(); probe?.stdin.end()
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt)
  await save(); console.log(`Theme acceptance evidence: ${join(root, 'theme-acceptance.json')}`)
}
