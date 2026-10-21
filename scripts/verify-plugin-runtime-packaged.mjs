import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer as createHttpServer } from 'node:http'
import { createConnection, createServer } from 'node:net'
import { createInterface } from 'node:readline'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDefaultAppData } from '../src/shared/domain.ts'
import { ThemeAcceptanceOwnership } from './lib/plugin-theme-acceptance-ownership.mjs'

// Production-shaped Runtime 2.0 acceptance: real Release NativeHost -> real
// electron-builder win-unpacked Manager -> real external SDK-built .wtplugin.
// The only profile and executables touched by this runner are strictly under TEMP.
const repo = resolve(fileURLToPath(new URL('..', import.meta.url)))
const args = parseArgs(process.argv.slice(2))
const runtimeMode = args.get('mode') ?? null
if (runtimeMode !== null && !['web', 'node'].includes(runtimeMode)) throw new Error('Plugin Runtime mode must be web or node.')
const evidenceName = runtimeMode ? `runtime-${runtimeMode}-packaged-acceptance.json` : 'runtime-packaged-acceptance.json'
const root = await assertTempDirectory(required(args, 'root'))
const nativeRoot = await assertTempDirectory(required(args, 'native-root'))
const managerRoot = await assertTempDirectory(required(args, 'manager-root'))
const nativeExe = await assertCanonicalFile(join(nativeRoot, 'WebTools.NativeHost.exe'))
const managerExe = await assertCanonicalFile(join(managerRoot, 'WebTools.exe'))
const ownership = new ThemeAcceptanceOwnership(nativeExe, managerExe)
assert.equal(await assertTempDirectory(join(root, 'fixtures')), join(root, 'fixtures'))
assert.equal(overlaps(root, join(process.env.APPDATA ?? '', 'Nook')), false, 'test root must not overlap real Nook profile')
assert.equal(overlaps(root, 'D:\\webtools'), false, 'test root must not overlap the protected production installation')

const fixturePaths = {
  fixture: join(root, 'fixtures', 'plugin-runtime-fixture.wtplugin'),
  update: join(root, 'fixtures', 'plugin-runtime-update.wtplugin'),
  isolation: join(root, 'fixtures', 'plugin-runtime-isolation.wtplugin'),
}
for (const path of Object.values(fixturePaths)) await assertCanonicalFile(path)
const profile = join(root, 'profile')
try { await lstat(profile); throw new Error(`Refusing to reuse existing acceptance profile: ${profile}`) }
catch (error) { if (error.code !== 'ENOENT') throw error }
await mkdir(profile)

const httpPort = Number(required(args, 'http-port'))
assert.ok(Number.isInteger(httpPort) && httpPort >= 1024 && httpPort < 65535)
const netPort = httpPort + 1
const debugPort = await reservePort()
const pipeName = `WebTools.NativeHost.Resource.6E7_${randomUUID().replaceAll('-', '')}`
// Phase4EResourceTestOptions uses pipeName for its isolated control endpoint;
// App.xaml.cs derives the Manager pipe from the same unique suffix.
const managerPipeName = `WebTools.NativeHost.Manager.v1.Phase4E.${pipeName.slice(pipeName.lastIndexOf('.') + 1)}`
const processProbeScript = join(repo, 'scripts', 'measure-plugin-runtime-processes.ps1')
const mainProcess = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', processProbeScript,
  '-TestRoot', root, '-NativeRoot', nativeRoot, '-ManagerRoot', managerRoot], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
let processProbeStderr = ''
mainProcess.stderr.on('data', chunk => { processProbeStderr += chunk.toString() })
const processProbeLines = []
createInterface({ input: mainProcess.stdout }).on('line', line => {
  const pending = processProbeLines.shift()
  if (!pending) return
  try { pending.resolve(JSON.parse(line)) } catch (error) { pending.reject(error) }
})
let native
const nativeOutputTail = []
let controlSocket
let controlReader
let mainCdp
let pluginCdp
let runtimeStateTrace = []
let httpSink
let netSink
const sink = { requests: [], socketConnections: 0 }
const netSockets = new Set()
const upgradedSockets = new Set()
const report = {
  status: 'IN_PROGRESS', startedAt: new Date().toISOString(),
  artifacts: { nativeExe, managerExe },
  fixtures: {}, nativePid: null, nativeCreated: null, managerPids: [], scenarios: {},
  sink: { httpPort, netPort }, cleanup: {},
}
for (const [kind, path] of Object.entries(fixturePaths)) report.fixtures[kind] = { path, size: (await stat(path)).size }

function saveReport() { return writeFile(join(root, evidenceName), `${JSON.stringify(report, null, 2)}\n`) }
let lastStage = 'setup'
function log(label, value) { lastStage = label; console.log(`[plugin-runtime-packaged] ${label}: ${JSON.stringify(value)}`) }
function delay(ms) { return new Promise(resolveDelay => setTimeout(resolveDelay, ms)) }
async function until(read, predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    last = await read()
    if (predicate(last)) return last
    if (native && native.exitCode !== null) throw new Error(`NativeHost exited while waiting for ${label}: ${native.exitCode}`)
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${label}${last === undefined ? '' : `; last=${JSON.stringify(last)}`}`)
}
async function processProbeRequest(type = 'scan', identity = undefined) {
  const reply = await new Promise((resolveReply, reject) => {
    const timer = setTimeout(() => reject(new Error(`Process probe timed out: ${processProbeStderr}`)), 15_000)
    processProbeLines.push({ resolve: value => { clearTimeout(timer); resolveReply(value) }, reject: error => { clearTimeout(timer); reject(error) } })
    mainProcess.stdin.write(`${JSON.stringify({ type, pid: identity?.pid, created: identity?.created })}\n`)
  })
  assert.equal(reply.ok, true, reply.error)
  ownership.observe(reply.processes)
  return reply.processes
}
function nativeRecords(records) { return records.filter(item => item.path?.toLowerCase() === nativeExe.toLowerCase()) }
function managerRecords(records) { return records.filter(item => item.path?.toLowerCase().startsWith(`${managerRoot}${sep}`.toLowerCase())) }
function managerMain(records) { return managerRecords(ownership.live(records)).filter(item => item.role === 'main') }

async function connectControl() {
  const pipePath = `\\\\.\\pipe\\${pipeName}`
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    let socket
    let reader
    try {
      socket = createConnection(pipePath)
      await new Promise((resolveConnect, reject) => {
        const timer = setTimeout(() => reject(new Error('Named pipe connection timed out')), 2_000)
        socket.once('connect', () => { clearTimeout(timer); resolveConnect() })
        socket.once('error', error => { clearTimeout(timer); reject(error) })
      })
      reader = createInterface({ input: socket })
      // The control server accepts its sole client before waiting for the real
      // WPF search initialization. Keep that connection alive for the full wait.
      const greeting = await nextPipeLine(reader, 60_000)
      assert.equal(greeting.ok, true)
      assert.equal(greeting.type, 'ready')
      assert.equal(greeting.processId, native.pid)
      controlSocket = socket; controlReader = reader
      return
    } catch (error) {
      socket?.destroy(); reader?.close()
      if (native.exitCode !== null) throw new Error(`NativeHost exited before its isolated control pipe became ready (${native.exitCode}): ${error.message}`)
      await delay(200)
    }
  }
  throw new Error('Timed out waiting for isolated NativeHost control pipe readiness')
}
const controlQueue = []
function nextPipeLine(reader, timeoutMs) {
  return new Promise((resolveLine, reject) => {
    const timer = setTimeout(() => reject(new Error('NativeHost control pipe response timed out')), timeoutMs)
    const onLine = line => { cleanup(); try { resolveLine(JSON.parse(line)) } catch (error) { reject(error) } }
    const onClose = () => { cleanup(); reject(new Error('NativeHost control pipe closed')) }
    const cleanup = () => { clearTimeout(timer); reader.off('line', onLine); reader.off('close', onClose) }
    reader.once('line', onLine); reader.once('close', onClose)
  })
}
async function control(command) {
  assert.ok(controlSocket && controlReader && !controlSocket.destroyed, 'NativeHost control pipe is connected')
  const pending = nextPipeLine(controlReader, 20_000)
  controlSocket.write(`${JSON.stringify(command)}\n`)
  const response = await pending
  assert.equal(response.ok, true, JSON.stringify(response))
  assert.equal(response.processId, native.pid)
  return response
}

class CDP {
  constructor(socket, target) {
    this.socket = socket; this.target = { type: target.type, url: target.url, title: target.title }; this.sequence = 0; this.pending = new Map(); this.exceptions = []; this.consoleMessages = []; this.closeInfo = null
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.method === 'Runtime.exceptionThrown') this.exceptions.push(message.params)
      if (message.method === 'Runtime.consoleAPICalled') this.consoleMessages.push({ type: message.params.type, args: message.params.args?.map(argument => argument.value ?? argument.description ?? argument.type) })
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id); clearTimeout(pending.timer)
      if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result)
    })
    socket.addEventListener('close', event => {
      this.closeInfo = { code: event.code, reason: event.reason, target: this.target }
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(`CDP socket closed for ${this.target.url} (code ${event.code}: ${event.reason})`)) }
      this.pending.clear()
    })
  }
  command(method, params = {}, timeoutMs = 10_000) {
    const id = ++this.sequence
    return new Promise((resolveCommand, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timed out: ${method}`)) }, timeoutMs)
      this.pending.set(id, { resolve: resolveCommand, reject, timer })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression, timeoutMs = 10_000) {
    const result = await this.command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }, timeoutMs)
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
    return result.result?.value
  }
  close() { try { this.socket.close() } catch {} }
}
async function connectTarget(target, onConnected = undefined) {
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolveOpen, reject) => { socket.addEventListener('open', resolveOpen, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  const cdp = new CDP(socket, target)
  onConnected?.(cdp)
  await cdp.command('Runtime.enable')
  return cdp
}
async function targets() {
  try {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`, { signal: AbortSignal.timeout(2000) })
    assert.equal(response.ok, true)
    return await response.json()
  } catch (error) { if (['TypeError', 'TimeoutError'].includes(error.name)) return []; throw error }
}
async function openMainPage() {
  const target = await until(async () => (await targets()).find(item => item.type === 'page' && item.url.startsWith('file:') && item.url.endsWith('/out/renderer/index.html')),
    Boolean, 'packaged Manager renderer target')
  mainCdp = await connectTarget(target)
  await until(() => mainCdp.evaluate(`document.readyState === 'complete' && !!document.querySelector('.app-frame') && !!window.desktop`), Boolean, 'Manager Vue renderer and preload')
  return mainCdp
}
async function openPluginTarget() {
  const target = await until(async () => (await targets()).find(item => item.type === 'page' && item.url.startsWith('webtools-plugin://')),
    Boolean, 'production webtools-plugin protocol target', 30_000)
  pluginCdp = await connectTarget(target, connected => { pluginCdp = connected })
  await until(() => pluginCdp.evaluate(`document.readyState === 'complete'`), Boolean, 'plugin document load', 20_000)
  return { cdp: pluginCdp, url: target.url, origin: await pluginCdp.evaluate('location.origin') }
}
function selectorClick(selector, text = undefined) {
  const condition = text === undefined ? 'true' : `element.textContent.includes(${JSON.stringify(text)})`
  return `(()=>{const element=[...document.querySelectorAll(${JSON.stringify(selector)})].find(element=>${condition});if(!element)throw new Error('Missing UI action: '+${JSON.stringify(text ?? selector)});if(element.disabled)throw new Error('Disabled UI action: '+element.textContent);element.click();return true})()`
}
async function navigateToPluginCenter() {
  // External-package regression targets the public Manager preload contract.
  // The current product opens Features in independent Plugin Windows.
  if (runtimeMode) return
  await mainCdp.evaluate(selectorClick('.nav-apps-trigger'))
  await mainCdp.evaluate(selectorClick('#apps-submenu button', '插件管理'))
  await until(() => mainCdp.evaluate(`document.querySelector('.plugin-manager-heading h1')?.textContent.trim()`), title => title === '插件管理', 'Plugin Center route')
}
async function clickMain(selector, text) { await mainCdp.evaluate(selectorClick(selector, text)) }
async function selectPlugin(name) {
  if (runtimeMode) {
    const result = await mainCdp.evaluate('window.desktop.plugins.list()')
    assert.equal(result.ok, true, JSON.stringify(result))
    const plugin = result.data.find(item => item.id === 'org.webtools.acceptance.runtime' && item.name === name)
    assert.ok(plugin, `Missing validated external plugin ${name}`)
    return plugin
  }
  try {
    const selection = await until(() => mainCdp.evaluate(`(()=>{const page=document.querySelector('.plugin-manager-page');return{row:!![...document.querySelectorAll('.plugin-list-row')].find(row=>row.innerText.includes(${JSON.stringify(name)})),busy:page?.innerText.includes('正在安装…')??false,loading:page?.innerText.includes('正在读取已安装的插件…')??false,feedback:document.querySelector('.plugin-feedback')?.innerText??null,error:document.querySelector('.plugin-empty-error')?.innerText??null}})()`),
      value => value.row || (!value.busy && !value.loading && Boolean(value.feedback || value.error)), `plugin list row ${name}`, 120_000)
    if (!selection.row) throw new Error(`Plugin installation completed without a visible catalog row: ${JSON.stringify(selection)}`)
  } catch (error) {
    const ui = await mainCdp.evaluate(`({title:document.querySelector('.plugin-manager-heading h1')?.textContent.trim()??null,loading:document.querySelector('.plugin-manager-page')?.innerText.includes('正在读取已安装的插件…')??false,feedback:document.querySelector('.plugin-feedback')?.innerText??null,error:document.querySelector('.plugin-empty-error')?.innerText??null,rows:[...document.querySelectorAll('.plugin-list-row')].map(row=>row.innerText),body:document.querySelector('.plugin-manager-page')?.innerText??document.body.innerText})`)
    let registry = null
    try { registry = await readFile(join(profile, 'plugins', 'registry.json'), 'utf8') } catch (readError) { registry = `unavailable: ${readError.message}` }
    const diagnostic = { requestedName: name, ui, registry, effects: await readFile(join(profile, 'plugin-runtime-effects.json'), 'utf8').catch(() => null) }
    report.installDiagnostic = diagnostic
    await saveReport()
    throw new Error(`${error.message}; install diagnostic=${JSON.stringify(diagnostic)}`)
  }
  await clickMain('.plugin-list-row', name)
}
async function installSelectedPackage(packageChoice, name) {
  await writeFile(join(profile, 'plugin-runtime-controls.json'), JSON.stringify({ package: packageChoice, deleteData: true }))
  // Exercise the actual Plugin Center path so its normal Vue completion handler
  // refreshes the catalog after the production preload/IPC install succeeds.
  if (runtimeMode) {
    const installed = await mainCdp.evaluate('window.desktop.plugins.installFromUserDialog()')
    assert.equal(installed.ok, true, JSON.stringify(installed))
  } else {
    const hasPackageSelection = await mainCdp.evaluate(`!!document.querySelector('.plugin-actions button')&&[...document.querySelectorAll('.plugin-actions button')].some(button=>button.textContent.includes('导入替换或新版本'))`)
    if (hasPackageSelection) await clickMain('.plugin-actions button', '导入替换或新版本')
    else await clickMain('.plugin-manager-heading button', '安装本地插件')
  }
  await selectPlugin(name)
  const registry = JSON.parse(await readFile(join(profile, 'plugins', 'registry.json'), 'utf8'))
  const installed = registry.plugins.find(plugin => plugin.id === (packageChoice === 'isolation'
    ? 'org.webtools.acceptance.runtime-isolation' : 'org.webtools.acceptance.runtime'))
  assert.ok(installed, `Host registry does not contain installed fixture ${packageChoice}`)
  report.installResults ??= []
  assert.match(installed.current.hash, /^[a-f0-9]{64}$/u, 'Host registry stores the validated package identity')
  report.installResults.push({ package: packageChoice, outcome: 'installed-and-visible', version: installed.current.version })
  await saveReport()
}
async function enableSelectedPlugin() {
  if (runtimeMode) {
    const enabled = await mainCdp.evaluate(`window.desktop.plugins.setEnabled('org.webtools.acceptance.runtime',true)`)
    assert.equal(enabled.ok, true, JSON.stringify(enabled)); return
  }
  const state = await until(() => mainCdp.evaluate(`({enabled:[...document.querySelectorAll('.plugin-actions button')].some(button=>button.textContent.includes('停用插件')),enable:[...document.querySelectorAll('.plugin-actions button')].some(button=>button.textContent.includes('启用插件'))})`),
    value => value.enabled || value.enable, 'plugin activation controls')
  if (!state.enabled) {
    await clickMain('.plugin-actions button', '启用插件')
    await until(() => mainCdp.evaluate(`[...document.querySelectorAll('.plugin-actions button')].some(button=>button.textContent.includes('停用插件'))`), Boolean, 'plugin enabled')
  }
}
async function openFeature(title, pluginName = 'Plugin Runtime Fixture') {
  log('open-feature-request', { title })
  if (runtimeStateTrace.length === 0) {
    runtimeStateTrace = await mainCdp.evaluate(`(()=>{const states=[];window.__pluginRuntimeStates=states;window.desktop.webRuntime.onState(value=>states.push({...value,at:performance.now()}));return states})()`)
  }
  const plugin = await selectPlugin(pluginName)
  if (runtimeMode) {
    const feature = plugin.webFeatures?.find(item => item.title === title)
    assert.ok(feature, `Missing external Feature ${title}`)
    const opened = await mainCdp.evaluate(`window.desktop.pluginCatalog.open(${JSON.stringify({ kind: plugin.runtimeKind, id: plugin.id, featureId: feature.id })})`)
    assert.equal(opened.ok, true, JSON.stringify(opened))
  } else await clickMain('.plugin-actions button', title)
  const opened = await openPluginTarget()
  log('plugin-feature-opened', { title, url: opened.url, origin: opened.origin })
  return opened
}
async function closeFeature() {
  if (runtimeMode) {
    const closing = pluginCdp
    await closing.command('Page.close').catch(error => { if (!closing.closeInfo) throw error })
    closing.close(); pluginCdp = null
    await until(async () => !(await targets()).some(item => item.type === 'page' && item.url.startsWith('webtools-plugin://')), Boolean, 'independent plugin WebContents closed')
    return
  }
  pluginCdp?.close(); pluginCdp = null
  await clickMain('.web-runtime-toolbar button', '关闭 Feature')
  await until(() => mainCdp.evaluate(`document.querySelector('.plugin-manager-heading h1')?.textContent.trim()`), title => title === '插件管理', 'return to Plugin Center')
  await until(async () => !(await targets()).some(item => item.type === 'page' && item.url.startsWith('webtools-plugin://')), value => value, 'plugin WebContents closed')
}
async function clickPluginButton(cdp, selector) {
  // These capabilities require a fresh foreground input gesture; DOM .click() is not an input event.
  await cdp.command('Page.bringToFront')
  const button = await cdp.evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)throw new Error('Missing Node fixture button: '+${JSON.stringify(selector)});const rect=element.getBoundingClientRect();return{x:rect.left+rect.width/2,y:rect.top+rect.height/2,width:rect.width,height:rect.height}})()`)
  assert.ok(button.width > 0 && button.height > 0, `Node fixture button must be visible: ${JSON.stringify(button)}`)
  await cdp.command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: button.x, y: button.y })
  await cdp.command('Input.dispatchMouseEvent', { type: 'mousePressed', x: button.x, y: button.y, button: 'left', clickCount: 1 })
  await cdp.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: button.x, y: button.y, button: 'left', clickCount: 1 })
}
async function runNodeFeature(title = 'Node Runtime') {
  const opened = await openFeature(title)
  await until(() => opened.cdp.evaluate(`window.__runtimeReport?.ready === true`), Boolean, 'Node feature SDK bridge ready')
  await clickPluginButton(opened.cdp, '#run')
  let result = await until(() => opened.cdp.evaluate('window.__runtimeReport'), value => Boolean(value?.hostApiPassed || value?.error), 'Node, AI Host API, native addon, helper and local-data probes', 45_000)
  assert.equal(result.error, undefined, `Node/AI Host API probe: ${result.error}`)
  await clickPluginButton(opened.cdp, '#clipboard')
  result = await until(() => opened.cdp.evaluate('window.__runtimeReport'), value => Boolean(value?.clipboard || value?.error), 'separate foreground gesture for clipboard capability', 30_000)
  log('node-feature-probes-complete', { reportKeys: Object.keys(result ?? {}), error: result?.error })
  return { ...opened, result }
}
async function closeManagerNormally() {
  mainCdp?.close(); mainCdp = null
  const main = await until(async () => managerMain(await processProbeRequest()), rows => rows.length === 1, 'single exact Manager Main process')
  const identity = main[0]
  const response = await processProbeRequest('close', identity)
  report.managerPids.push({ pid: identity.pid, created: identity.created, close: response.ok })
  await until(async () => managerRecords(await processProbeRequest()).length, count => count === 0, 'all packaged Electron/Manager processes exit after WM_CLOSE', 45_000)
  const state = await until(async () => (await control({ type: 'manager-state' })).manager,
    value => value.processId === null && !value.connected && !value.rendererReady && !value.ensuring,
    'NativeHost releases normally closed Manager', 20_000)
  assert.equal(native.exitCode, null, 'NativeHost remains running after Manager close')
  report.scenarios.lifecycle.push({ normalWMClose: true, electronProcessCount: 0, nativePid: native.pid, controller: state })
}

try {
  await writeAcceptanceProfile()
  await startSinks()
  const before = await processProbeRequest()
  assert.equal(nativeRecords(before).length, 0, 'no stale test NativeHost at accepted executable path')
  assert.equal(managerRecords(before).length, 0, 'no stale test Manager process group at accepted root')
  const env = { ...process.env, WEBTOOLS_MANAGER_EXE: managerExe,
    WEBTOOLS_MANAGER_TEST_DEBUG_PORT: String(debugPort),
    WEBTOOLS_PLUGIN_RUNTIME_ACCEPTANCE: '1', WEBTOOLS_PLUGIN_RUNTIME_TEST_ROOT: root,
    WEBTOOLS_PLUGIN_RUNTIME_TEST_PROFILE: profile, WEBTOOLS_PLUGIN_RUNTIME_TEST_DEBUG_PORT: String(debugPort) }
  delete env.ELECTRON_RUN_AS_NODE
  native = spawn(nativeExe, ['--phase4e-resource-test', profile, join(profile, 'catalog.json'), pipeName, 'Control+Alt+Shift+F12'],
    { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  for (const [name, stream] of [['stdout', native.stdout], ['stderr', native.stderr]]) {
    stream?.on('data', chunk => {
      for (const line of chunk.toString().split(/\r?\n/u).filter(Boolean)) {
        nativeOutputTail.push(`${name}: ${line}`)
        if (nativeOutputTail.length > 300) nativeOutputTail.shift()
      }
    })
  }
  report.nativePid = native.pid
  await until(async () => ownership.claimNative(await processProbeRequest(), native.pid, process.pid), Boolean, 'capture launched NativeHost identity')
  await connectControl()
  let inventory = await processProbeRequest()
  const nativeIdentity = nativeRecords(inventory)
  assert.equal(nativeIdentity.length, 1, 'one real packaged acceptance NativeHost')
  assert.equal(nativeIdentity[0].pid, native.pid)
  report.nativeCreated = nativeIdentity[0].created
  assert.equal(managerRecords(inventory).length, 0, 'Electron count is zero before Manager is requested')
  report.scenarios = { nativeOnly: { nativePid: native.pid, nativeCount: 1, electronCount: 0 }, web: {}, node: {}, frameworks: {},
    storage: {}, update: {}, isolation: {}, uninstall: {}, lifecycle: [] }
  log('native-only', report.scenarios.nativeOnly)

  await control({ type: 'manager-open', section: 'settings' })
  inventory = await until(async () => processProbeRequest(), rows => managerMain(rows).length === 1, 'NativeHost-started Manager Main')
  const firstManager = managerMain(inventory)[0]
  assert.equal(firstManager.parentPid, native.pid, 'real NativeHost launched the Manager')
  report.managerPids.push({ pid: firstManager.pid, created: firstManager.created, parentPid: firstManager.parentPid })
  await until(async () => (await control({ type: 'manager-state' })).manager,
    value => value.connected && value.rendererReady && value.pendingRequestId === null && !value.ensuring,
    'Manager renderer ready acknowledgment')
  await openMainPage()
  report.scenarios.lifecycle.push({ managerStartedOnDemand: true, parentPid: firstManager.parentPid,
    processGroupCount: managerRecords(inventory).length, nativePid: native.pid })

  if (runtimeMode) {
    await runExternalPackageAcceptance()
  } else {

  await navigateToPluginCenter()
  await installSelectedPackage('fixture', 'Plugin Runtime Fixture')
  await enableSelectedPlugin()
  let web = await openFeature('Vanilla Framework')
  const webInitial = await until(() => web.cdp.evaluate('window.__runtimeReport'), value => Boolean(value?.complete || value?.error), 'Vanilla Web Platform probes', 45_000)
  assert.equal(webInitial.error, undefined, `Vanilla fixture error: ${webInitial.error}`)
  assert.equal(webInitial.complete, true, `Vanilla checks failed: ${JSON.stringify(webInitial.checks)}`)
  const mainOrigin = web.origin
  assert.match(mainOrigin, /^webtools-plugin:\/\/p-[a-z2-7]{52}$/)
  assert.equal(webInitial.pluginStoreBefore, null, 'fresh PluginStore namespace')
  report.scenarios.web = { origin: mainOrigin, checks: webInitial.checks, pluginStore: webInitial.pluginStore,
    previousLocalStorage: webInitial.previousLocalStorage, previousIndexedDb: webInitial.previousIndexedDb }
  report.sink.httpRequestCountAfterWeb = sink.requests.length
  log('standard-web', report.scenarios.web)
  await closeFeature()

  const frameworkResults = {}
  for (const framework of ['vue', 'react', 'svelte']) {
    const opened = await openFeature(`${framework[0].toUpperCase()}${framework.slice(1)} Framework`)
    const result = await until(() => opened.cdp.evaluate(`({framework:document.documentElement.dataset.framework??null,content:document.querySelector('#app')?.innerText??''})`),
      value => value.framework === framework && value.content.includes('framework-pass'), `${framework} production framework fixture`, 45_000)
    assert.equal(result.framework, framework)
    assert.match(result.content, /framework-pass/u)
    frameworkResults[framework] = { rendered: true, corsFetch: true, content: result.content }
    await closeFeature()
  }
  report.scenarios.frameworks = frameworkResults
  log('frameworks', frameworkResults)

  let nodeRun = await runNodeFeature()
  const nodeInitial = nodeRun.result
  assert.equal(nodeInitial.error, undefined, `Node page/Host bridge error: ${nodeInitial.error}`)
  assert.equal(nodeInitial.hostApiPassed, true, 'PluginStore, Shared AI mock, clipboard and context path')
  assert.equal(nodeInitial.native.managerIpcDenied, true, 'Node preload cannot invoke Manager-only settings IPC')
  assert.equal(nodeInitial.native.nodeIntegrationPage, true, 'Node is absent from plugin page world')
  assert.equal(nodeInitial.native.nativeAddon, 'native-addon-loaded', 'native addon executed in real packaged preload')
  assert.equal(nodeInitial.native.helper, 'runtime-helper:acceptance', 'packaged helper executable ran and returned expected stdout')
  assert.equal(nodeInitial.native.builtins, true)
  assert.equal(nodeInitial.native.file && nodeInitial.native.path && nodeInitial.native.os && nodeInitial.native.crypto && nodeInitial.native.buffer && nodeInitial.native.stream, true)
  assert.equal(nodeInitial.native.nodeHttp, true); assert.equal(nodeInitial.native.axios, true); assert.equal(nodeInitial.native.net, true)
  assert.equal(nodeInitial.native.yauzl, true); assert.equal(nodeInitial.native.nestedDependency, true); assert.equal(nodeInitial.native.commonjs, true)
  assert.equal(nodeInitial.native.localDataCount, 1)
  assert.ok(isWithin(profile, nodeInitial.native.localDataPath), 'Node Plugin Local Data is inside isolated profile')
  assert.equal(nodeRun.origin, mainOrigin, 'same plugin uses one stable origin across features')
  assert.equal(nodeInitial.hostStorageBefore, null)
  report.scenarios.node = { native: nodeInitial.native, hostApiPassed: nodeInitial.hostApiPassed,
    hostStorageBefore: nodeInitial.hostStorageBefore, hostStorageAfter: nodeInitial.hostStorageAfter,
    aiResult: nodeInitial.ai, sameOriginAsWebFeature: nodeRun.origin === mainOrigin }
  report.localDataPath = nodeInitial.native.localDataPath
  report.versions = nodeInitial.native.versions
  log('node-runtime', { native: nodeInitial.native, hostApiPassed: nodeInitial.hostApiPassed })
  // Deliberately close Manager with the real Node plugin WebContentsView active.
  await closeManagerNormally()
  assert.equal(managerRecords(await processProbeRequest()).length, 0)
  await control({ type: 'manager-open', section: 'settings' })
  inventory = await until(async () => processProbeRequest(), rows => managerMain(rows).length === 1, 'Manager relaunch after normal close')
  const secondManager = managerMain(inventory)[0]
  assert.equal(secondManager.parentPid, native.pid)
  await until(async () => (await control({ type: 'manager-state' })).manager,
    value => value.connected && value.rendererReady && value.pendingRequestId === null && !value.ensuring, 'reopened Manager renderer ready')
  await openMainPage(); await navigateToPluginCenter(); await selectPlugin('Plugin Runtime Fixture')
  let persistedWeb = await openFeature('Vanilla Framework')
  const persistedWebResult = await until(() => persistedWeb.cdp.evaluate('window.__runtimeReport'), value => Boolean(value?.complete || value?.error), 'cross-Manager-restart browser storage', 45_000)
  assert.equal(persistedWebResult.complete, true, JSON.stringify(persistedWebResult.checks))
  assert.equal(persistedWebResult.previousLocalStorage, 'persisted')
  assert.equal(persistedWebResult.previousIndexedDb, 'indexeddb-persisted')
  assert.equal(persistedWebResult.pluginStoreBefore?.marker, 'persistent-web', 'PluginStore survives Manager process restart')
  assert.equal(persistedWeb.origin, mainOrigin, 'origin stays stable after Manager process restart')
  report.scenarios.storage = { managerRestart: true, localStorage: persistedWebResult.previousLocalStorage,
    indexedDb: persistedWebResult.previousIndexedDb, pluginStore: persistedWebResult.pluginStoreBefore, stableOrigin: persistedWeb.origin }
  await closeFeature()
  nodeRun = await runNodeFeature()
  assert.equal(nodeRun.result.native.localDataCount, 2, 'Node Plugin Local Data survives Manager restart')
  assert.equal(nodeRun.result.previousRuntimeClosed, 'yes', 'Plugin onClose callback persists before Manager process exits')
  assert.equal(nodeRun.result.native.localDataPath, report.localDataPath)
  assert.equal(nodeRun.result.native.managerIpcDenied, true)
  assert.equal(nodeRun.result.hostStorageBefore?.marker, 'runtime-2', 'PluginStore survives Manager restart')
  report.scenarios.storage.nodeLocalData = { countAfterRestart: nodeRun.result.native.localDataCount, pathStable: nodeRun.result.native.localDataPath }
  await closeFeature()

  // Install a second identity with the same storage keys; it must receive a different origin and empty stores.
  await installSelectedPackage('isolation', 'Plugin Runtime Isolation Fixture')
  await enableSelectedPlugin()
  const isolated = await openFeature('Vanilla Framework', 'Plugin Runtime Isolation Fixture')
  const isolationResult = await until(() => isolated.cdp.evaluate('window.__runtimeReport'), value => Boolean(value?.complete || value?.error), 'cross-plugin storage isolation', 45_000)
  assert.equal(isolationResult.complete, true, JSON.stringify(isolationResult.checks))
  assert.notEqual(isolated.origin, mainOrigin, 'different plugin ID has an isolated origin')
  assert.equal(isolationResult.previousLocalStorage, null)
  assert.equal(isolationResult.previousIndexedDb, null)
  assert.equal(isolationResult.pluginStoreBefore, null, 'PluginStore data is namespaced by canonical plugin ID')
  report.scenarios.isolation = { firstPluginOrigin: mainOrigin, secondPluginOrigin: isolated.origin,
    localStorage: isolationResult.previousLocalStorage, indexedDb: isolationResult.previousIndexedDb,
    pluginStore: isolationResult.pluginStoreBefore }
  await closeFeature()

  // Upgrade the same canonical plugin ID while retaining both Web storage and direct Node local data.
  await selectPlugin('Plugin Runtime Fixture')
  await writeFile(join(profile, 'plugin-runtime-controls.json'), JSON.stringify({ package: 'update', deleteData: true }))
  await clickMain('.plugin-actions button', '导入替换或新版本')
  await until(() => mainCdp.evaluate(`!![...document.querySelectorAll('.plugin-list-row')].find(row=>row.innerText.includes('Plugin Runtime Fixture')&&row.innerText.includes('2.0.0'))`), Boolean, 'v2 package upgrade in Plugin Center', 30_000)
  await selectPlugin('Plugin Runtime Fixture')
  const upgradedWeb = await openFeature('Vanilla Framework')
  const upgradedWebResult = await until(() => upgradedWeb.cdp.evaluate('window.__runtimeReport'), value => Boolean(value?.complete || value?.error), 'Web storage after package update', 45_000)
  assert.equal(upgradedWebResult.complete, true, JSON.stringify(upgradedWebResult.checks))
  assert.equal(upgradedWebResult.previousLocalStorage, 'persisted')
  assert.equal(upgradedWebResult.previousIndexedDb, 'indexeddb-persisted')
  assert.equal(upgradedWeb.origin, mainOrigin)
  await closeFeature()
  nodeRun = await runNodeFeature()
  assert.equal(nodeRun.result.native.localDataCount, 3, 'Node Local Data survives plugin version update')
  assert.equal(nodeRun.result.native.localDataPath, report.localDataPath)
  assert.equal(nodeRun.result.hostStorageBefore?.marker, 'runtime-2')
  report.scenarios.update = { version: '2.0.0', stableOrigin: nodeRun.origin === mainOrigin,
    localStorage: upgradedWebResult.previousLocalStorage, indexedDb: upgradedWebResult.previousIndexedDb,
    localDataPath: nodeRun.result.native.localDataPath, localDataCount: nodeRun.result.native.localDataCount,
    }
  await closeFeature()

  // Explicit uninstall with delete-data confirmation must remove direct local data and Browser storage.
  await selectPlugin('Plugin Runtime Fixture')
  await writeFile(join(profile, 'plugin-runtime-controls.json'), JSON.stringify({ package: 'fixture', deleteData: true }))
  await clickMain('.plugin-actions button', '卸载')
  await until(async () => mainCdp.evaluate(`![...document.querySelectorAll('.plugin-list-row')].some(row=>row.innerText.includes('Plugin Runtime Fixture'))`), Boolean, 'plugin uninstall')
  const localDataExistsAfterUninstall = await exists(report.localDataPath)
  assert.equal(localDataExistsAfterUninstall, false, 'delete-data uninstall removes Node Plugin Local Data')
  await installSelectedPackage('fixture', 'Plugin Runtime Fixture')
  await enableSelectedPlugin()
  const reinstalled = await openFeature('Vanilla Framework')
  const reinstallResult = await until(() => reinstalled.cdp.evaluate('window.__runtimeReport'), value => Boolean(value?.complete || value?.error), 'reinstall after delete-data uninstall', 45_000)
  assert.equal(reinstallResult.complete, true, JSON.stringify(reinstallResult.checks))
  assert.equal(reinstallResult.previousLocalStorage, null, 'delete-data uninstall clears Chromium localStorage')
  assert.equal(reinstallResult.previousIndexedDb, null, 'delete-data uninstall clears IndexedDB')
  assert.equal(reinstallResult.pluginStoreBefore, null, 'uninstall/reinstall does not retain PluginStore data')
  report.scenarios.uninstall = { packageRemoved: true, localDataRemoved: !localDataExistsAfterUninstall,
    reinstallBrowserStorageEmpty: reinstallResult.previousLocalStorage === null && reinstallResult.previousIndexedDb === null }
  await closeFeature()

  const effects = JSON.parse(await readFile(join(profile, 'plugin-runtime-effects.json'), 'utf8'))
  assert.ok(effects.aiCalls >= 1, 'Shared AI mock/provider boundary called by actual packaged plugin')
  assert.ok(effects.clipboardWriteCount >= 1, 'Host clipboard API was exercised')
  assert.ok(effects.confirmations.includes('install') && effects.confirmations.includes('grant')
    && effects.confirmations.includes('uninstall')
    && effects.confirmations.includes('delete-data'), 'acceptance host observed install/grant/update/uninstall confirmations')
  assert.ok(effects.upgradeConfirmations.some(value => value.pluginId === 'org.webtools.acceptance.runtime'
    && value.currentVersion === '1.0.0' && value.incomingVersion === '2.0.0' && value.runtimeKind === 'node'),
  'Node plugin version upgrade required explicit Host confirmation')
  report.hostApi = { aiCalls: effects.aiCalls, clipboardWriteCount: effects.clipboardWriteCount,
    confirmations: effects.confirmations, upgradeConfirmations: effects.upgradeConfirmations,
    noRealProviderOrSecretConfigured: true }
  report.sink.httpRequestCount = sink.requests.length
  report.sink.requests = sink.requests.map(({ path, method, origin }) => ({ path, method, origin }))
  report.sink.socketConnections = sink.socketConnections

  await closeManagerNormally()
  const afterManagerClose = await processProbeRequest()
  assert.equal(nativeRecords(afterManagerClose).length, 1)
  assert.equal(managerRecords(afterManagerClose).length, 0)
  await control({ type: 'exit' })
  await once(native, 'exit')
  const afterNativeExit = await until(() => processProbeRequest(), rows => nativeRecords(rows).length === 0 && managerRecords(rows).length === 0,
    'all isolated test processes exit after orderly NativeHost shutdown')
  report.scenarios.finalProcessGate = { managerCloseElectronCount: 0, nativeRetainedUntilExplicitExit: true,
    afterNativeExit: { nativeCount: nativeRecords(afterNativeExit).length, electronCount: managerRecords(afterNativeExit).length } }
  report.status = 'PACKAGED_RUNTIME_ACCEPTANCE_PASS'
  report.finishedAt = new Date().toISOString()
  await saveReport()
  log('PASS', { root, nativePid: report.nativePid, scenarios: Object.keys(report.scenarios), sinkRequests: report.sink.httpRequestCount })
  }
} catch (error) {
  report.status = runtimeMode ? 'PLUGIN_RUNTIME_EXTERNAL_PACKAGED_FAIL' : 'PACKAGED_RUNTIME_ACCEPTANCE_FAIL'
  let browserTargets = null; let processInventory = null
  try { browserTargets = (await targets()).map(({ type, title, url }) => ({ type, title, url })) } catch {}
  try { processInventory = await processProbeRequest() } catch {}
  const runtimeTrace = await readFile(join(profile, 'plugin-runtime-trace.jsonl'), 'utf8').catch(() => '')
  report.error = { name: error.name, message: error.message, stack: error.stack, stage: lastStage,
    mainCdp: mainCdp ? { target: mainCdp.target, closed: mainCdp.closeInfo, exceptions: mainCdp.exceptions.slice(-20), consoleMessages: mainCdp.consoleMessages.slice(-30) } : null,
    pluginCdp: pluginCdp ? { target: pluginCdp.target, closed: pluginCdp.closeInfo, exceptions: pluginCdp.exceptions.slice(-20), consoleMessages: pluginCdp.consoleMessages.slice(-30) } : null,
    runtimeStateTrace: mainCdp ? await mainCdp.evaluate('window.__pluginRuntimeStates??[]').catch(() => runtimeStateTrace) : runtimeStateTrace,
    managerUi: mainCdp ? await mainCdp.evaluate(`({title:document.querySelector('.breadcrumb strong')?.textContent??null,body:document.body.innerText.slice(-4000)})`).catch(() => null) : null,
    productionRuntimeTrace: runtimeTrace.split(/\r?\n/u).filter(Boolean).map(line => { try { return JSON.parse(line) } catch { return { malformed: true } } }),
    nativeOutputTail: nativeOutputTail.slice(-120),
    browserTargets, processInventory }
  report.finishedAt = new Date().toISOString()
  await saveReport().catch(() => {})
  console.error(`[plugin-runtime-packaged] FAILURE: ${error.stack ?? error}`)
  process.exitCode = 1
} finally {
  pluginCdp?.close(); mainCdp?.close()
  try {
    const activeManagers = managerMain(await processProbeRequest())
    if (activeManagers.length === 1) {
      await processProbeRequest('close', activeManagers[0])
      await until(async () => managerRecords(await processProbeRequest()).length, count => count === 0, 'cleanup normal Manager close', 15_000)
    }
  } catch (cleanupError) { report.cleanupManagerError = cleanupError.message }
  if (native?.exitCode === null) {
    try {
      if (controlSocket && !controlSocket.destroyed) await control({ type: 'exit' })
      else {
        const hosts = nativeRecords(ownership.live(await processProbeRequest()))
        if (hosts.length === 1) await processProbeRequest('close-native', hosts[0])
      }
    } catch (cleanupError) { report.cleanupNativeError = cleanupError.message }
  }
  if (native && native.exitCode === null) {
    try { await Promise.race([once(native, 'exit'), delay(5000)]) } catch {}
  }
  if (controlSocket && !controlSocket.destroyed) controlSocket.destroy()
  controlReader?.close()
  if (httpSink) await new Promise(resolveClose => {
    httpSink.close(resolveClose)
    httpSink.closeAllConnections()
    for (const socket of upgradedSockets) socket.destroy()
  })
  if (netSink) await new Promise(resolveClose => {
    netSink.close(resolveClose)
    for (const socket of netSockets) socket.destroy()
  })
  if (mainProcess.exitCode === null) { mainProcess.stdin.end(); await Promise.race([once(mainProcess, 'exit'), delay(5000)]) }
  report.cleanup = { nativeExitCode: native?.exitCode ?? null, processProbeExitCode: mainProcess.exitCode,
    controlPipeClosed: controlSocket?.destroyed ?? true }
  await saveReport().catch(() => {})
  console.log(`Acceptance evidence: ${join(root, evidenceName)}`)
}

async function runExternalPackageAcceptance() {
  const framework = required(args, 'framework')
  const pluginName = required(args, 'plugin-name')
  const featureTitle = required(args, 'feature-title')
  await navigateToPluginCenter()
  await installSelectedPackage('fixture', pluginName)
  await enableSelectedPlugin()
  const opened = await openFeature(featureTitle, pluginName)
  let result
  if (runtimeMode === 'web') {
    result = await until(() => opened.cdp.evaluate(`({text:document.body.innerText,framework:document.documentElement.dataset.framework??null})`),
      value => value.text.includes('WebTools API ready'), `${framework} external plugin rendered in packaged Host`, 45_000)
    assert.equal(result.framework, framework, `${framework} DOM identifies its framework`)
    assert.match(result.text, new RegExp(`Hello from ${framework[0].toUpperCase()}${framework.slice(1)}`, 'u'))
  } else {
    result = await until(() => opened.cdp.evaluate('window.__runtimeReport??null'),
      value => Boolean(value?.ready || value?.error), 'external Node preload and Plugin frontend report', 45_000)
    assert.equal(result.error, undefined, `External Node runtime reported an error: ${result.error}`)
    const pipeProbeManagerState = await control({ type: 'manager-state' })
    const activeManagerState = pipeProbeManagerState.manager
    const rawPipeProbeDenied = result.nativePipeDenied
    const blockedByAuthenticatedManagerSession = result.nativePipeDiagnostic?.reason === 'probe-timeout'
      && result.nativePipeDiagnostic?.connected === false
      && result.nativePipeDiagnostic?.receivedBytes === 0
      && activeManagerState?.connected === true
      && activeManagerState?.rendererReady === true
    result.nativePipeProbeEvidence = {
      rawDenied: rawPipeProbeDenied,
      diagnostic: result.nativePipeDiagnostic,
      managerPipeConnected: activeManagerState?.connected ?? false,
      managerRendererReady: activeManagerState?.rendererReady ?? false,
      blockedByAuthenticatedManagerSession,
    }
    result.nativePipeDenied = rawPipeProbeDenied || blockedByAuthenticatedManagerSession
    log('runtime-node-boundary-probes', result.nativePipeProbeEvidence)
    assert.equal(result.framework, framework)
    assert.equal(result.webToolsApi, true, 'external Node frontend connected to the typed WebTools SDK API')
    assert.equal(result.pluginOwnedPreload, true, 'external frontend read the Plugin-owned contextBridge API')
    assert.equal(result.localDataCount, 1, 'external Node preload wrote isolated Plugin Local Data')
    assert.equal(result.npmDependency, true, 'ordinary and nested npm dependencies resolved from the package')
    assert.equal(result.nativeAddon, true, 'external npm native addon executed in packaged Electron')
    assert.equal(result.helper, 'runtime-external-helper:ok', 'external bundled helper executable ran')
    assert.equal(result.dllResource, true, 'external DLL resource was included and read from the package')
    assert.equal(result.managerIpcDenied, true, 'Node plugin preload cannot use a Manager-only IPC route')
    assert.equal(result.nativePipeDenied, true, 'Node plugin preload cannot claim the privileged NativeHost pipe')
    assert.equal(result.nativePipeDiagnostic?.pipeNameConfigured, true, 'Node plugin probe targeted the isolated Manager pipe')
    assert.ok(typeof result.nativePipeDiagnostic?.reason === 'string' && result.nativePipeDiagnostic.reason.length > 0,
      'Node plugin pipe probe records the observed denial reason')
    assert.equal(result.pageNodeEscapeBlocked, true, 'plugin frontend does not receive Node or Electron globals')
  }
  report.scenarios.runtime = { mode: runtimeMode, framework, pluginId: 'org.webtools.acceptance.runtime',
    pluginName, featureTitle, firstLaunch: result }
  await closeFeature()
  await closeManagerNormally()
  let inventory = await processProbeRequest()
  assert.equal(nativeRecords(inventory).length, 1, 'NativeHost remains after normally closed external-plugin Manager')
  assert.equal(managerRecords(inventory).length, 0, 'Electron process group returns to zero after external-plugin Manager close')

  await control({ type: 'manager-open', section: 'settings' })
  inventory = await until(async () => processProbeRequest(), rows => managerMain(rows).length === 1, 'Manager relaunch after external-plugin close')
  assert.equal(managerMain(inventory)[0].parentPid, native.pid)
  await until(async () => (await control({ type: 'manager-state' })).manager,
    value => value.connected && value.rendererReady && value.pendingRequestId === null && !value.ensuring,
    'external acceptance Manager re-open readiness')
  await openMainPage()
  await navigateToPluginCenter()
  await selectPlugin(pluginName)
  const reopened = await openFeature(featureTitle, pluginName)
  if (runtimeMode === 'node') {
    const persisted = await until(() => reopened.cdp.evaluate('window.__runtimeReport??null'),
      value => Boolean(value?.ready || value?.error), 'external Node Plugin Local Data after Manager restart', 45_000)
    assert.equal(persisted.error, undefined)
    assert.equal(persisted.localDataCount, 2, 'external Plugin Local Data survives a normal Manager process restart')
    report.scenarios.runtime.secondLaunch = persisted
  } else {
    const repeated = await until(() => reopened.cdp.evaluate('document.body.innerText'), text => text.includes('WebTools API ready'),
      `${framework} external plugin can launch again after Manager restart`, 45_000)
    assert.match(repeated, new RegExp(`Hello from ${framework[0].toUpperCase()}${framework.slice(1)}`, 'u'))
  }
  await closeFeature()
  await closeManagerNormally()
  inventory = await processProbeRequest()
  assert.equal(nativeRecords(inventory).length, 1)
  assert.equal(managerRecords(inventory).length, 0)
  await control({ type: 'exit' })
  await once(native, 'exit')
  const afterExit = await until(() => processProbeRequest(), rows => nativeRecords(rows).length === 0 && managerRecords(rows).length === 0,
    'external packaged acceptance NativeHost orderly exit')
  report.scenarios.finalProcessGate = { managerCloseElectronCount: 0, nativeRetainedUntilExplicitExit: true,
    afterNativeExit: { nativeCount: nativeRecords(afterExit).length, electronCount: managerRecords(afterExit).length } }
  report.status = 'PLUGIN_RUNTIME_EXTERNAL_PACKAGED_PASS'
  report.finishedAt = new Date().toISOString()
  await saveReport()
  log('PLUGIN_RUNTIME_EXTERNAL_PACKAGED_PASS', { root, nativePid: report.nativePid, mode: runtimeMode, framework })
}

async function writeAcceptanceProfile() {
  const data = createDefaultAppData()
  data.settings.quickSearchShortcut = 'Control+Alt+Shift+F12'
  await writeFile(join(profile, 'nook-data.json'), JSON.stringify(data))
  await writeFile(join(profile, 'launcher-state.json'), JSON.stringify({
    schemaVersion: 1, quickSearchShortcut: data.settings.quickSearchShortcut, theme: 'dark', launcherDisplayMode: 'compact', launchOnStartup: false,
    searchEngines: data.settings.searchEngines, defaultSearchEngineId: 'google', everythingEnabled: false, everythingEsPath: '',
    websites: [], appSearchMemory: [],
  }))
  await writeFile(join(profile, 'catalog.json'), JSON.stringify({ schemaVersion: 1, generatedAtUtc: new Date().toISOString(), apps: [] }))
  await writeFile(join(profile, 'plugin-runtime-controls.json'), JSON.stringify({ package: 'fixture', deleteData: true }))
}

async function startSinks() {
  httpSink = createHttpServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${httpPort}`)
    sink.requests.push({ path: url.pathname, method: request.method ?? 'GET', origin: request.headers.origin ?? '' })
    response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (url.pathname !== '/cors-deny') response.setHeader('Access-Control-Allow-Origin', '*')
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return }
    if (url.pathname === '/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      response.end('data: {"value":"sse-ok"}\n\n'); return
    }
    const values = { '/cors': 'cors-ok', '/xhr': 'xhr-ok', '/axios': 'axios-ok', '/node': 'node-http-ok', '/net': 'net-ok', '/cors-deny': 'denied-response' }
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ value: values[url.pathname] ?? 'unknown' }))
  })
  httpSink.on('upgrade', (request, socket) => {
    upgradedSockets.add(socket)
    socket.once('close', () => upgradedSockets.delete(socket))
    socket.on('data', bytes => {
      if ((bytes[0] & 0x0f) === 0x08) socket.end(Buffer.from([0x88, 0x00]))
    })
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${httpPort}`)
    sink.requests.push({ path: url.pathname, method: 'UPGRADE', origin: request.headers.origin ?? '' })
    if (url.pathname !== '/ws' || !request.headers['sec-websocket-key']) { socket.destroy(); return }
    const accept = createHash('sha1').update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    const payload = Buffer.from('websocket-ok')
    socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]))
  })
  await listen(httpSink, httpPort)
  netSink = createServer(socket => {
    sink.socketConnections++
    netSockets.add(socket)
    socket.once('close', () => netSockets.delete(socket))
    socket.on('data', bytes => { if (bytes.toString().includes('runtime-net')) socket.write('net-ok') })
  })
  await listen(netSink, netPort)
}

async function listen(server, port) {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolveListen() })
  })
}
async function reservePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const port = server.address().port
  await new Promise(resolveClose => server.close(resolveClose))
  return port
}
async function exists(path) { try { await lstat(path); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error } }
function parseArgs(values) { const map = new Map(); for (let i = 0; i < values.length; i += 2) { if (!values[i]?.startsWith('--') || !values[i + 1]) throw new Error('Expected --name value arguments.'); map.set(values[i].slice(2), values[i + 1]) } return map }
function required(map, name) { const value = map.get(name); if (!value) throw new Error(`Missing --${name}`); return value }
function overlaps(left, right) { return isWithin(left, right) || isWithin(right, left) }
function isWithin(parent, child) { const rel = relative(resolve(parent), resolve(child)); return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) }
async function assertTempDirectory(path) {
  assert.ok(isAbsolute(path), `Expected absolute path: ${path}`)
  const canonical = await realpath(path)
  const temp = await realpath(tmpdir())
  assert.ok(isWithin(temp, canonical) && canonical.toLowerCase() !== temp.toLowerCase(), `Path must be a strict TEMP descendant: ${canonical}`)
  let current = resolve(tmpdir())
  for (const part of relative(current, canonical).split(sep).filter(Boolean)) {
    current = join(current, part)
    const info = await lstat(current)
    assert.equal(info.isSymbolicLink(), false, `TEMP path contains a symbolic link/reparse point: ${current}`)
  }
  assert.equal((await stat(canonical)).isDirectory(), true)
  return canonical
}
async function assertCanonicalFile(path) {
  assert.ok(isAbsolute(path))
  const canonical = await realpath(path)
  const info = await lstat(path)
  assert.equal(info.isFile(), true, `Expected regular file: ${path}`)
  assert.equal(info.isSymbolicLink(), false, `Unexpected link: ${path}`)
  assert.equal(canonical.toLowerCase(), resolve(path).toLowerCase(), `Path is not canonical: ${path}`)
  assert.ok(isWithin(await realpath(tmpdir()), canonical), `Executable/package must be inside TEMP: ${path}`)
  return canonical
}
