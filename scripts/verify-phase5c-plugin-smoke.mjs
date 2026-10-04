import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { createConnection, createServer } from 'node:net'
import { createInterface } from 'node:readline'
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertSafeManagerEvidenceRoot } from './lib/manager-lifecycle-evidence.mjs'
import { createDefaultAppData } from '../src/shared/domain.ts'
import { PluginManager } from '../electron/plugins/plugin-manager.ts'
import { packageBytes, manifest, png } from '../electron/plugins/fixtures.mjs'

// Short packaged dependency/lifecycle smoke only. No installer, UI consent bypass
// in product code, production profile access, paid AI, or stress workload.
const repo = resolve(fileURLToPath(new URL('..', import.meta.url)))
const root = assertSafeManagerEvidenceRoot(resolve(process.argv[2] ?? ''))
const nativeSource = resolve(process.argv[3] ?? '')
assert.ok(nativeSource.startsWith(join(repo, 'release') + '\\'), 'Reuse only an existing repository Release Native artifact')
const nativeRoot = join(root, 'Native'); const profile = join(root, 'profile')
assertSafeManagerEvidenceRoot(join(root, 'manager-build', 'win-unpacked'))
await mkdir(profile); await cp(nativeSource, nativeRoot, { recursive: true, errorOnExist: true, force: false })
const nativeExe = join(nativeRoot, 'WebTools.NativeHost.exe'); const managerExe = join(root, 'manager-build', 'win-unpacked', 'WebTools.exe')
const data = createDefaultAppData(); data.settings.quickSearchShortcut = 'Control+Alt+Shift+F12'; data.settings.translation.engine = 'ai'
await writeFile(join(profile, 'nook-data.json'), JSON.stringify(data))
await writeFile(join(profile, 'launcher-state.json'), JSON.stringify({ schemaVersion: 1, quickSearchShortcut: data.settings.quickSearchShortcut, theme: 'dark', launcherDisplayMode: 'compact', launchOnStartup: false, searchEngines: data.settings.searchEngines, defaultSearchEngineId: 'google', everythingEnabled: false, everythingEsPath: '', websites: [], appSearchMemory: [] }))
await writeFile(join(profile, 'catalog.json'), JSON.stringify({ schemaVersion: 1, generatedAtUtc: new Date().toISOString(), apps: [] }))
const seed = new PluginManager({ userData: profile, hostVersion: '0.1.0', confirm: async () => true, externalOpen: async () => { throw new Error('not used') }, clipboardWrite: () => { throw new Error('not used') }, ai: { getDefaultProviderInfo: async () => { throw new Error('not used') }, complete: async () => { throw new Error('not used') } } })
await seed.initialize()
const demo = manifest({ entry: { pageId: 'home', label: 'Smoke', icon: 'assets/icon.png' }, assets: [{ path: 'assets/icon.png', type: 'image/png' }] })
await seed.install(packageBytes(demo, [{ name: 'assets/icon.png', data: png() }]), seed.session); await seed.setEnabled(demo.id, true, seed.session); seed.close()
const report = { root, sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', windowsHide: true }).trim(), dirtySource: true, artifacts: {}, seedConsent: 'TEST-ONLY MOCK — native user dialogs NOT TESTED', checkpoints: [], result: 'INCOMPLETE' }
async function hash(path) { return createHash('sha256').update(await readFile(path)).digest('hex') }
report.artifacts = { nativeExe: await hash(nativeExe), nativeDll: await hash(join(nativeRoot, 'WebTools.NativeHost.dll')), managerExe: await hash(managerExe), asar: await hash(join(root, 'manager-build', 'win-unpacked', 'resources', 'app.asar')) }
const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening'); const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve))
const pipeName = `WebTools.NativeHost.Resource.P5C${randomUUID().replaceAll('-', '')}`
const env = { ...process.env, WEBTOOLS_MANAGER_EXE: managerExe, WEBTOOLS_MANAGER_TEST_DEBUG_PORT: String(port) }; delete env.ELECTRON_RUN_AS_NODE
const probe = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(repo, 'native/scripts/Measure-Phase4G3Processes.ps1'), '-TestRoot', root, '-NativeRoot', nativeRoot, '-ManagerRoot', join(root, 'manager-build', 'win-unpacked')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
const pendingProbe = []; let probeError = ''; probe.stderr.on('data', bytes => { probeError += bytes })
createInterface({ input: probe.stdout }).on('line', line => { const reply = pendingProbe.shift(); if (reply) { try { reply.resolve(JSON.parse(line)) } catch (error) { reply.reject(error) } } })
async function os(type = 'scan', target) {
  const response = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Probe timeout: ${probeError}`)), 15000)
    pendingProbe.push({ resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } }); probe.stdin.write(JSON.stringify({ type, pid: target?.pid, created: target?.created }) + '\n')
  })
  assert.equal(response.ok, true, response.error); return response.processes
}
async function until(read, accepts, label) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) { const value = await read(); if (accepts(value)) return value; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw new Error(`Timeout: ${label}`)
}
const native = spawn(nativeExe, ['--phase4e-resource-test', profile, join(profile, 'catalog.json'), pipeName, data.settings.quickSearchShortcut], { env, windowsHide: true, stdio: 'ignore' })
native.on('exit', (code, signal) => { report.nativeExit = { code, signal } })
let socket; let cdp; let nativeIdentity; let mainIdentity
async function record(stage) { const processes = await os(); report.checkpoints.push({ stage, utc: new Date().toISOString(), processes }); return processes }
const group = records => records.filter(record => record.path !== nativeExe)
try {
  socket = await until(async () => { const s = createConnection(`\\\\.\\pipe\\${pipeName}`); try { await once(s, 'connect'); return s } catch { s.destroy(); return null } }, Boolean, 'isolated Native control pipe')
  const replies = []; let greeting
  createInterface({ input: socket }).on('line', line => { const value = JSON.parse(line); if (value.type === 'ready') greeting = value; else replies.shift()?.(value) })
  await until(async () => { assert.equal(native.exitCode, null, 'Native exited before readiness'); return greeting }, Boolean, 'Native ready greeting')
  assert.equal(greeting.processId, native.pid)
  async function control(command) {
    const response = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Control timeout')), 15000); replies.push(value => { clearTimeout(timer); resolve(value) }); socket.write(JSON.stringify(command) + '\n') })
    assert.equal(response.ok, true, JSON.stringify(response)); assert.equal(response.processId, native.pid); return response
  }
  const initial = await record('native-only'); nativeIdentity = initial.find(p => p.pid === native.pid && p.path === nativeExe); assert.ok(nativeIdentity); assert.equal(group(initial).length, 0)
  await control({ type: 'manager-open', section: 'favorites' })
  const running = await until(os, records => group(records).some(p => p.role === 'main'), 'Manager process'); mainIdentity = group(running).find(p => p.role === 'main'); assert.equal(mainIdentity.parentPid, native.pid)
  const pages = await until(async () => { try { return await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() } catch { return [] } }, pages => pages.filter(p => p.type === 'page').length === 1, 'single renderer')
  const page = pages.find(p => p.type === 'page'); assert.ok(page.url.startsWith('file:') && page.url.endsWith('/out/renderer/index.html'))
  const ws = new WebSocket(page.webSocketDebuggerUrl); await once(ws, 'open'); cdp = ws
  const rpc = new Map(); let seq = 0
  ws.addEventListener('message', event => { const m = JSON.parse(event.data); const p = rpc.get(m.id); if (p) { rpc.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result) } })
  const evaluate = expression => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => { rpc.delete(id); reject(new Error('CDP timeout')) }, 10000); rpc.set(id, { timer, resolve: r => r.exceptionDetails ? reject(new Error(JSON.stringify(r.exceptionDetails))) : resolve(r.result.value), reject }); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })) })
  await until(() => evaluate('!!window.desktop?.plugins && !!document.querySelector(".favorites-page")'), Boolean, 'Vue/preload')
  const plugins = await evaluate('window.desktop.plugins.list()'); assert.equal(plugins.ok, true); assert.equal(plugins.data.length, 1); assert.equal(plugins.data[0].status, 'active')
  const view = await evaluate(`window.desktop.plugins.getPages(${JSON.stringify(demo.id)})`); assert.equal(view.ok, true); assert.ok(view.data.entry.iconDataUrl.startsWith('data:image/png;base64,')); assert.equal(view.data.pages[0].title, 'Home')
  const denied = await evaluate('window.desktop.plugins.setEnabled("../escape", true)'); assert.equal(denied.ok, false)
  await control({ type: 'manager-open', section: 'settings' })
  await until(() => evaluate('!!document.querySelector(".settings-page")'), Boolean, 'Settings render')
  const exactText = "don't stop"
  await control({ type: 'manager-translation', text: exactText })
  await until(() => evaluate(`document.querySelector('.translation-pane textarea')?.value === ${JSON.stringify(exactText)}`), Boolean, 'Translation exact prefill')
  const afterNavigation = await os(); assert.equal(group(afterNavigation).filter(p => p.role === 'main').length, 1)
  assert.ok(afterNavigation.some(p => p.pid === mainIdentity.pid && p.created === mainIdentity.created))
  report.existingPageSmoke = 'Favorites → Settings → Translation exact prefill; same Manager main process; isolated unconfigured AI'
  await record('manager-ready-plugin-core-active'); ws.close(); cdp = null
  await os('close', mainIdentity); await until(os, records => group(records).length === 0 && records.some(p => p.pid === native.pid), 'normal Manager close')
  await record('manager-closed-native-remains')
  await os('close-native', nativeIdentity); await until(os, records => records.length === 0, 'isolated Native exit'); await record('all-isolated-processes-exited')
  report.result = 'PACKAGED PLUGIN CORE / NORMAL MANAGER CLOSE PASS'
} catch (error) { report.error = String(error); throw error }
finally {
  cdp?.close(); socket?.destroy()
  try {
    const records = await os()
    if (mainIdentity && records.some(p => p.pid === mainIdentity.pid && p.created === mainIdentity.created)) await os('close', mainIdentity)
    if (nativeIdentity && records.some(p => p.pid === nativeIdentity.pid && p.created === nativeIdentity.created)) await os('close-native', nativeIdentity)
  } finally { probe.stdin.end(); await writeFile(join(root, 'plugin-smoke-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ result: report.result, evidence: join(root, 'plugin-smoke-report.json') })) }
}
