// Bounded Phase 6E-5E acceptance against the real electron-builder win-unpacked app.
// The supplied Manager executable, fixture, profile, and evidence must all live under one disposable TEMP root.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { cp, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { webManifest, webPackage } from '../electron/plugins/fixtures.mjs'
import { validateWebPackageForRuntime } from '../electron/plugins/package-validator.ts'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const managerRequire = createRequire(require.resolve('electron-builder'))
const asar = managerRequire('@electron/asar')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

function argumentsMap(argv) {
  const result = new Map()
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index]
    if (!['--manager-exe', '--acceptance-root'].includes(name) || result.has(name)) throw new Error('Usage: verify-phase6e5e-packaged-bridge.mjs --manager-exe <TEMP win-unpacked exe> --acceptance-root <TEMP root>')
    const value = argv[++index]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`)
    result.set(name, value)
  }
  if (result.size !== 2) throw new Error('Both --manager-exe and --acceptance-root are required.')
  return result
}

function normalizedPath(value) {
  return path.win32.resolve(value).replace(/^\\\\\?\\/, '').replaceAll('/', '\\').toLowerCase()
}

function inside(parent, child) {
  const relative = path.win32.relative(normalizedPath(parent), normalizedPath(child))
  return relative === '' || (relative !== '..' && !relative.startsWith(`..\\`) && !path.win32.isAbsolute(relative))
}

function overlaps(left, right) { return inside(left, right) || inside(right, left) }

function assertInsideTemp(candidate, label) {
  if (!path.isAbsolute(candidate) || !inside(tmpdir(), candidate) || normalizedPath(candidate) === normalizedPath(tmpdir())) {
    throw new Error(`${label} must be a strict descendant of the current system TEMP directory.`)
  }
}

async function assertNoReparsePoints(parent, target) {
  const relative = path.win32.relative(normalizedPath(parent), normalizedPath(target))
  if (!relative || relative === '..' || relative.startsWith('..\\') || path.win32.isAbsolute(relative)) throw new Error('Acceptance path is outside its protected TEMP root.')
  let current = path.win32.resolve(parent)
  for (const segment of relative.split('\\').filter(Boolean)) {
    current = path.win32.join(current, segment)
    const info = await lstat(current)
    if (info.isSymbolicLink()) throw new Error('Acceptance paths may not contain symbolic links or junctions.')
  }
}

async function waitFor(read, predicate, label, timeoutMs = 20_000) {
  const end = Date.now() + timeoutMs
  let last
  while (Date.now() < end) {
    try {
      last = await read()
      if (predicate(last)) return last
    } catch {}
    await pause(100)
  }
  throw new Error(`Bounded wait failed: ${label}; last=${JSON.stringify(last)}`)
}

async function freePort() {
  const { createServer } = await import('node:net')
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not allocate a loopback DevTools port.')
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return address.port
}

async function cdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl)
  const pending = new Map()
  let nextId = 0
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('DevTools websocket did not open.')) }, 5_000)
    socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('DevTools websocket failed.')) }, { once: true })
  })
  socket.addEventListener('message', event => {
    let message
    try { message = JSON.parse(String(event.data)) } catch { return }
    const item = pending.get(message.id)
    if (!item) return
    pending.delete(message.id)
    clearTimeout(item.timer)
    if (message.error) item.reject(new Error(`DevTools command failed: ${message.error.code ?? 'unknown'}`))
    else if (message.result?.exceptionDetails) item.reject(new Error('Plugin renderer evaluation failed.'))
    else item.resolve(message.result)
  })
  socket.addEventListener('close', () => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('DevTools websocket closed.')) }
    pending.clear()
  })
  return {
    evaluate(expression) {
      const id = ++nextId
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('DevTools evaluation timed out.')) }, 8_000)
        pending.set(id, { resolve, reject, timer })
        socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
      })
    },
    close() { socket.close() },
  }
}

async function devtoolsJson(base, route = '/json/list') {
  const response = await fetch(`${base}${route}`, { signal: AbortSignal.timeout(2_000) })
  if (!response.ok) throw new Error(`DevTools endpoint returned HTTP ${response.status}.`)
  return response.json()
}

function pathEquals(left, right) { return normalizedPath(left) === normalizedPath(right) }

function processSnapshot() {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress'],
  { windowsHide: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error('Read-only Windows process snapshot failed.')
  const output = result.stdout.trim()
  if (!output) return []
  const parsed = JSON.parse(output)
  return Array.isArray(parsed) ? parsed : [parsed]
}

function createProcessGroupTracker(managerExe, packagedRoot, profile, rootPid) {
  const identities = new Map()
  function capture() {
    const snapshot = processSnapshot()
    const root = snapshot.find(item => Number(item.ProcessId) === rootPid && pathEquals(item.ExecutablePath ?? '', managerExe)
      && String(item.CommandLine ?? '').toLowerCase().includes(profile.toLowerCase()))
    if (root) identities.set(Number(root.ProcessId), { creationDate: String(root.CreationDate ?? ''), executablePath: root.ExecutablePath })
    const selected = new Set(root ? [Number(root.ProcessId)] : [])
    let changed = true
    while (changed) {
      changed = false
      for (const item of snapshot) {
        const id = Number(item.ProcessId)
        if (selected.has(id)) continue
        const executablePath = String(item.ExecutablePath ?? '')
        const profileMatch = String(item.CommandLine ?? '').toLowerCase().includes(profile.toLowerCase())
        const childOfOwned = selected.has(Number(item.ParentProcessId))
        if ((profileMatch && (pathEquals(executablePath, managerExe) || inside(packagedRoot, executablePath)))
          || (childOfOwned && inside(packagedRoot, executablePath))) {
          selected.add(id)
          identities.set(id, { creationDate: String(item.CreationDate ?? ''), executablePath })
          changed = true
        }
      }
    }
    return snapshot.filter(item => selected.has(Number(item.ProcessId)))
  }
  function remaining() {
    const current = processSnapshot()
    return [...identities.entries()].flatMap(([id, identity]) => current.filter(item => Number(item.ProcessId) === id
      && String(item.CreationDate ?? '') === identity.creationDate
      && pathEquals(String(item.ExecutablePath ?? ''), identity.executablePath)))
  }
  return { capture, remaining, identities }
}

function appAsarEntry(archive, relativePath) {
  const segments = relativePath.split('/').filter(Boolean)
  let entry = archive.header.files
  for (const [index, segment] of segments.entries()) {
    entry = entry?.[segment]
    if (!entry) throw new Error(`Packaged app.asar is missing ${relativePath}.`)
    if (index < segments.length - 1) entry = entry.files
  }
  if (entry.files || entry.link || entry.unpacked || !Number.isSafeInteger(entry.size) || !/^\d+$/.test(entry.offset ?? '')) {
    throw new Error(`Packaged app.asar entry is not a regular packed file: ${relativePath}.`)
  }
  const start = 8 + archive.headerSize + Number(entry.offset)
  const end = start + entry.size
  if (!Number.isSafeInteger(start) || end > archive.bytes.length) throw new Error(`Packaged app.asar entry is outside archive bounds: ${relativePath}.`)
  const bytes = archive.bytes.subarray(start, end)
  assert.equal(entry.integrity?.algorithm, 'SHA256', `Packaged app.asar entry has no SHA256 integrity metadata: ${relativePath}.`)
  assert.equal(hash(bytes), entry.integrity.hash, `Packaged app.asar integrity mismatch: ${relativePath}.`)
  return bytes
}

async function buildFixture(root, hostVersion) {
  const sourceRoot = path.join(root, 'external-developer', 'private-notes')
  const sourceDirectory = path.join(sourceRoot, 'src')
  const sdkTarget = path.join(sourceRoot, 'node_modules', '@webtools', 'plugin-sdk')
  const fixturePath = path.join(root, 'phase6e4b-runtime-fixture.wtplugin')
  await mkdir(path.dirname(sdkTarget), { recursive: true })
  await cp(path.join(repo, 'plugin-sdk', 'declarative-v1'), sdkTarget, {
    recursive: true,
    filter: source => path.basename(source).toLowerCase() !== 'node_modules',
  })
  await mkdir(sourceDirectory, { recursive: true })
  const source = `import { connectWebTools } from '@webtools/plugin-sdk/web';
const connection = connectWebTools();
const state = {
  publicKeys: Object.keys(connection).sort(),
  process: typeof process,
  require: typeof require,
  Buffer: typeof Buffer,
  ipcRenderer: typeof ipcRenderer,
  electron: typeof electron,
  desktop: typeof window.desktop,
  sdkReady: false,
  closeNotifications: 0,
  fixtureMarker: 'phase6e5e-validated-snapshot'
};
window.__phase6e5e = state;
connection.onClose(() => { state.closeNotifications++; });
connection.ready.then(() => { state.sdkReady = true; }, error => { state.sdkError = error && typeof error.code === 'string' ? error.code : 'UNKNOWN'; });
`
  assert.equal(source.includes('__webtoolsPluginBridge'), false)
  assert.equal(source.includes('.submit('), false)
  assert.equal(source.includes('.request('), false)
  const entry = path.join(sourceDirectory, 'app.mjs')
  await writeFile(entry, source, 'utf8')
  const modules = []
  const built = await build({
    configFile: false,
    root: sourceDirectory,
    logLevel: 'silent',
    plugins: [{
      name: 'phase6e5e-browser-sdk-boundary',
      resolveId(id) {
        if (id.startsWith('node:') || ['electron', 'yauzl'].includes(id)) throw new Error('The browser fixture attempted to import a Node/Electron dependency.')
      },
      generateBundle() { for (const id of this.getModuleIds()) modules.push(id) },
    }],
    build: { write: false, minify: false, lib: { entry, formats: ['es'], fileName: 'app' }, rollupOptions: { output: { inlineDynamicImports: true } } },
  })
  const output = (Array.isArray(built) ? built[0] : built).output.find(item => item.type === 'chunk')
  assert.ok(output && /^app\.m?js$/.test(output.fileName), `Vite must emit one browser bundle (received ${output?.fileName ?? 'none'}).`)
  const moduleIds = [...new Set(modules)].map(value => value.replaceAll('\\', '/'))
  for (const suffix of ['/web/index.mjs', '/web/bridge-client.mjs', '/web/protocol.mjs']) {
    assert.ok(moduleIds.some(value => value.includes(`/@webtools/plugin-sdk${suffix}`)), `The bundled browser graph must include the SDK public dependency ${suffix}.`)
  }
  const manifest = webManifest({
    id: 'org.webtools.phase6e4b.runtime-test',
    name: 'Phase 6E-5E Packaged Bridge Acceptance',
    description: 'Offline acceptance fixture using only the public Web SDK.',
    version: '1.0.0',
    features: [
      { id: 'offline-demo', title: 'Bridge SDK acceptance', entry: { kind: 'web-bundle', document: 'web/index.html' } },
      { id: 'offline-demo-wasm', title: 'Bridge SDK replacement', entry: { kind: 'web-bundle', document: 'web/other.html' } },
      { id: 'offline-demo-delayed', title: 'Reserved isolated test route', entry: { kind: 'web-bundle', document: 'web/delayed.html' } },
    ],
    webBundle: { files: [
      ...['index.html', 'other.html', 'delayed.html'].map(name => ({ path: `web/${name}`, mediaType: 'text/html' })),
      { path: 'web/app.js', mediaType: 'text/javascript' },
    ] },
  })
  const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="./app.js"></script></body></html>'
  const bytes = webPackage(manifest, [
    ...['index.html', 'other.html', 'delayed.html'].map(name => ({ name: `web/${name}`, data: html })),
    { name: 'web/app.js', data: output.code },
  ])
  const snapshot = await validateWebPackageForRuntime(bytes, hostVersion)
  assert.equal(snapshot.manifest.id, manifest.id)
  assert.equal(snapshot.manifest.manifestVersion, 2)
  assert.equal(snapshot.manifest.network.mode, 'none')
  assert.ok(snapshot.manifest.features.some(feature => feature.id === 'offline-demo'))
  await writeFile(fixturePath, bytes, { flag: 'wx' })
  const actualPackage = await readFile(fixturePath)
  const revalidated = await validateWebPackageForRuntime(actualPackage, hostVersion)
  assert.equal(revalidated.packageHash, snapshot.packageHash)
  return {
    fixturePath,
    bytes: actualPackage,
    snapshot: revalidated,
    bundleModules: moduleIds,
    bundleSha256: hash(Buffer.from(output.code)),
    sourceContainsPrivateBridgeApi: false,
  }
}

function targetFor(list, suffix) {
  return list.find(item => item.url?.startsWith('webtools-plugin://') && item.url.endsWith(suffix))
}

function managerTargetFor(list) {
  return list.find(item => {
    if (!item.url?.startsWith('file:')) return false
    let url
    try { url = decodeURIComponent(item.url).replaceAll('\\', '/').toLowerCase() } catch { return false }
    return url.includes('/resources/app.asar/out/renderer/index.html')
  })
}

function runtimeOrigin(target, label) {
  try { return new URL(target.url).host }
  catch { throw new Error(`DevTools returned an invalid ${label} runtime URL: ${JSON.stringify(target.url)}`) }
}

async function invokeBridge(remote, method) {
  const expression = `(async()=>JSON.stringify(await window.__webtoolsPluginBridge.submit(${JSON.stringify(method)},null).response))()`
  const result = await remote.evaluate(expression)
  const value = result?.result?.value
  if (typeof value !== 'string') throw new Error('The private acceptance call did not return a JSON outcome.')
  return JSON.parse(value)
}

const options = argumentsMap(process.argv.slice(2))
const acceptanceRoot = path.resolve(options.get('--acceptance-root'))
const managerExe = path.resolve(options.get('--manager-exe'))
assertInsideTemp(acceptanceRoot, 'Acceptance root')
assertInsideTemp(managerExe, 'Packaged Manager executable')
if (!inside(acceptanceRoot, managerExe)) throw new Error('The packaged Manager executable must be inside the disposable acceptance root.')
const canonicalRoot = await realpath(acceptanceRoot)
const canonicalManager = await realpath(managerExe)
if (!inside(canonicalRoot, canonicalManager)) throw new Error('The packaged Manager resolves outside the disposable acceptance root.')
await assertNoReparsePoints(tmpdir(), canonicalRoot)
await assertNoReparsePoints(canonicalRoot, canonicalManager)
const packagedRoot = path.dirname(canonicalManager)
const appAsarPath = path.join(packagedRoot, 'resources', 'app.asar')
const asarHeader = asar.getRawHeader(appAsarPath)
const appArchive = { ...asarHeader, bytes: await readFile(appAsarPath) }
const profilePath = path.join(canonicalRoot, 'isolated-user-data')
const evidenceDirectory = path.join(canonicalRoot, 'evidence')
const userProfile = process.env.APPDATA ? path.join(process.env.APPDATA, 'Nook') : path.join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming', 'Nook')
const productionInstall = 'D:\\webtools'
if (overlaps(canonicalRoot, userProfile) || overlaps(canonicalRoot, productionInstall)) throw new Error('Acceptance root overlaps a protected production location.')
if (normalizedPath(canonicalManager) === normalizedPath(path.join(productionInstall, 'Manager', 'WebTools.exe'))) throw new Error('Production Manager executable is forbidden for acceptance.')
const profileExists = await lstat(profilePath).then(() => true, () => false)
if (profileExists) throw new Error('Acceptance profile already exists; use a fresh unique TEMP acceptance root.')
await mkdir(profilePath, { recursive: true })
await mkdir(evidenceDirectory, { recursive: true })
const packageJson = JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8'))
const appData = JSON.parse(appAsarEntry(appArchive, 'package.json').toString('utf8'))
assert.equal(appData.version, packageJson.version)
const mainBytes = appAsarEntry(appArchive, 'out/main/index.js')
const pluginPreloadBytes = appAsarEntry(appArchive, 'out/preload/web-plugin.js')
const rendererBytes = appAsarEntry(appArchive, 'out/renderer/index.html')
assert.ok(mainBytes.length > 0 && pluginPreloadBytes.length > 0 && rendererBytes.length > 0)
assert.equal(hash(mainBytes), hash(await readFile(path.join(repo, 'out', 'main', 'index.js'))), 'Packaged Main must match the current compiled Main output.')
assert.equal(hash(pluginPreloadBytes), hash(await readFile(path.join(repo, 'out', 'preload', 'web-plugin.js'))), 'Packaged Plugin preload must match the current compiled dedicated preload.')
const electronVersion = require('electron/package.json').version
const hostVersion = packageJson.version
const fixture = await buildFixture(canonicalRoot, hostVersion)
const port = await freePort()
const base = `http://127.0.0.1:${port}`
const environment = { ...process.env }
for (const key of Object.keys(environment)) {
  if (key.startsWith('WEBTOOLS_') || key === 'ELECTRON_RUN_AS_NODE' || key === 'ELECTRON_NO_ASAR' || key === 'NODE_OPTIONS') delete environment[key]
}
Object.assign(environment, {
  WEBTOOLS_WEB_RUNTIME_ACCEPTANCE: '1',
  WEBTOOLS_WEB_RUNTIME_TEST_PROFILE: profilePath,
  WEBTOOLS_WEB_RUNTIME_TEST_PACKAGE: fixture.fixturePath,
  WEBTOOLS_WEB_RUNTIME_TEST_DEBUG_PORT: String(port),
  WEBTOOLS_WEB_RUNTIME_TEST_SWITCH: '1',
  WEBTOOLS_WEB_RUNTIME_TEST_SWITCH_SIGNAL: '1',
  WEBTOOLS_WEB_RUNTIME_TEST_HOLD_PING: '1',
})
const preExistingProfileProcesses = processSnapshot().filter(item => {
  const executablePath = String(item.ExecutablePath ?? '')
  return String(item.CommandLine ?? '').toLowerCase().includes(profilePath.toLowerCase())
    && (pathEquals(executablePath, canonicalManager) || inside(packagedRoot, executablePath))
})
assert.equal(preExistingProfileProcesses.length, 0, 'A unique profile must have no pre-existing packaged Manager process before launch.')
const child = spawn(canonicalManager, [`--user-data-dir=${profilePath}`, '--phase6e4b-web-runtime-acceptance'], {
  cwd: packagedRoot,
  env: environment,
  windowsHide: true,
  shell: false,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let processOutput = ''
const appendOutput = chunk => { processOutput = (processOutput + chunk.toString('utf8')).slice(-2 * 1024 * 1024) }
child.stdout.on('data', appendOutput)
child.stderr.on('data', appendOutput)
let exitInfo = null
child.once('exit', (code, signal) => { exitInfo = { code, signal } })
const group = createProcessGroupTracker(canonicalManager, packagedRoot, profilePath, child.pid)
let managerTarget
let currentPluginTarget
let managerRemote
let pluginRemote
let completed = false
const startedAtUtc = new Date().toISOString()
const results = {}

async function jsonTargets() { return devtoolsJson(base) }
async function closeExactTarget(target) {
  if (!target?.id) return
  await fetch(`${base}/json/close/${encodeURIComponent(target.id)}`, { signal: AbortSignal.timeout(2_000) }).catch(() => undefined)
}

try {
  await waitFor(async () => {
    group.capture()
    return jsonTargets()
  }, targets => Array.isArray(targets) && Boolean(managerTargetFor(targets)), 'packaged Manager app.asar target and DevTools endpoint')
  let targets = await jsonTargets()
  managerTarget = managerTargetFor(targets)
  assert.ok(managerTarget, 'Manager renderer must load from resources/app.asar, not the repository output tree.')
  managerRemote = await cdp(managerTarget.webSocketDebuggerUrl)
  const processRoot = await waitFor(() => group.capture(), processes => processes.some(item => Number(item.ProcessId) === child.pid), 'exact packaged Main PID/profile identity')
  const mainIdentity = processRoot.find(item => Number(item.ProcessId) === child.pid)
  assert.ok(mainIdentity && pathEquals(mainIdentity.ExecutablePath, canonicalManager))
  assert.ok(String(mainIdentity.CommandLine).toLowerCase().includes(profilePath.toLowerCase()))
  results.coldStart = { mainPid: child.pid, packagedManagerTarget: managerTarget.url, appAsarRenderer: true, exactExecutableAndProfile: true }

  const runtimeATargets = await waitFor(jsonTargets, list => Boolean(targetFor(list, '/web/index.html')), 'initial production Plugin runtime A')
  const runtimeA = targetFor(runtimeATargets, '/web/index.html')
  assert.ok(runtimeA)
  const originA = runtimeOrigin(runtimeA, 'initial')
  assert.match(originA, /^[a-f0-9]{32}$/)
  currentPluginTarget = runtimeA
  pluginRemote = await cdp(runtimeA.webSocketDebuggerUrl)
  const markerA = await waitFor(async () => {
    const response = await pluginRemote.evaluate('JSON.stringify(window.__phase6e5e ?? null)')
    const value = response?.result?.value
    return typeof value === 'string' ? JSON.parse(value) : null
  }, value => value?.sdkReady === true, 'public Web SDK READY on runtime A')
  assert.deepEqual(markerA.publicKeys, ['onClose', 'ready'])
  assert.deepEqual({ process: markerA.process, require: markerA.require, Buffer: markerA.Buffer, ipcRenderer: markerA.ipcRenderer, electron: markerA.electron, desktop: markerA.desktop }, {
    process: 'undefined', require: 'undefined', Buffer: 'undefined', ipcRenderer: 'undefined', electron: 'undefined', desktop: 'undefined',
  })
  const facadeResponse = await pluginRemote.evaluate('JSON.stringify({type:typeof globalThis.__webtoolsPluginBridge, keys:Object.keys(globalThis.__webtoolsPluginBridge ?? {}).sort()})')
  const facade = JSON.parse(facadeResponse.result.value)
  assert.deepEqual(facade, { type: 'object', keys: ['dispose', 'getReady', 'onClose', 'submit'] })

  const firstPing = await invokeBridge(pluginRemote, 'bridge.ping')
  assert.deepEqual(firstPing, { ok: true, result: null })
  const unknown = await invokeBridge(pluginRemote, 'phase6e5e.unknown')
  assert.deepEqual(Object.keys(unknown).sort(), ['error', 'ok'])
  assert.deepEqual(Object.keys(unknown.error).sort(), ['code', 'retryable'])
  assert.deepEqual(unknown, { ok: false, error: { code: 'NOT_AVAILABLE', retryable: false } })
  assert.equal(JSON.stringify(unknown).match(/stack|path|exception|message/i), null)
  const afterUnknownPing = await invokeBridge(pluginRemote, 'bridge.ping')
  assert.deepEqual(afterUnknownPing, { ok: true, result: null })
  results.safeFailure = { outcome: unknown, rawDetailsAbsent: true, subsequentPing: afterUnknownPing }

  const heldSubmit = await pluginRemote.evaluate(`(() => {
    const handle = globalThis.__webtoolsPluginBridge.submit('bridge.ping', null)
    const state = { settlements: 0, terminal: null }
    handle.response.then(value => { state.settlements++; state.terminal = value })
    window.__phase6e5eCancellation = state
    window.__phase6e5eHeldPing = handle
    return 'submitted'
  })()`)
  assert.equal(heldSubmit.result.value, 'submitted')
  await waitFor(() => processOutput, value => value.includes('held-ping=started'), 'Host-accepted held bridge.ping')
  await pluginRemote.evaluate("window.__phase6e5eHeldPing.cancel(); 'cancel-requested'")
  await waitFor(() => processOutput, value => value.includes('held-ping=abort-observed'), 'Host cancellation abort observed')
  await waitFor(() => processOutput, value => value.includes('held-ping=terminal-sent'), 'single Host cancellation response sent')
  const cancellation = await waitFor(async () => {
    const response = await pluginRemote.evaluate('JSON.stringify(window.__phase6e5eCancellation)')
    return JSON.parse(response.result.value)
  }, value => value.settlements === 1, 'single renderer terminal settlement')
  assert.deepEqual(cancellation.terminal, { ok: false, error: { code: 'CANCELLED', retryable: false } })
  const afterCancelPing = await invokeBridge(pluginRemote, 'bridge.ping')
  assert.deepEqual(afterCancelPing, { ok: true, result: null })
  const cancellationStable = await pluginRemote.evaluate('window.__phase6e5eCancellation.settlements')
  assert.equal(cancellationStable.result.value, 1)
  results.cancellation = { hostAcceptedStarted: true, abortObserved: true, terminalOutcome: cancellation.terminal, settlementCount: 1, subsequentPing: afterCancelPing }

  await writeFile(path.join(profilePath, 'phase6e5e-switch-requested'), 'phase6e5e:switch\n', { flag: 'wx' })
  const generationSwitch = await waitFor(() => processOutput, value => /switched Feature ready generation=\d+->\d+/.test(value), 'production runtime replacement')
  const switchMatch = /switched Feature ready generation=(\d+)->(\d+)/.exec(generationSwitch)
  assert.ok(switchMatch)
  const runtimeBTargets = await waitFor(jsonTargets, list => Boolean(targetFor(list, '/web/other.html')), 'replacement production Plugin runtime B')
  const runtimeB = targetFor(runtimeBTargets, '/web/other.html')
  assert.ok(runtimeB)
  currentPluginTarget = runtimeB
  const originB = runtimeOrigin(runtimeB, 'replacement')
  assert.match(originB, /^[a-f0-9]{32}$/)
  assert.notEqual(originB, originA, 'Replacement must have a fresh random runtime origin.')
  const aTargetDestroyed = await waitFor(jsonTargets, list => !list.some(item => item.id === runtimeA.id), 'runtime A WebContentsView destruction')
  targets = aTargetDestroyed
  const replacementManagerTarget = managerTargetFor(targets)
  assert.ok(replacementManagerTarget, 'Manager must remain alive after runtime replacement.')
  assert.equal(replacementManagerTarget.id, managerTarget.id, 'Replacement must reuse the same Manager renderer.')
  const listenerRecords = [...generationSwitch.matchAll(/bridge-listeners=(\d+) action=(attach|detach) generation=(\d+)/g)]
  const expectedLifecycle = [['1', 'attach'], ['0', 'detach'], ['1', 'attach']]
  assert.deepEqual(listenerRecords.slice(0, 3).map(match => [match[1], match[2]]), expectedLifecycle)
  assert.ok(Number(switchMatch[2]) > Number(switchMatch[1]))
  pluginRemote.close()
  pluginRemote = await cdp(runtimeB.webSocketDebuggerUrl)
  const marker = await waitFor(async () => {
    const response = await pluginRemote.evaluate('JSON.stringify(window.__phase6e5e ?? null)')
    const value = response?.result?.value
    return typeof value === 'string' ? JSON.parse(value) : null
  }, value => value?.sdkReady === true, 'public Web SDK READY on runtime B')
  assert.deepEqual(marker.publicKeys, ['onClose', 'ready'])
  assert.deepEqual({ process: marker.process, require: marker.require, Buffer: marker.Buffer, ipcRenderer: marker.ipcRenderer, electron: marker.electron, desktop: marker.desktop }, {
    process: 'undefined', require: 'undefined', Buffer: 'undefined', ipcRenderer: 'undefined', electron: 'undefined', desktop: 'undefined',
  })
  const staleState = await pluginRemote.evaluate('JSON.stringify({hasCancellation:Object.hasOwn(window,"__phase6e5eCancellation"),hasHeldPing:Object.hasOwn(window,"__phase6e5eHeldPing")})')
  assert.deepEqual(JSON.parse(staleState.result.value), { hasCancellation: false, hasHeldPing: false })
  const replacementPing = await invokeBridge(pluginRemote, 'bridge.ping')
  assert.deepEqual(replacementPing, { ok: true, result: null })
  results.securitySurface = { ...marker, privateFacade: facade, publicRequestExposed: Object.hasOwn(marker, 'request') }
  assert.equal(results.securitySurface.publicRequestExposed, false)
  results.replacement = {
    runtimeAOrigin: originA,
    runtimeBOrigin: originB,
    runtimeAGeneration: Number(switchMatch[1]),
    runtimeBGeneration: Number(switchMatch[2]),
    runtimeAPing: firstPing,
    runtimeBPing: replacementPing,
    oldTargetDestroyedBeforeBUse: true,
    stalePendingStateInherited: false,
    bridgeListenerLifecycle: listenerRecords.slice(0, 3).map(match => ({ count: Number(match[1]), action: match[2], generation: Number(match[3]) })),
    managerRendererReused: true,
  }

  const packagedRoot = path.dirname(canonicalManager)
  const trackerBeforeClose = group.capture()
  assert.ok(trackerBeforeClose.some(item => Number(item.ProcessId) === child.pid))
  await closeExactTarget(runtimeB)
  await waitFor(jsonTargets, list => !list.some(item => item.id === runtimeB.id), 'runtime B WebContentsView destruction')
  await waitFor(() => processOutput, value => /bridge-listeners=0 action=detach generation=\d+/.test(value), 'Plugin listener removed before Manager close')
  targets = await jsonTargets()
  managerTarget = managerTargetFor(targets)
  assert.ok(managerTarget, 'Manager must remain alive after Plugin runtime close.')
  pluginRemote.close(); pluginRemote = undefined
  await closeExactTarget(managerTarget)
  managerTarget = undefined
  await waitFor(() => {
    group.capture()
    return group.remaining()
  }, processes => processes.length === 0, 'exact packaged Electron process group exit', 20_000)
  await waitFor(() => exitInfo, value => value !== null, 'packaged Manager Main process exit', 5_000)
  assert.equal(exitInfo.code, 0)
  results.processCleanup = {
    spawnedMainPid: child.pid,
    exactExecutable: canonicalManager,
    isolatedProfile: profilePath,
    observedProcessIdentities: [...group.identities.entries()].map(([pid, identity]) => ({ pid, ...identity })),
    managerExitCode: exitInfo.code,
    remainingPackagedProcessCount: group.remaining().length,
    nativeHostStarted: false,
  }
  assert.equal(results.processCleanup.remainingPackagedProcessCount, 0)
  completed = true

  const evidence = {
    schema: 'webtools.phase6e5e.packaged-bridge-acceptance.v1',
    result: 'PASS',
    classification: ['PACKAGED', 'END-TO-END', 'BOUNDED', 'REPRESENTATIVE', 'DETERMINISTIC'],
    startedAtUtc,
    source: { repository: repo, packageVersion: packageJson.version },
    runtime: { node: process.versions.node, electron: electronVersion, appAsarVersion: appData.version },
    artifacts: {
      managerExe: canonicalManager,
      appAsarPath,
      appAsarSha256: hash(await readFile(appAsarPath)),
      managerExeSha256: hash(await readFile(canonicalManager)),
      compiledMainSha256: hash(mainBytes),
      dedicatedPluginPreloadPath: 'resources/app.asar/out/preload/web-plugin.js',
      dedicatedPluginPreloadSha256: hash(pluginPreloadBytes),
      packagedRendererPath: 'resources/app.asar/out/renderer/index.html',
    },
    isolation: { acceptanceRoot: canonicalRoot, profilePath, productionInstallTouched: false, productionProfileTouched: false, networkRequestsMade: 0 },
    fixture: {
      pluginId: fixture.snapshot.manifest.id,
      featureIds: fixture.snapshot.manifest.features.map(item => item.id),
      manifestVersion: fixture.snapshot.manifest.manifestVersion,
      entryPath: 'web/index.html',
      packagePath: fixture.fixturePath,
      packageSha256: hash(fixture.bytes),
      validatedSnapshotHash: fixture.snapshot.packageHash,
      networkMode: fixture.snapshot.manifest.network.mode,
      sdkBundleSha256: fixture.bundleSha256,
      sdkModules: fixture.bundleModules,
      pluginSourceUsesOnlyPublicSdk: !fixture.sourceContainsPrivateBridgeApi,
    },
    scenarios: results,
    processAccounting: results.processCleanup,
    limitations: ['Not exhaustive security certification.', 'Gate 4 is not certified.', 'Normal persisted Manifest v2 install acceptance is not included.', 'No Marketplace, performance, or long-running acceptance was performed.'],
  }
  const evidencePath = path.join(evidenceDirectory, 'phase6e5e-packaged-bridge-evidence.json')
  const logPath = path.join(evidenceDirectory, 'packaged-manager.log')
  await writeFile(logPath, processOutput, 'utf8')
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ result: 'PHASE6E5E_PACKAGED_ACCEPTANCE_PASS', evidencePath, evidenceSha256: hash(await readFile(evidencePath)), logPath, logSha256: hash(await readFile(logPath)), acceptanceRoot: canonicalRoot, processCount: 0 }, null, 2))
} catch (error) {
  console.error(error instanceof Error ? error.stack : 'Packaged acceptance failed.')
  process.exitCode = 1
} finally {
  pluginRemote?.close()
  managerRemote?.close()
  if (!completed) {
    try { group.capture() } catch { console.error('Read-only process identity capture failed during isolated Manager cleanup.') }
    await closeExactTarget(currentPluginTarget)
    await closeExactTarget(managerTarget)
    try {
      await waitFor(() => { group.capture(); return group.remaining() }, processes => processes.length === 0, 'graceful cleanup of the exact isolated Manager process group', 15_000)
    } catch {
      console.error(`The exact isolated packaged process group did not exit; no process was killed. Acceptance evidence is retained under ${canonicalRoot}.`)
    }
  }
  await mkdir(evidenceDirectory, { recursive: true }).catch(() => undefined)
  await writeFile(path.join(evidenceDirectory, 'packaged-manager.log'), processOutput, 'utf8').catch(() => undefined)
}
