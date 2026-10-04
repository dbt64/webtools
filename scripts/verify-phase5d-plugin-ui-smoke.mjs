import assert from 'node:assert/strict'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { createConnection, createServer } from 'node:net'
import { createInterface } from 'node:readline'
import { mkdir, readFile, readdir, writeFile, cp } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertSafeManagerEvidenceRoot } from './lib/manager-lifecycle-evidence.mjs'
import { createDefaultAppData } from '../src/shared/domain.ts'
import { PluginManager } from '../electron/plugins/plugin-manager.ts'
import { packageBytes, manifest } from '../electron/plugins/fixtures.mjs'

// Short packaged Phase 5D UI/lifecycle smoke. It uses a fresh TEMP profile,
// isolated NativeHost pipe, a packaged Manager, and a pre-seeded test plugin.
// The fixture seed is test-only; production dialogs, installer, real profile,
// paid AI, startup registry and D:\webtools are never touched.
const phase5f = process.argv[5] === '--phase5f'
const phase5g = process.argv[5] === '--phase5g'
const reportFile = phase5g ? 'phase5g-translation-plugin-smoke-report.json' : phase5f ? 'phase5f-plugin-catalog-smoke-report.json' : 'phase5d-plugin-ui-smoke-report.json'
const repo = resolve(fileURLToPath(new URL('..', import.meta.url)))
const root = assertSafeManagerEvidenceRoot(resolve(process.argv[2] ?? ''))
const nativeSource = resolve(process.argv[3] ?? '')
const managerBinaryRoot = assertSafeManagerEvidenceRoot(resolve(process.argv[4] ?? ''))
assert.ok(nativeSource.startsWith(join(repo, 'release') + '\\'), 'Reuse only an existing repository Release Native artifact')
assert.ok(managerBinaryRoot.endsWith('manager-build\\win-unpacked'), 'Manager must come from the isolated electron-builder output')
const nativeRoot = join(root, 'Native')
const profile = join(root, 'profile')
const nativeExe = join(nativeRoot, 'WebTools.NativeHost.exe')
const managerExe = join(managerBinaryRoot, 'WebTools.exe')
await mkdir(profile, { recursive: true })
await cp(nativeSource, nativeRoot, { recursive: true, errorOnExist: true, force: false })

const data = createDefaultAppData()
data.settings.quickSearchShortcut = 'Control+Alt+Shift+F12'
data.settings.translation.engine = 'ai'
await writeFile(join(profile, 'nook-data.json'), JSON.stringify(data))
await writeFile(join(profile, 'launcher-state.json'), JSON.stringify({ schemaVersion: 1, quickSearchShortcut: data.settings.quickSearchShortcut, theme: 'dark', launcherDisplayMode: 'compact', launchOnStartup: false, searchEngines: data.settings.searchEngines, defaultSearchEngineId: 'google', everythingEnabled: false, everythingEsPath: '', websites: [], appSearchMemory: [] }))
await writeFile(join(profile, 'catalog.json'), JSON.stringify({ schemaVersion: 1, generatedAtUtc: new Date().toISOString(), apps: [] }))

const seed = new PluginManager({ userData: profile, hostVersion: '0.1.0', confirm: async () => true, externalOpen: async () => { throw new Error('not used') }, clipboardWrite: () => { throw new Error('not used') }, ai: { getDefaultProviderInfo: async () => { throw new Error('not used') }, complete: async () => { throw new Error('not used') } } })
await seed.initialize()
const pluginId = 'org.example.phase5dsmoke'
const demo = manifest({
  id: pluginId,
  name: 'Phase 5D Smoke Plugin',
  description: 'Isolated packaged UI smoke fixture.',
  requestedCapabilities: ['manager.page', 'plugin.config.read', 'plugin.config.write', 'sharedAI.complete'],
  settings: [{ key: 'message', label: 'Smoke message', type: 'text', minLength: 0, maxLength: 100, default: 'initial value' }],
  pages: [{ id: 'home', title: 'Smoke Page', blocks: [{ type: 'heading', text: 'Packaged declarative page' }, { type: 'text-input', settingKey: 'message' }, { type: 'button', label: 'Review AI request', actionId: 'review-ai' }] }],
  actions: [{ id: 'save-message', type: 'plugin.config.write', key: 'message' }, { id: 'review-ai', type: 'sharedAI.complete' }],
})
await seed.install(packageBytes(demo), seed.session)
await seed.setEnabled(pluginId, true, seed.session)
seed.close()

const report = {
  root,
  sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', windowsHide: true }).trim(),
  dirtySource: true,
  artifacts: {},
  fixtureConsent: 'TEST-ONLY mocked consent used only to seed an enabled plugin before launch',
  productionDialogs: 'NOT TESTED',
  checkpoints: [],
  result: 'INCOMPLETE',
}
async function hash(path) { return createHash('sha256').update(await readFile(path)).digest('hex') }
async function snapshotFiles(paths) {
  const entries = await Promise.all(paths.map(async path => {
    try { return [path, await hash(join(profile, path))] }
    catch (error) { if (error?.code === 'ENOENT') return [path, null]; throw error }
  }))
  return Object.fromEntries(entries)
}
async function snapshotTree(directory) {
  const files = {}
  async function visit(current) {
    let entries
    try { entries = await readdir(current, { withFileTypes: true }) }
    catch (error) { if (error?.code === 'ENOENT') return; throw error }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Isolated data snapshot refuses a reparse entry: ${path}`)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) files[path.slice(directory.length + 1)] = await hash(path)
    }
  }
  await visit(directory)
  return files
}
report.artifacts = {
  nativeExe: await hash(nativeExe),
  nativeDll: await hash(join(nativeRoot, 'WebTools.NativeHost.dll')),
  managerExe: await hash(managerExe),
  asar: await hash(join(managerBinaryRoot, 'resources', 'app.asar')),
}

const reservation = createServer()
reservation.listen(0, '127.0.0.1')
await once(reservation, 'listening')
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const pipeName = `WebTools.NativeHost.Resource.P5D${randomUUID().replaceAll('-', '')}`
const env = { ...process.env, WEBTOOLS_MANAGER_EXE: managerExe, WEBTOOLS_MANAGER_TEST_DEBUG_PORT: String(port) }
delete env.ELECTRON_RUN_AS_NODE
let probe = null
function startProbe() {
  const child = spawn('powershell.exe', probeArgs(), { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const pending = []
  let errorText = ''
  let resolveClosed
  const closed = new Promise(resolve => { resolveClosed = resolve })
  const client = { child, closed, error: () => errorText, request: null, isClosed: false }
  const rejectPending = error => { for (const waiter of pending.splice(0)) waiter.reject(error) }
  createInterface({ input: child.stdout }).on('line', line => {
    const waiter = pending.shift()
    if (!waiter) return
    try { waiter.resolve(JSON.parse(line)) } catch (error) { waiter.reject(error) }
  })
  child.stderr.on('data', bytes => { errorText += bytes })
  child.on('error', error => { errorText = String(error); rejectPending(error) })
  child.on('exit', (code, signal) => rejectPending(new Error(`Process identity probe exited (${code ?? signal}): ${errorText}`)))
  child.on('close', () => { client.isClosed = true; resolveClosed(true); rejectPending(new Error(`Process identity probe closed: ${errorText}`)) })
  client.request = request => new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null || child.stdin.destroyed) return reject(new Error(`Process identity probe is unavailable: ${errorText}`))
    let waiter
    const timer = setTimeout(() => {
      const index = pending.indexOf(waiter)
      if (index >= 0) pending.splice(index, 1)
      reject(new Error(`Probe timeout: ${errorText}`))
    }, 15_000)
    waiter = { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } }
    pending.push(waiter)
    try { child.stdin.write(JSON.stringify(request) + '\n') }
    catch (error) { pending.splice(pending.indexOf(waiter), 1); clearTimeout(timer); reject(error) }
  })
  return client
}
async function os(type = 'scan', target) {
  if (!probe) throw new Error('Process identity probe is unavailable.')
  const response = await probe.request({ type, pid: target?.pid, created: target?.created })
  assert.equal(response.ok, true, response.error)
  return response.processes
}
async function until(read, accepts, label) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const value = await read()
    if (accepts(value)) return value
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timeout: ${label}`)
}
const sameProcess = (process, identity, expectedPath) => process?.pid === identity?.pid && process?.created === identity?.created && process?.path?.toLowerCase() === expectedPath.toLowerCase()
async function closeOwnedProcess(type, identity, expectedPath, label) {
  if (!identity) return
  let lastError
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const processes = await os()
    if (!processes.some(process => sameProcess(process, identity, expectedPath))) return
    try { await os(type, identity) } catch (error) { lastError = error }
    const after = await os()
    if (!after.some(process => sameProcess(process, identity, expectedPath))) return
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  throw new Error(`${label} did not exit after identity-checked graceful close${lastError ? `: ${lastError}` : ''}`)
}
async function stopProbe(client) {
  if (!client) return true
  const child = client.child
  if (client.isClosed) return true
  if (!child.stdin.destroyed && child.exitCode === null && child.signalCode === null) child.stdin.end()
  const exited = await Promise.race([client.closed, new Promise(resolve => setTimeout(() => resolve(false), 5_000))])
  if (exited) return true
  report.probeCleanup = 'Directly spawned PowerShell identity probe did not close its streams after stdin close; terminating only this owned probe child.'
  child.kill()
  const closed = await Promise.race([client.closed, new Promise(resolve => setTimeout(() => resolve(false), 5_000))])
  if (!closed) report.probeCleanup += ' Probe did not report stream closure after termination.'
  return closed
}
let socket
let cdp
let native = null
let nativeIdentity
let mainIdentity
let probeCleanupFailed = false
function record(stage, processes) { report.checkpoints.push({ stage, utc: new Date().toISOString(), processes }) }
const group = records => records.filter(record => record.path !== nativeExe)
function probeArgs() {
  return ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(repo, 'native/scripts/Measure-Phase4G3Processes.ps1'), '-TestRoot', root, '-NativeRoot', nativeRoot, '-ManagerRoot', managerBinaryRoot]
}
function parseProbeReply(stdout) {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index--) {
    try {
      const reply = JSON.parse(lines[index])
      if (typeof reply.ok === 'boolean') return reply
    } catch {}
  }
  throw new Error('Process identity probe returned no JSON response.')
}
function runOneShotProbe(request) {
  const result = spawnSync('powershell.exe', probeArgs(), {
    input: `${JSON.stringify(request)}\n`, encoding: 'utf8', windowsHide: true, timeout: 20_000, maxBuffer: 8 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`One-shot process identity probe exited ${result.status}: ${result.stderr || result.stdout}`)
  const reply = parseProbeReply(result.stdout)
  if (!reply.ok) throw new Error(reply.error || 'One-shot process identity probe refused the request.')
  return reply.processes
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
async function closeOwnedProcessOneShot(type, identity, expectedPath, label) {
  if (!identity) return
  let lastError
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const processes = runOneShotProbe({ type: 'scan' })
    if (!processes.some(process => sameProcess(process, identity, expectedPath))) return
    try { runOneShotProbe({ type, pid: identity.pid, created: identity.created }) } catch (error) { lastError = error }
    await sleep(150)
  }
  throw new Error(`${label} did not exit after one-shot identity-checked graceful close${lastError ? `: ${lastError}` : ''}`)
}
async function cleanupWithOneShotProbe() {
  let processes = runOneShotProbe({ type: 'scan' })
  if (!nativeIdentity && native?.pid) nativeIdentity = processes.find(process => process.pid === native.pid && process.path?.toLowerCase() === nativeExe.toLowerCase())
  if (!mainIdentity && native?.pid) mainIdentity = processes.find(process => process.role === 'main' && process.parentPid === native.pid && process.path?.toLowerCase() === managerExe.toLowerCase())
  if (mainIdentity) await closeOwnedProcessOneShot('close', mainIdentity, managerExe, 'Isolated Manager')
  if (nativeIdentity) await closeOwnedProcessOneShot('close-native', nativeIdentity, nativeExe, 'Isolated NativeHost')
  processes = runOneShotProbe({ type: 'scan' })
  if (processes.some(process => process.pid === native?.pid && process.path?.toLowerCase() === nativeExe.toLowerCase())) throw new Error('Isolated NativeHost remains after one-shot cleanup.')
  if (group(processes).length > 0) throw new Error(`Isolated Manager processes remain after one-shot cleanup: ${JSON.stringify(group(processes))}`)
}
try {
  probe = startProbe()
  native = spawn(nativeExe, ['--phase4e-resource-test', profile, join(profile, 'catalog.json'), pipeName, data.settings.quickSearchShortcut], { env, windowsHide: true, stdio: 'ignore' })
  native.on('error', error => { report.nativeSpawnError = String(error) })
  native.on('exit', (code, signal) => { report.nativeExit = { code, signal } })
  nativeIdentity = await until(async () => (await os()).find(process => process.pid === native.pid && process.path.toLowerCase() === nativeExe.toLowerCase()), Boolean, 'isolated NativeHost process identity')
  socket = await until(async () => { const candidate = createConnection(`\\\\.\\pipe\\${pipeName}`); try { await once(candidate, 'connect'); return candidate } catch { candidate.destroy(); return null } }, Boolean, 'isolated Native control pipe')
  const replies = []
  let greeting
  createInterface({ input: socket }).on('line', line => { const value = JSON.parse(line); if (value.type === 'ready') greeting = value; else replies.shift()?.(value) })
  await until(async () => { assert.equal(native.exitCode, null, 'Native exited before readiness'); return greeting }, Boolean, 'Native ready greeting')
  assert.equal(greeting.processId, native.pid)
  async function control(command) {
    const response = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Control timeout')), 15_000); replies.push(value => { clearTimeout(timer); resolve(value) }); socket.write(JSON.stringify(command) + '\n') })
    assert.equal(response.ok, true, JSON.stringify(response))
    assert.equal(response.processId, native.pid)
    return response
  }
  const initial = await os()
  assert.ok(initial.some(process => process.pid === nativeIdentity.pid && process.created === nativeIdentity.created && process.path.toLowerCase() === nativeExe.toLowerCase()))
  assert.equal(group(initial).length, 0, 'Native-only must have no Manager/Electron process')
  record('native-only-electron-zero', initial)

  await control({ type: 'manager-open', section: 'favorites' })
  const running = await until(os, processes => group(processes).some(process => process.role === 'main'), 'packaged Manager process')
  mainIdentity = group(running).find(process => process.role === 'main')
  assert.equal(mainIdentity.parentPid, native.pid)
  const pages = await until(async () => { try { return await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() } catch { return [] } }, pages => pages.filter(page => page.type === 'page').length === 1, 'single packaged renderer')
  const page = pages.find(candidate => candidate.type === 'page')
  assert.ok(page.url.startsWith('file:') && page.url.endsWith('/out/renderer/index.html'))
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await once(ws, 'open')
  cdp = ws
  const rpc = new Map()
  let sequence = 0
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    const pending = rpc.get(message.id)
    if (pending) { rpc.delete(message.id); clearTimeout(pending.timer); message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result) }
  })
  const evaluate = expression => new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { rpc.delete(id); reject(new Error('CDP timeout')) }, 10_000)
    rpc.set(id, { timer, resolve: result => result.exceptionDetails ? reject(new Error(JSON.stringify(result.exceptionDetails))) : resolve(result.result.value), reject })
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
  })
  await until(() => evaluate('!!window.desktop?.plugins && !!document.querySelector(".favorites-page")'), Boolean, 'packaged Vue and preload')
  assert.equal(await evaluate('document.querySelector(".breadcrumb strong")?.textContent'), '网址')
  await evaluate('document.querySelector(".nav-apps-trigger")?.click()')
  await evaluate('[...document.querySelectorAll(".nav-subitem:not(.plugin-nav-item)")].find(button => button.textContent.trim() === "插件管理")?.click()')
  await until(() => evaluate('!!document.querySelector(".plugin-manager-page")'), Boolean, 'plugin center route')
  await until(() => evaluate(`[...document.querySelectorAll('.plugin-list-row')].some(row => row.textContent.includes(${JSON.stringify(demo.name)}))`), Boolean, 'seeded plugin list')
  if (phase5f) {
    const catalog = await evaluate('window.desktop.pluginCatalog.list()')
    assert.equal(catalog.ok, true)
    assert.equal(catalog.data.entries.filter(entry => entry.kind === 'builtin').length, 1)
    assert.equal(catalog.data.declarativeAvailability.status, 'available')
    await until(() => evaluate('!!document.querySelector(".plugin-builtin-detail")'), Boolean, 'builtin detail selected by default')
    assert.equal(await evaluate('document.querySelector(".plugin-builtin-detail h2")?.textContent'), '翻译')
    assert.equal(await evaluate('[...document.querySelectorAll(".plugin-builtin-detail button")].some(button => /停用|卸载|替换/.test(button.textContent))'), false)
    await evaluate('document.querySelector(".plugin-builtin-detail .primary-button")?.click()')
    await until(() => evaluate('!!document.querySelector(".translate-page")'), Boolean, 'builtin opens original Translation page')
    await evaluate(`(()=>{const input=document.querySelector('.translate-page textarea');window.__phase5fOriginalInput=input;input.value='retain current Translation input';input.dispatchEvent(new Event('input',{bubbles:true}));[...document.querySelectorAll('.plugin-nav-item')].find(button=>button.textContent.trim()==='翻译')?.click()})()`)
    assert.equal(await evaluate("document.querySelector('.translate-page textarea') === window.__phase5fOriginalInput && window.__phase5fOriginalInput.value === 'retain current Translation input'"), true, 'repeat Translation nav keeps original mounted input')
    await evaluate('[...document.querySelectorAll(".nav-subitem")].find(button => button.textContent.trim() === "插件管理")?.click()')
    await until(() => evaluate('!!document.querySelector(".plugin-manager-page")'), Boolean, 'return to mixed center')
  }
  if (phase5g) {
    const catalog = await evaluate('window.desktop.pluginCatalog.list()')
    assert.equal(catalog.ok, true)
    assert.equal(catalog.data.entries.filter(entry => entry.kind === 'builtin').length, 1)
    assert.equal(catalog.data.entries.filter(entry => entry.kind === 'declarative' && entry.id === pluginId).length, 1)
    assert.equal(catalog.data.declarativeAvailability.status, 'available')
    assert.equal(catalog.data.entries.find(entry => entry.kind === 'builtin').state.enabled, true, 'first-run built-in Translation defaults to enabled')
    const preservedFiles = ['nook-data.json', 'secrets.json', 'launcher-state.json', 'launcher-state.json.bak', 'catalog.json', 'catalog.json.bak', 'plugins/registry.json', `plugins/config/${pluginId}.json`]
    const persistentStateBeforeToggle = {
      files: await snapshotFiles(preservedFiles),
      declarativeData: await snapshotTree(join(profile, 'plugins', 'data', pluginId)),
    }

    await evaluate(`[...document.querySelectorAll('.plugin-list-row')].find(row => row.textContent.includes('翻译'))?.click()`)
    await until(() => evaluate('!!document.querySelector(".plugin-builtin-detail")'), Boolean, 'built-in Translation detail')
    await evaluate('[...document.querySelectorAll(".plugin-builtin-detail .plugin-actions button")].find(button => button.textContent.includes("停用翻译"))?.click()')
    await until(async () => {
      const result = await evaluate('window.desktop.pluginCatalog.list()')
      return result.data?.entries.find(entry => entry.kind === 'builtin')?.state.status === 'disabled'
    }, Boolean, 'built-in Translation disable persisted')
    const storedDisabled = JSON.parse(await readFile(join(profile, 'builtin-plugins', 'state.json'), 'utf8'))
    assert.equal(storedDisabled.plugins['webtools.translation']?.enabled, false)
    const declarativeWhileDisabled = (await evaluate('window.desktop.plugins.list()')).data?.find(plugin => plugin.id === pluginId)
    assert.equal(declarativeWhileDisabled?.status, 'active', 'declared plugin stays active when built-in Translation is disabled')
    assert.equal(await evaluate('[...document.querySelectorAll(".plugin-nav-item")].some(button => button.textContent.trim() === "翻译")'), false, 'disabled built-in page is removed from navigation')
    await evaluate('document.querySelector(".sidebar-bottom .nav-item")?.click()')
    await until(() => evaluate('!!document.querySelector(".settings-page")'), Boolean, 'Settings remains accessible while Translation is disabled')
    const providerSettings = await evaluate(`(async()=>{
      const settings=await window.desktop.getSettings()
      const providers=await window.desktop.getAIProviderDescriptors()
      const status=providers.ok ? await window.desktop.getAIProviderStatus(providers.data[0].id) : providers
      return {engine:settings.translation.engine,providers,status}
    })()`)
    assert.ok(['mymemory', 'ai', 'qwen-mt'].includes(providerSettings.engine))
    assert.equal(providerSettings.providers.ok, true, 'AI provider settings remain readable while Translation is disabled')
    assert.equal(providerSettings.status.ok, true)
    await evaluate('[...document.querySelectorAll(".nav-subitem")].find(button => button.textContent.trim() === "插件管理")?.click()')
    await until(() => evaluate('!!document.querySelector(".plugin-manager-page")'), Boolean, 'return to Plugin Center after disabled-state Settings check')

    const disabledIpc = await evaluate(`(async()=>({
      providerInfo: await window.desktop.getTranslationProviderInfo(),
      translation: await window.desktop.translate({requestId:'00000000-0000-4000-8000-000000000001',text:'phase5g disabled check',sourceLanguage:'auto',targetLanguage:'zh-CN'}),
      google: await window.desktop.openGoogleTranslate({text:'phase5g disabled check',targetLanguage:'zh-CN'})
    }))()`)
    assert.equal(disabledIpc.providerInfo.ok, true, 'provider information remains available while Translation is disabled')
    assert.equal(disabledIpc.translation.ok, false)
    assert.equal(disabledIpc.translation.error.code, 'TRANSLATION_DISABLED')
    assert.equal(disabledIpc.google.ok, false)
    assert.equal(disabledIpc.google.error.code, 'TRANSLATION_DISABLED', 'disabled Google handoff is blocked before external open')

    const pluginSummary = declarativeWhileDisabled
    const aiReview = await evaluate(`window.desktop.plugins.prepareAIReview({pluginId:${JSON.stringify(pluginId)},version:${JSON.stringify(pluginSummary.version)},hash:${JSON.stringify(pluginSummary.hash)},actionId:'review-ai',input:{messages:[{role:'user',content:'phase5g isolated AI review'}]}})`)
    assert.equal(aiReview.ok, true, 'declarative Shared AI review preparation stays independent from built-in Translation')
    assert.equal((await evaluate(`window.desktop.plugins.cancelAIReview(${JSON.stringify(aiReview.data.reviewId)})`)).ok, true)
    record('builtin-translation-disabled-with-declarative-ai-available', await os())

    const prefillText = "  café don't stop state-of-the-art  "
    await control({ type: 'manager-translation', text: prefillText })
    await until(() => evaluate('!!document.querySelector(".builtin-translation-gate")'), Boolean, 'Native Translation gate presented while disabled')
    assert.equal(await evaluate(`document.body.innerText.includes(${JSON.stringify(prefillText)})`), false, 'blocked renderer projection never exposes exact prefill text')
    assert.equal(await evaluate('!!document.querySelector(".translate-page")'), false, 'disabled handoff does not mount Translation')
    const presentedState = await control({ type: 'manager-state' })
    assert.equal(presentedState.manager.pendingRequestId ?? null, null, 'Native transport is acknowledged after gate presentation')
    const disabledProjection = await evaluate('window.desktop.builtinTranslationHandoff.get()')
    assert.equal(disabledProjection.ok, true)
    assert.equal(disabledProjection.data.status, 'blocked')
    assert.equal(disabledProjection.data.hasPrefill, true)
    assert.equal(Object.hasOwn(disabledProjection.data, 'text'), false)
    await evaluate('[...document.querySelectorAll(".translation-gate-actions button")].find(button => button.textContent.trim() === "取消")?.click()')
    await until(async () => (await evaluate('window.desktop.builtinTranslationHandoff.get()')).data?.status === 'none', Boolean, 'cancel clears disabled Native handoff')
    const canceledState = JSON.parse(await readFile(join(profile, 'builtin-plugins', 'state.json'), 'utf8'))
    assert.equal(canceledState.plugins['webtools.translation']?.enabled, false, 'cancel leaves disabled state unchanged')

    await control({ type: 'manager-translation', text: prefillText })
    await until(() => evaluate('!!document.querySelector(".builtin-translation-gate")'), Boolean, 'second Native Translation gate presented')
    await evaluate('[...document.querySelectorAll(".translation-gate-actions button")].find(button => button.textContent.includes("启用并打开翻译"))?.click()')
    await until(() => evaluate('!!document.querySelector(".translate-page textarea")'), Boolean, 'explicit enable opens Translation')
    await until(() => evaluate('document.querySelector(".translate-page textarea")?.value'), value => value === prefillText, 'exact Unicode, whitespace and punctuation prefill applied')
    await until(async () => (await evaluate('window.desktop.builtinTranslationHandoff.get()')).data?.status === 'none', Boolean, 'handoff acknowledged only after exact input application')
    const providerAfterEnable = await evaluate('window.desktop.getTranslationProviderInfo()')
    assert.equal(providerAfterEnable.ok, true)
    assert.equal(providerAfterEnable.data.configured, false, 'isolated AI provider has no credential')
    await sleep(700)
    assert.equal(await evaluate('document.querySelector(".translation-output")?.textContent.trim()'), '译文会显示在这里', 'no automatic provider request starts without configured credentials')
    const storedEnabled = JSON.parse(await readFile(join(profile, 'builtin-plugins', 'state.json'), 'utf8'))
    assert.equal(storedEnabled.plugins['webtools.translation']?.enabled, true, 'explicit enable is persisted')
    assert.equal(JSON.stringify(storedEnabled).includes(prefillText), false, 'exact text is not written to built-in state')
    const persistentStateAfterToggle = {
      files: await snapshotFiles(preservedFiles),
      declarativeData: await snapshotTree(join(profile, 'plugins', 'data', pluginId)),
    }
    assert.deepEqual(persistentStateAfterToggle, persistentStateBeforeToggle, 'built-in enable changes leave DataStore, SecretStore, Native files and declarative plugin data untouched')
    report.translationPlugin = {
      firstRunDefault: 'enabled',
      disablePersisted: true,
      disabledTranslationIpc: disabledIpc.translation.error.code,
      disabledGoogleIpc: disabledIpc.google.error.code,
      providerInfoAvailableWhileDisabled: true,
      settingsAndAIProviderDescriptorsAvailableWhileDisabled: true,
      declarativeSharedAIReviewAvailableWhileDisabled: true,
      nativeDisabledGate: 'presented without exposing exact input; Native request acknowledged after gate mount',
      cancelLeavesDisabled: true,
      explicitEnable: 'exact Latin-Unicode/whitespace/apostrophe/hyphen prefill applied and state persisted',
      providerCalls: 'none; isolated AI provider has no credential and output remains empty after 700 ms',
      textPersistence: 'not present in built-in state file',
      unrelatedPersistentState: 'DataStore, SecretStore, Native launcher/catalog files, declarative registry/config and declarative data hashes unchanged by Translation disable/enable and handoff',
    }
    record('builtin-translation-gate-enable-prefill-persistence', await os())
    await evaluate('[...document.querySelectorAll(".nav-subitem")].find(button => button.textContent.trim() === "插件管理")?.click()')
    await until(() => evaluate('!!document.querySelector(".plugin-manager-page")'), Boolean, 'return to Plugin Center after Translation handoff')
  }
  await evaluate(`[...document.querySelectorAll('.plugin-list-row')].find(row => row.textContent.includes(${JSON.stringify(demo.name)}))?.click()`)
  assert.equal(await evaluate('document.querySelector(".plugin-trust-note strong")?.textContent'), '本地插件，发布者未经验证')
  await evaluate('[...document.querySelectorAll(".plugin-actions button")].find(button => button.textContent.includes("打开插件页面"))?.click()')
  await until(() => evaluate('!!document.querySelector(".declarative-plugin-page")'), Boolean, 'declarative plugin page route')
  assert.equal(await evaluate('document.querySelector("#plugin-setting-message-home-1")?.value'), 'initial value')
  await evaluate(`(()=>{const input=document.querySelector('#plugin-setting-message-home-1');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'phase5d saved value');input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.plugin-save-setting')?.click()})()`)
  await until(() => evaluate('document.querySelector(".plugin-action-result")?.textContent.includes("设置已保存")'), Boolean, 'setting saved feedback')
  const savedPage = await evaluate(`window.desktop.plugins.getPages(${JSON.stringify(pluginId)})`)
  assert.equal(savedPage.ok, true)
  assert.equal(savedPage.data.config.message, 'phase5d saved value')
  const reviewText = 'phase5d packaged review exact text'
  await evaluate('[...document.querySelectorAll(".plugin-action-block button")].find(button => button.textContent.includes("Review AI request"))?.click()')
  await until(() => evaluate('!!document.querySelector(".plugin-action-input textarea")'), Boolean, 'AI action text input')
  await evaluate(`(()=>{const input=document.querySelector('.plugin-action-input textarea');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(input,${JSON.stringify(reviewText)});input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.plugin-action-input .primary-button')?.click()})()`)
  await until(() => evaluate('Boolean(document.querySelector(".plugin-review-dialog[open]"))'), Boolean, 'complete AI review dialog')
  assert.equal(await evaluate('document.querySelector(".plugin-review-message pre")?.textContent'), reviewText)
  assert.ok((await evaluate('document.querySelector(".plugin-review-facts")?.textContent')).includes('提供方 / 模型'))
  await evaluate('document.querySelector(".plugin-review-actions .secondary-button")?.click()')
  await until(() => evaluate('!document.querySelector(".plugin-review-dialog")?.open'), Boolean, 'AI review cancellation')
  await evaluate('[...document.querySelectorAll(".declarative-plugin-page button")].find(button => button.textContent.includes("返回插件管理"))?.click()')
  await until(() => evaluate('!!document.querySelector(".plugin-manager-page")'), Boolean, 'return to plugin center')
  await evaluate(`[...document.querySelectorAll('.plugin-list-row')].find(row => row.textContent.includes(${JSON.stringify(demo.name)}))?.click()`)
  await until(() => evaluate('!!document.querySelector(".plugin-permissions")'), Boolean, 'select declarative details after center remount')
  await evaluate('[...document.querySelectorAll(".plugin-actions button")].find(button => button.textContent.includes("停用插件"))?.click()')
  await until(async () => { const result = await evaluate('window.desktop.plugins.list()'); return result.data?.find(plugin => plugin.id === pluginId)?.status === 'installed-disabled' }, Boolean, 'plugin disabled through UI')
  await until(() => evaluate('[...document.querySelectorAll(".plugin-nav-item")].every(button => !button.textContent.includes("Phase 5D Smoke Plugin"))'), Boolean, 'disabled plugin removed from Apps submenu')
  await evaluate('[...document.querySelectorAll(".plugin-actions button")].find(button => button.textContent.includes("启用插件"))?.click()')
  await until(async () => { const result = await evaluate('window.desktop.plugins.list()'); return result.data?.find(plugin => plugin.id === pluginId)?.status === 'active' }, Boolean, 'plugin re-enabled through UI')
  const revokeAttempt = await evaluate('(()=>{const row=[...document.querySelectorAll(".plugin-permission-row")].find(label=>label.textContent.includes("保存插件设置"));if(!row)return {found:false};const input=row.querySelector("input");const before=input.checked;input.click();return {found:true,before,after:input.checked,saveDisabled:document.querySelector(".plugin-permissions > button")?.disabled}})()')
  assert.equal(revokeAttempt.found, true, 'permission row is present in the packaged Manager')
  assert.equal(revokeAttempt.before, true, 'test fixture starts with config-write permission granted')
  assert.equal(revokeAttempt.after, false, 'clicking the checkbox requests permission revocation')
  report.permissionRevocationAttempt = revokeAttempt
  await until(() => evaluate('document.querySelector(".plugin-permissions > button")?.disabled === false'), Boolean, 'permission save becomes enabled')
  await evaluate('document.querySelector(".plugin-permissions > button")?.click()')
  const permissionFeedback = await until(() => evaluate('document.querySelector(".plugin-feedback")?.textContent || ""'), value => Boolean(value), 'permission save feedback')
  report.permissionRevocationFeedback = permissionFeedback
  const pluginAfterUiRevocation = (await evaluate('window.desktop.plugins.list()')).data?.find(plugin => plugin.id === pluginId)
  report.pluginAfterUiRevocation = pluginAfterUiRevocation
  assert.equal(permissionFeedback.includes('权限状态已更新'), true, `permission UI feedback: ${permissionFeedback}`)
  assert.equal(pluginAfterUiRevocation?.status, 'needs-permission', JSON.stringify(pluginAfterUiRevocation))
  await until(async () => { const result = await evaluate('window.desktop.plugins.list()'); return result.data?.find(plugin => plugin.id === pluginId)?.status === 'needs-permission' }, Boolean, 'revoked capability reflected by Main')
  await until(() => evaluate('[...document.querySelectorAll(".plugin-nav-item")].every(button => !button.textContent.includes("Phase 5D Smoke Plugin"))'), Boolean, 'revoked plugin removed from Apps submenu')
  const afterNavigation = await os()
  assert.equal(group(afterNavigation).filter(process => process.role === 'main').length, 1)
  assert.ok(afterNavigation.some(process => process.pid === mainIdentity.pid && process.created === mainIdentity.created), 'same Manager process reused for plugin UI navigation')
  record('packaged-plugin-center-declarative-config-enable-disable', afterNavigation)
  report.uiSmoke = 'Favorites default → Apps/Plugin Center → list/details/trust → declarative page/config write → complete AI preview/cancel → disable/re-enable → capability revoke removes page nav; same Manager main process'

  if (phase5f) {
    const prefillText = "  don't stop state-of-the-art  "
    await control({ type: 'manager-translation', text: prefillText })
    await until(() => evaluate('document.querySelector(".translate-page textarea")?.value'), value => value === prefillText, 'exact Native Translation handoff')
    const processes = await os()
    assert.ok(processes.some(process => sameProcess(process, mainIdentity, managerExe)), 'Native intent reuses Manager')
    report.nativeTranslationPrefill = 'Exact whitespace/apostrophe/hyphen text from real Native Translation action applied in original TranslateView; unconfigured AI test profile, no provider request'
    const beforeCloseCatalog = await evaluate('window.desktop.pluginCatalog.list()')
    assert.equal(beforeCloseCatalog.data.entries[0].state.enabled, true)
    record('unified-catalog-native-translation-prefill', processes)
  }
  ws.close()
  cdp = null
  await os('close', mainIdentity)
  const closed = await until(os, processes => group(processes).length === 0 && processes.some(process => process.pid === native.pid), 'ordinary Manager close returns Electron to zero')
  record('manager-closed-electron-zero-native-remains', closed)
  if (phase5f || phase5g) {
    const firstManager = mainIdentity
    await control({ type: 'manager-open', section: 'favorites' })
    const reopened = await until(os, processes => group(processes).some(process => process.role === 'main'), 'Manager reopens after ordinary close')
    mainIdentity = group(reopened).find(process => process.role === 'main')
    assert.equal(mainIdentity.parentPid, native.pid)
    assert.notEqual(mainIdentity.created, firstManager.created)
    await until(() => control({ type: 'manager-state' }), state => state.manager.rendererReady && state.manager.pendingRequestId === null, 'reopened Manager ready and page intent acknowledged')
    const newPages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    const newPage = newPages.find(page => page.type === 'page')
    assert.ok(newPage?.url.endsWith('/out/renderer/index.html'))
    const newWs = new WebSocket(newPage.webSocketDebuggerUrl)
    cdp = newWs
    await once(newWs, 'open')
    const restored = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Reopened CDP timeout')), 10_000)
      newWs.addEventListener('message', event => {
        const message = JSON.parse(event.data)
        if (message.id !== 1) return
        clearTimeout(timer)
        message.error || message.result?.exceptionDetails ? reject(new Error(JSON.stringify(message))) : resolve(message.result.result.value)
      })
      newWs.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: "window.desktop.pluginCatalog.list().then(result=>({catalog:result,home:!!document.querySelector('.favorites-page')}))", returnByValue: true, awaitPromise: true } }))
    })
    assert.equal(restored.home, true)
    assert.equal(restored.catalog.ok, true)
    assert.equal(restored.catalog.data.entries[0].kind, 'builtin')
    assert.equal(restored.catalog.data.entries.find(entry => entry.kind === 'declarative' && entry.id === pluginId)?.package.status, 'needs-permission')
    if (phase5g) {
      assert.equal(restored.catalog.data.entries.find(entry => entry.kind === 'builtin')?.state.enabled, true, 'built-in enabled state persists after Manager process restart')
      const persistedFile = JSON.parse(await readFile(join(profile, 'builtin-plugins', 'state.json'), 'utf8'))
      assert.equal(persistedFile.plugins['webtools.translation']?.enabled, true)
      report.restartPersistence = 'Favorites remains home; enabled built-in Translation and declarative grant/status restored after a new Manager process'
    } else {
      report.restartPersistence = 'Builtin and retained third-party grants/status restored after new Manager process; Favorites remains home'
    }
    record('reopened-manager-catalog-persistence', await os())
    newWs.close(); cdp = null
    await os('close', mainIdentity)
    record('reopened-manager-closed-electron-zero-native-remains', await until(os, processes => group(processes).length === 0 && processes.some(process => process.pid === native.pid), 'reopened Manager ordinary close'))
  }
  await os('close-native', nativeIdentity)
  const exited = await until(os, processes => processes.length === 0, 'isolated Native exit')
  record('all-isolated-processes-exited', exited)
  report.result = phase5g ? 'PACKAGED PHASE 5G BUILTIN TRANSLATION LIFECYCLE / HANDOFF / MANAGER LIFECYCLE PASS' : phase5f ? 'PACKAGED PHASE 5F UNIFIED CATALOG / NATIVE PREFILL / MANAGER LIFECYCLE PASS' : 'PACKAGED PHASE 5D PLUGIN UI / CONFIG / MANAGER LIFECYCLE PASS'
} catch (error) {
  report.error = String(error)
  throw error
} finally {
  cdp?.close()
  socket?.destroy()
  try {
    if (!await stopProbe(probe)) probeCleanupFailed = true
    probe = startProbe()
    let processes = await os()
    if (!nativeIdentity && native?.pid) nativeIdentity = processes.find(process => process.pid === native.pid && process.path?.toLowerCase() === nativeExe.toLowerCase())
    if (!mainIdentity && native?.pid) mainIdentity = processes.find(process => process.role === 'main' && process.parentPid === native.pid && process.path?.toLowerCase() === managerExe.toLowerCase())
    if (mainIdentity) await closeOwnedProcess('close', mainIdentity, managerExe, 'Isolated Manager')
    if (nativeIdentity) await closeOwnedProcess('close-native', nativeIdentity, nativeExe, 'Isolated NativeHost')
    processes = await os()
    if (processes.some(process => process.pid === native?.pid && process.path?.toLowerCase() === nativeExe.toLowerCase())) throw new Error('Isolated NativeHost remains after cleanup.')
    if (group(processes).length > 0) throw new Error(`Isolated Manager processes remain after cleanup: ${JSON.stringify(group(processes))}`)
  } catch (error) {
    report.cleanupError = String(error)
    try {
      await cleanupWithOneShotProbe()
      report.cleanupRecovery = 'Fresh probe cleanup failed; isolated processes were closed with separate one-shot identity checks.'
    } catch (fallbackError) {
      report.cleanupFallbackError = String(fallbackError)
      report.result = 'INCOMPLETE: ISOLATED PROCESS CLEANUP FAILED'
      process.exitCode = 1
    }
  } finally {
    if (!await stopProbe(probe)) probeCleanupFailed = true
    if (probeCleanupFailed) {
      report.result = 'INCOMPLETE: IDENTITY PROBE CLEANUP FAILED'
      process.exitCode = 1
    }
    await writeFile(join(root, reportFile), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ result: report.result, evidence: join(root, reportFile) }))
  }
}
