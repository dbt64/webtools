// Bounded real-Electron implementation acceptance; no installer or production profile.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { cp, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { webManifest, webPackage } from '../electron/plugins/fixtures.mjs'
import { validateWebPackageForRuntime } from '../electron/plugins/package-validator.ts'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temp = await mkdtemp(join(tmpdir(), 'WebTools-6E5C-Bridge '))
const electron = createRequire(import.meta.url)('electron')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const slash = path => path.replaceAll('\\', '/')
const profiles = []
const bundleModules = []

async function waitFor(read, predicate, label, timeout = 20000) {
  const until = Date.now() + timeout
  let last
  while (Date.now() < until) {
    try { last = await read(); if (predicate(last)) return last } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  }
  throw new Error(`Bounded wait failed: ${label}; ${JSON.stringify(last)}`)
}
async function freePort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const port = server.address().port; await new Promise(done => server.close(done)); return port
}
const json = url => fetch(url, { signal: AbortSignal.timeout(1500) }).then(response => response.json())
async function cdp(url) {
  const socket = new WebSocket(url); const pending = new Map(); let id = 0
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data)); const item = pending.get(message.id)
    if (!item) return
    pending.delete(message.id); clearTimeout(item.timer)
    if (message.error) item.reject(new Error('DevTools command failed')); else item.resolve(message.result)
  })
  await new Promise((resolveOpen, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('DevTools connection timeout')) }, 5000)
    socket.addEventListener('open', () => { clearTimeout(timer); resolveOpen() }, { once: true })
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('DevTools connection failed')) }, { once: true })
  })
  return {
    evaluate: expression => new Promise((resolveCall, reject) => {
      const requestId = ++id
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('DevTools evaluation timeout')) }, 5000)
      pending.set(requestId, { resolve: resolveCall, reject, timer })
      socket.send(JSON.stringify({ id: requestId, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
    }),
    close: () => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('DevTools closed')) }; pending.clear(); socket.close() },
  }
}
function processes(profile) {
  // Read only; no termination by process name or installation path.
  const result = spawnSync('powershell', ['-NoProfile', '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress"], { windowsHide: true, encoding: 'utf8' })
  assert.equal(result.status, 0)
  const parsed = JSON.parse(result.stdout.trim() || '[]')
  return (Array.isArray(parsed) ? parsed : [parsed]).filter(item => item.ExecutablePath?.toLowerCase() === electron.toLowerCase() && item.CommandLine?.includes(profile))
}

const entry = join(temp, 'entry.mjs')
const isolatedSdk = join(temp, 'node_modules/@webtools/plugin-sdk')
await mkdir(dirname(isolatedSdk), { recursive: true })
await cp(join(repo, 'plugin-sdk/declarative-v1'), isolatedSdk, { recursive: true, filter: path => basename(path) !== 'node_modules' })
await writeFile(entry, `import { connectWebTools } from '@webtools/plugin-sdk/web';
import { createBridgeConnection } from ${JSON.stringify(slash(join(isolatedSdk, 'web/bridge-client.mjs')))};
const publicClient = connectWebTools();
const internal = createBridgeConnection(globalThis.__webtoolsPluginBridge);
async function run() {
  await publicClient.ready;
  const report = { publicKeys: Object.keys(publicClient).sort(), process: typeof process, require: typeof require, Buffer: typeof Buffer, ipcRenderer: typeof ipcRenderer, electron: typeof electron, desktop: typeof window.desktop, facadeKeys: Object.keys(globalThis.__webtoolsPluginBridge).sort(), ping: await internal.request('bridge.ping', null) };
  try { await internal.request('unknown.call', null); report.unknown = 'unexpected'; } catch (error) { report.unknown = error.code; report.retryable = error.retryable; }
  try { await internal.request('bad-method', null); } catch (error) { report.malformed = error.code; }
  const before = new AbortController(); before.abort();
  try { await internal.request('bridge.ping', null, { signal: before.signal }); } catch (error) { report.before = error.code; }
  const handle = globalThis.__webtoolsPluginBridge.submit('bridge.ping', null);
  handle.cancel();
  report.opaqueCancel = (await handle.response).error.code;
  report.afterCancelPing = await internal.request('bridge.ping', null);
  report.facadeFrozen = Object.isFrozen(globalThis.__webtoolsPluginBridge);
  report.host = location.host;
  return report;
}
run().then(report => { window.__bridgeResult = report }, error => { window.__bridgeResult = { failed: error.code || error.name } });
`)
const bundle = await build({ configFile: false, logLevel: 'silent', plugins: [{ name: 'node-free-bridge-fixture',
  resolveId(id) { if (id.startsWith('node:') || ['electron', 'yauzl'].includes(id)) throw new Error('Browser SDK imported forbidden dependency') },
  generateBundle() { for (const id of this.getModuleIds()) bundleModules.push(id) },
}], build: { write: false, minify: false, lib: { entry, formats: ['es'], fileName: 'app' }, rollupOptions: { output: { inlineDynamicImports: true } } } })
const bundleCode = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(item => item.type === 'chunk').code
const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="./app.js"></script></body></html>'
const manifest = webManifest({ id: 'org.webtools.phase6e4b.runtime-test', version: '1.0.0', features: [
  { id: 'offline-demo', title: 'Bridge', entry: { kind: 'web-bundle', document: 'web/index.html' } },
  { id: 'offline-demo-wasm', title: 'Bridge replacement', entry: { kind: 'web-bundle', document: 'web/other.html' } },
  { id: 'offline-demo-delayed', title: 'Unused fixed fixture identity', entry: { kind: 'web-bundle', document: 'web/delayed.html' } },
], webBundle: { files: ['index.html', 'other.html', 'delayed.html'].map(name => ({ path: `web/${name}`, mediaType: 'text/html' })).concat({ path: 'web/app.js', mediaType: 'text/javascript' }) } })
const bytes = webPackage(manifest, ['index.html', 'other.html', 'delayed.html'].map(name => ({ name: `web/${name}`, data: html })).concat({ name: 'web/app.js', data: bundleCode }))
const snapshot = await validateWebPackageForRuntime(bytes, '0.1.0')
assert.equal(snapshot.manifest.network.mode, 'none')
const fixture = join(temp, 'phase6e4b-runtime-fixture.wtplugin'); await writeFile(fixture, bytes)

async function run(replacement) {
  const profile = join(temp, replacement ? 'replacement-profile' : 'initial-profile'); await mkdir(profile); profiles.push(profile)
  const port = await freePort(); const base = `http://127.0.0.1:${port}`
  const env = { ...process.env, WEBTOOLS_WEB_RUNTIME_ACCEPTANCE: '1', WEBTOOLS_WEB_RUNTIME_TEST_PROFILE: profile, WEBTOOLS_WEB_RUNTIME_TEST_PACKAGE: fixture,
    WEBTOOLS_WEB_RUNTIME_TEST_DEBUG_PORT: String(port), WEBTOOLS_WEB_RUNTIME_TEST_SWITCH: replacement ? '1' : '0' }
  for (const key of Object.keys(env)) if (key === 'ELECTRON_RUN_AS_NODE' || key === 'WEBTOOLS_MANAGER_ONLY' || key === 'WEBTOOLS_NATIVE_PIPE' || key.startsWith('WEBTOOLS_MANAGER_TEST') || key === 'WEBTOOLS_WEB_RUNTIME_TEST_SCENARIO') delete env[key]
  assert.equal(processes(profile).length, 0)
  const startedAt = Date.now()
  const child = spawn(electron, [repo, `--user-data-dir=${profile}`, '--phase6e4b-web-runtime-acceptance'], { cwd: repo, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''; const record = chunk => { output = (output + chunk).slice(-1024 * 1024) }
  child.stdout.on('data', record); child.stderr.on('data', record)
  const exit = once(child, 'exit')
  let manager; let remote
  try {
    await waitFor(() => json(`${base}/json/list`), list => Array.isArray(list), 'isolated Electron endpoint')
    const identities = processes(profile)
    assert.ok(identities.some(item => item.ProcessId === child.pid), 'spawned Main must have the exact executable/profile identity')
    manager = await waitFor(() => json(`${base}/json/list`), list => list.find(item => item.url.startsWith('file:') && decodeURIComponent(item.url).replaceAll('/', '\\').includes('out\\renderer\\index.html')), 'built Manager')
    manager = manager.find(item => item.url.startsWith('file:'))
    const plugin = await waitFor(() => json(`${base}/json/list`), list => list.find(item => item.url.startsWith('webtools-plugin://') && item.url.endsWith(replacement ? '/web/other.html' : '/web/index.html')), 'production WebContentsView')
    const target = plugin.find(item => item.url.startsWith('webtools-plugin://') && item.url.endsWith(replacement ? '/web/other.html' : '/web/index.html'))
    remote = await cdp(target.webSocketDebuggerUrl)
    const report = await waitFor(async () => (await remote.evaluate('window.__bridgeResult')).result?.value, value => Boolean(value), 'real SDK Bridge result')
    assert.deepEqual(report.publicKeys, ['onClose', 'ready'])
    assert.deepEqual(report.facadeKeys, ['dispose', 'getReady', 'onClose', 'submit'])
    for (const key of ['process', 'require', 'Buffer', 'ipcRenderer', 'electron', 'desktop']) assert.equal(report[key], 'undefined', key)
    assert.equal(report.ping, null); assert.equal(report.afterCancelPing, null)
    assert.equal(report.unknown, 'NOT_AVAILABLE'); assert.equal(report.retryable, false)
    assert.equal(report.malformed, 'INVALID_REQUEST'); assert.equal(report.before, 'CANCELLED'); assert.equal(report.opaqueCancel, 'CANCELLED')
    assert.equal(report.facadeFrozen, true)
    if (replacement) {
      const generations = /switched Feature ready generation=(\d+)->(\d+)/.exec(output)
      assert.ok(generations && Number(generations[2]) > Number(generations[1]), 'replacement has a fresh Main generation')
    }
    const closed = await fetch(`${base}/json/close/${target.id}`, { signal: AbortSignal.timeout(2000) }); assert.equal(closed.ok, true)
    await waitFor(() => json(`${base}/json/list`), list => !list.some(item => item.id === target.id), 'exact Plugin view close')
    assert.ok((await json(`${base}/json/list`)).some(item => item.id === manager.id), 'Manager stays alive after Plugin close')
    return { replacement, mainPid: child.pid, startedAt, report, actualPluginClose: 'PASS' }
  } finally {
    remote?.close()
    if (manager) await fetch(`${base}/json/close/${manager.id}`, { signal: AbortSignal.timeout(2000) }).catch(() => {})
    let exitTimer
    try { await Promise.race([exit, new Promise((_, reject) => { exitTimer = setTimeout(() => reject(new Error('Isolated Electron did not exit; no process was killed')), 15000) })]) }
    finally { clearTimeout(exitTimer) }
    await waitFor(() => processes(profile).length, count => count === 0, 'exact isolated process group exit')
    await writeFile(join(temp, replacement ? 'replacement.log' : 'initial.log'), output)
  }
}

try {
  const runs = [await run(false), await run(true)]
  const electronVersion = createRequire(import.meta.url)('electron/package.json').version
  assert.equal(electronVersion, '44.4.5')
  const evidence = { phase: '6E-5C', result: 'PASS', electronVersion, runtime: 'actual built Main + production WebPluginRuntime/WebContentsView/Session/protocol/Plugin preload; unpackaged focused acceptance',
    build: { mainSha256: sha(await readFile(join(repo, 'out/main/index.js'))), pluginPreloadSha256: sha(await readFile(join(repo, 'out/preload/web-plugin.js'))) },
    fixtureSha256: sha(bytes), validatedSnapshotHash: snapshot.packageHash, bundleModules, runs,
    remainingIsolatedProcesses: profiles.reduce((count, profile) => count + processes(profile).length, 0), productionInstallTouched: false, productionProfileTouched: false }
  const path = join(temp, 'bridge-evidence.json'); await writeFile(path, JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify({ result: 'ELECTRON_44_CONTEXT_BRIDGE_PASS', evidencePath: path, evidenceSha256: sha(await readFile(path)), remainingIsolatedProcesses: evidence.remainingIsolatedProcesses }, null, 2))
} catch (error) { console.error(error.stack); console.error(`Isolated evidence retained: ${temp}`); process.exitCode = 1 }
