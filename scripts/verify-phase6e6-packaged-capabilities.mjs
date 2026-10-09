// One bounded isolated packaged acceptance. Never installs over production or touches the real clipboard.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, realpath, lstat, rename } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { webManifest, webPackage } from '../electron/plugins/fixtures.mjs'
import { validateWebPackageForRuntime } from '../electron/plugins/package-validator.ts'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
assert.equal(args.length, 4); assert.equal(args[0], '--manager-exe'); assert.equal(args[2], '--acceptance-root')
const managerExe = await realpath(path.resolve(args[1])); const root = await realpath(path.resolve(args[3]))
const normalize = value => path.win32.resolve(value).toLowerCase()
const inside = (parent, child) => { const rel = path.win32.relative(normalize(parent), normalize(child)); return !rel || rel !== '..' && !rel.startsWith('..\\') && !path.win32.isAbsolute(rel) }
async function safeTemp(candidate) {
  assert.ok(inside(tmpdir(), candidate) && normalize(candidate) !== normalize(tmpdir()), 'Acceptance paths must be strict TEMP descendants')
  let current = path.resolve(tmpdir())
  for (const part of path.relative(current, candidate).split(path.sep)) { current = path.join(current, part); assert.equal((await lstat(current)).isSymbolicLink(), false) }
}
await safeTemp(root); await safeTemp(managerExe)
assert.ok(inside(root, managerExe), 'Packaged Manager must be inside this acceptance root')
const packagedRoot = path.dirname(managerExe); const asarPath = path.join(packagedRoot, 'resources', 'app.asar')
const require = createRequire(import.meta.url); const builderRequire = createRequire(require.resolve('electron-builder'))
const asar = builderRequire('@electron/asar')
const manifest = JSON.parse(asar.extractFile(asarPath, 'package.json').toString())
for (const file of ['out/main/index.js', 'out/preload/index.js', 'out/preload/web-plugin.js', 'out/renderer/index.html']) assert.ok(asar.extractFile(asarPath, file.replaceAll('/', path.sep)).length)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const pause = ms => new Promise(done => setTimeout(done, ms))
async function wait(read, predicate, label, duration = 20000) {
  const end = Date.now() + duration; let last
  while (Date.now() < end) { try { last = await read(); if (predicate(last)) return last } catch {} await pause(100) }
  throw new Error(`Acceptance wait failed: ${label}`)
}
const psQuote = text => `'${String(text).replaceAll("'", "''")}'`
function pnpm(args, cwd) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `& pnpm ${args.map(psQuote).join(' ')}; exit $LASTEXITCODE`], { cwd, windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return result.stdout
}
function processes() {
  const query = `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith(${psQuote(packagedRoot + path.sep)}, [System.StringComparison]::OrdinalIgnoreCase) } | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress`
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], { windowsHide: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  assert.equal(result.status, 0); const parsed = JSON.parse(result.stdout || '[]'); return Array.isArray(parsed) ? parsed : [parsed]
}
const owned = () => processes().filter(p => p.ExecutablePath && inside(packagedRoot, p.ExecutablePath))
assert.equal(owned().length, 0, 'No pre-existing process may use this unique packaged directory')
async function port() {
  const { createServer } = await import('node:net'); const server = createServer(); server.listen(0, '127.0.0.1')
  await new Promise((done, fail) => { server.once('listening', done); server.once('error', fail) }); const number = server.address().port
  await new Promise(done => server.close(done)); return number
}
async function remote(url) {
  const socket = new WebSocket(url); let sequence = 0; const pending = new Map()
  await new Promise((done, fail) => { const timer = setTimeout(() => fail(new Error('CDP handshake timeout')), 5000)
    socket.addEventListener('open', () => { clearTimeout(timer); done() }, { once: true }); socket.addEventListener('error', fail, { once: true }) })
  socket.addEventListener('message', event => { const value = JSON.parse(String(event.data)); const entry = pending.get(value.id); if (!entry) return
    pending.delete(value.id); clearTimeout(entry.timer); value.error || value.result?.exceptionDetails ? entry.reject(new Error('CDP evaluation failed')) : entry.resolve(value.result) })
  socket.addEventListener('close', () => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('CDP closed')) } pending.clear() })
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP deadline')) }, 10000)
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })) })
  return { send, evaluate: async expression => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value, close: () => socket.close() }
}

const sdkDir = path.join(root, 'sdk'); const author = path.join(root, 'external-author'); const bundle = path.join(author, 'bundle')
await mkdir(sdkDir, { recursive: true }); await mkdir(author, { recursive: true })
pnpm(['pack', '--pack-destination', sdkDir], path.join(repo, 'plugin-sdk', 'declarative-v1'))
const sdkVersion = JSON.parse(await readFile(path.join(repo, 'plugin-sdk', 'declarative-v1', 'package.json'))).version
const sdkTarball = path.join(sdkDir, `webtools-plugin-sdk-${sdkVersion}.tgz`)
await writeFile(path.join(author, 'package.json'), JSON.stringify({ name: 'phase6e6-isolated-author', private: true, type: 'module', packageManager: manifest.packageManager,
  dependencies: { '@webtools/plugin-sdk': `file:${sdkTarball.replaceAll('\\', '/')}` } }))
pnpm(['install', '--ignore-scripts'], author)
const pluginCode = `import { connectWebTools } from '@webtools/plugin-sdk/web';
const api = connectWebTools(); let controller;
const state = { ready: false, namespaces: Object.keys(api).sort(), results: {}, busy: false };
async function run(action) { state.busy=true; try { let result;
 if(action==='context') result=await api.context.current();
 else if(action==='storage') { await api.storage.set('note',{isolated:true}); result=await api.storage.get('note'); await api.storage.delete('note'); await api.storage.set('persist',{retained:true}); }
 else if(action==='ai') { controller=new AbortController(); result=await api.ai.complete({prompt:'Phase6E6 isolated prompt'},{signal:controller.signal}); }
 else if(action==='clipboard') result=await api.clipboard.writeText('Phase6E6 isolated clipboard text');
 else if(action==='forged') { const call=globalThis.__webtoolsPluginBridge.submit('context.current',{pluginId:'forged'}); const response=await call.response; if(!response.ok) throw Object.assign(new Error('denied'),{code:response.error.code}); result=response.result; }
 else if(action==='missing-capability') { const call=globalThis.__webtoolsPluginBridge.submit('storage.set',{key:'forged',value:true}); const response=await call.response; if(!response.ok) throw Object.assign(new Error('denied'),{code:response.error.code}); }
 state.results[action]={ok:true,result:result??null};
 }catch(error){state.results[action]={ok:false,code:error.code??'INTERNAL_ERROR'};}finally{state.busy=false;} return state.results[action]; }
globalThis.phase6e6={state,run,cancel:()=>controller?.abort()};
document.getElementById('ai').addEventListener('click',()=>run('ai'));
document.getElementById('clipboard').addEventListener('click',()=>run('clipboard'));
api.onClose(()=>{state.closed=true;}); api.ready.then(()=>{state.ready=true;});`
await writeFile(path.join(author, 'index.mjs'), pluginCode)
await build({ root: author, configFile: false, logLevel: 'error', build: { target: 'es2022', outDir: bundle, emptyOutDir: false, minify: false,
  lib: { entry: path.join(author, 'index.mjs'), formats: ['es'], fileName: () => 'index.mjs' } } })
const pluginId = 'org.webtools.phase6e6.capabilities'
const caps = ['plugin.storage.read', 'plugin.storage.write', 'sharedAI.complete', 'clipboard.write']
const fixtureManifest = webManifest({ id: pluginId, name: 'Phase6E6 Isolated Capabilities', requestedCapabilities: caps,
  features: [{ id: 'capabilities', title: 'Capabilities', entry: { kind: 'web-bundle', document: 'web/index.html' }, requiredCapabilities: caps, acceptedContexts: [{ type: 'text', sources: ['launcher-input'] }] },
    { id: 'read-only', title: 'Read Only', entry: { kind: 'web-bundle', document: 'web/index.html' }, requiredCapabilities: ['plugin.storage.read'] }],
  webBundle: { files: [{ path: 'web/index.html', mediaType: 'text/html' }, { path: 'web/index.mjs', mediaType: 'text/javascript' }] } })
const fixtureBytes = webPackage(fixtureManifest, [{ name: 'web/index.html', data: '<!doctype html><html><head><meta charset="utf-8"></head><body><button id="ai">AI</button><button id="clipboard">Clipboard</button><script type="module" src="./index.mjs"></script></body></html>' },
  { name: 'web/index.mjs', data: await readFile(path.join(bundle, 'index.mjs')) }])
const snapshot = await validateWebPackageForRuntime(fixtureBytes, manifest.version)
const fixturePath = path.join(root, 'phase6e4b-runtime-fixture.wtplugin'); await writeFile(fixturePath, fixtureBytes)
const fixtureEntries = [{ name: 'web/index.html', data: '<!doctype html><html><head><meta charset="utf-8"></head><body><button id="ai">AI</button><button id="clipboard">Clipboard</button><script type="module" src="./index.mjs"></script></body></html>' },
  { name: 'web/index.mjs', data: await readFile(path.join(bundle, 'index.mjs')) }]
const updateBytes = webPackage(webManifest({ ...fixtureManifest, version: '2.0.0' }), fixtureEntries)
const updateSnapshot = await validateWebPackageForRuntime(updateBytes, manifest.version)
await writeFile(path.join(root, 'phase6e6-update-fixture.wtplugin'), updateBytes)
const networkBytes = webPackage(webManifest({ ...fixtureManifest, version: '3.0.0', requestedCapabilities: ['network.domains', 'plugin.storage.read'],
  features: fixtureManifest.features.map(feature => ({ ...feature, requiredCapabilities: feature.id === 'capabilities' ? ['network.domains'] : ['plugin.storage.read'] })),
  network: { mode: 'domains', domains: [{ host: 'status.example.com', protocol: 'https' }] } }), fixtureEntries)
const networkSnapshot = await validateWebPackageForRuntime(networkBytes, manifest.version)
await writeFile(path.join(root, 'phase6e6-network-fixture.wtplugin'), networkBytes)
const profile = await mkdtemp(path.join(root, 'profile-'))
const controlPath = path.join(profile, 'phase6e6-controls.json'); const effectsPath = path.join(profile, 'phase6e6-effects.json')
let commandSequence = 0
async function control(mode = 'accept', action = '') {
  if (action) commandSequence++
  const staging = `${controlPath}.tmp`; await writeFile(staging, JSON.stringify({ mode, action, sequence: commandSequence })); await rename(staging, controlPath)
  if (action) await wait(async () => JSON.parse(await readFile(effectsPath)), x => x.commandSequence === commandSequence && x.lastResult !== 'running', `command ${action}`)
  if (action) assert.equal(JSON.parse(await readFile(effectsPath)).lastResult, 'PASS')
}
await control()
const cases = []; const pass = name => cases.push({ name, result: 'PASS' })
const rounds = []; let manager; let plugin; let child; let logs = ''; let currentBase
async function targets() { return (await fetch(`${currentBase}/json/list`, { signal: AbortSignal.timeout(2000) })).json() }
async function launch() {
  assert.equal(owned().length, 0); const debugPort = await port(); currentBase = `http://127.0.0.1:${debugPort}`
  const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('WEBTOOLS_') || ['ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ASAR', 'NODE_OPTIONS'].includes(key)) delete env[key]
  Object.assign(env, { WEBTOOLS_WEB_RUNTIME_ACCEPTANCE: '1', WEBTOOLS_PHASE6E6_ACCEPTANCE: '1', WEBTOOLS_WEB_RUNTIME_TEST_PROFILE: profile,
    WEBTOOLS_WEB_RUNTIME_TEST_PACKAGE: fixturePath, WEBTOOLS_WEB_RUNTIME_TEST_DEBUG_PORT: String(debugPort) })
  child = spawn(managerExe, [`--user-data-dir=${profile}`, '--phase6e4b-web-runtime-acceptance', '--phase6e6-capability-acceptance'], { cwd: packagedRoot, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', b => { logs = (logs + b.toString()).slice(-2*1024*1024) }); child.stderr.on('data', b => { logs = (logs + b.toString()).slice(-2*1024*1024) })
  const identity = await wait(() => processes().find(p => Number(p.ProcessId) === child.pid && normalize(p.ExecutablePath??'') === normalize(managerExe)
    && String(p.CommandLine??'').toLowerCase().includes(profile.toLowerCase())), Boolean, 'exact packaged Main identity')
  rounds.push({ pid: child.pid, created: identity.CreationDate, executableSha256: hash(await readFile(managerExe)) })
  const rendererPath = path.join(packagedRoot, 'resources', 'app.asar', 'out', 'renderer', 'index.html')
  const target = await wait(async () => (await targets()).find(t => {
    try { return new URL(t.url).protocol === 'file:' && normalize(fileURLToPath(t.url)) === normalize(rendererPath) } catch { return false }
  }), Boolean, 'exact owned packaged Manager renderer')
  manager = await remote(target.webSocketDebuggerUrl)
  await wait(() => manager.evaluate('Boolean(window.desktop?.plugins && window.desktop?.pluginCatalog)'), Boolean, 'trusted Manager preload')
}
async function closeManager() {
  plugin?.close(); plugin = undefined
  try { await manager?.evaluate('window.close()') } catch {}
  manager?.close(); manager = undefined
  await wait(owned, p => p.length === 0, 'normal Manager close and exact process-group zero', 20000)
}
async function connectPlugin() {
  plugin?.close()
  const target = await wait(async () => (await targets()).find(t => t.url.startsWith('webtools-plugin://') && t.url.endsWith('/web/index.html')), Boolean, 'production plugin origin')
  assert.match(target.url, /^webtools-plugin:\/\/[a-f0-9]{32}\/web\/index\.html$/)
  plugin = await remote(target.webSocketDebuggerUrl)
  await wait(() => plugin.evaluate('Boolean(globalThis.phase6e6?.state.ready)'), Boolean, 'SDK production handshake')
  return target.url
}
async function click(id, completion = true) {
  await plugin.send('Page.bringToFront')
  const bounds = await plugin.evaluate(`(()=>{const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  await plugin.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...bounds })
  await plugin.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...bounds })
  if (completion) return wait(() => plugin.evaluate(`globalThis.phase6e6.state.results[${JSON.stringify(id)}]`), Boolean, `typed ${id} result`)
}
async function outcome(action) { return plugin.evaluate(`globalThis.phase6e6.run(${JSON.stringify(action)})`) }
let complete = false
try {
  await launch()
  const installed = await manager.evaluate('window.desktop.plugins.installFromUserDialog()'); assert.equal(installed.ok, true)
  assert.equal(installed.data.plugin.manifestVersion, 2); assert.deepEqual(installed.data.plugin.granted, []); assert.equal(installed.data.plugin.enabled, false)
  assert.equal(installed.data.plugin.hash, snapshot.packageHash)
  const denied = await manager.evaluate(`window.desktop.pluginCatalog.open({kind:'web',id:${JSON.stringify(pluginId)},featureId:'capabilities'})`); assert.equal(denied.ok, false)
  pass('A1 validated persisted v2 identity; declaration/install is not grant')
  assert.equal((await manager.evaluate(`window.desktop.plugins.setGrants(${JSON.stringify(pluginId)},${JSON.stringify(caps)})`)).ok, true)
  assert.equal((await manager.evaluate(`window.desktop.plugins.setEnabled(${JSON.stringify(pluginId)},true)`)).ok, true)
  assert.equal((await manager.evaluate(`window.desktop.pluginCatalog.open({kind:'web',id:${JSON.stringify(pluginId)},featureId:'capabilities'})`)).ok, true)
  await connectPlugin(); assert.deepEqual(await outcome('context'), { ok: true, result: null })
  assert.deepEqual(await outcome('storage'), { ok: true, result: { isolated: true } })
  pass('C typed SDK storage write/read/delete; Main namespace and durable sentinel')
  await closeManager(); pass('G1 normal close has zero exact packaged processes')
  await control('accept', '')
  await launch()
  const rows = await manager.evaluate('window.desktop.plugins.list()'); assert.equal(rows.ok, true)
  assert.equal(rows.data[0].hash, snapshot.packageHash); assert.deepEqual(rows.data[0].granted, caps); assert.equal(rows.data[0].enabled, true)
  const data = JSON.parse(await readFile(path.join(profile, 'plugins', 'data', `${pluginId}.json`))); assert.deepEqual(data.persist, { retained: true })
  pass('A2 restart reconstructs exact installed authority/grants and durable storage')
  await control('accept', 'context'); const originA = await connectPlugin()
  assert.deepEqual(await outcome('context'), { ok: true, result: { type: 'text', source: 'launcher-input', text: '  中文 exact 😀 Phase6E6  ' } })
  assert.deepEqual(await outcome('forged'), { ok: false, code: 'INVALID_REQUEST' })
  pass('B invocation-bound exact safe context and forged identity denial')
  const ai = await click('ai'); assert.deepEqual(ai, { ok: true, result: { text: 'Phase6E6 isolated AI response' } })
  await control('deny-ai'); await plugin.evaluate('delete phase6e6.state.results.ai'); assert.deepEqual(await click('ai'), { ok: false, code: 'USER_CANCELLED' })
  await control('unconfigured'); await plugin.evaluate('delete phase6e6.state.results.ai'); assert.deepEqual(await click('ai'), { ok: false, code: 'NOT_AVAILABLE' })
  await control('oversize-ai'); await plugin.evaluate('delete phase6e6.state.results.ai'); assert.deepEqual(await click('ai'), { ok: false, code: 'LIMIT_EXCEEDED' })
  await control('hold-ai'); await plugin.evaluate('delete phase6e6.state.results.ai'); await click('ai', false)
  await wait(async () => JSON.parse(await readFile(effectsPath)), e => e.aiDispatchCount === 3, 'held deterministic provider reached')
  await plugin.evaluate('phase6e6.cancel()'); await wait(() => plugin.evaluate('phase6e6.state.results.ai'), Boolean, 'local cancellation settles')
  assert.deepEqual(await plugin.evaluate('phase6e6.state.results.ai'), { ok: false, code: 'CANCELLED' })
  pass('D AI live grant/Feature/physical-event intent/confirmation, text-only output, denial/config/cancellation')
  await control('accept'); assert.deepEqual(await click('clipboard'), { ok: true, result: null })
  await control('deny-clipboard'); await plugin.evaluate('delete phase6e6.state.results.clipboard'); assert.deepEqual(await click('clipboard'), { ok: false, code: 'USER_CANCELLED' })
  const effects = JSON.parse(await readFile(effectsPath)); assert.equal(effects.clipboardEffectCount, 1)
  assert.equal(effects.clipboardSha256, hash(Buffer.from('Phase6E6 isolated clipboard text'))); assert.equal(effects.aiAbortCount, 1)
  pass('E bounded confirmed clipboard Host seam; denial has no effect; real clipboard untouched')
  await control('accept', 'replacement'); const originB = await connectPlugin(); assert.notEqual(originA, originB)
  const namespaces = await plugin.evaluate('phase6e6.state.namespaces'); assert.equal(namespaces.includes('ai'), false); assert.equal(namespaces.includes('clipboard'), false)
  assert.deepEqual(await outcome('missing-capability'), { ok: false, code: 'PERMISSION_DENIED' })
  pass('F1 generation replacement; per-Feature namespace/handler authority denies undeclared operation')
  await control('accept', 'revoke'); await wait(async () => (await targets()).filter(t => t.url.startsWith('webtools-plugin://')), t => t.length === 0, 'revoked runtime removed')
  plugin?.close(); plugin = undefined
  assert.equal((await manager.evaluate(`window.desktop.pluginCatalog.open({kind:'web',id:${JSON.stringify(pluginId)},featureId:'capabilities'})`)).ok, false)
  pass('F2 persisted grant revoke destroys old runtime and denies new invocation')
  await control('accept', 'restore'); await control('accept', 'context'); await connectPlugin()
  await control('accept', 'disable'); await wait(async () => (await targets()).filter(t => t.url.startsWith('webtools-plugin://')), t => t.length === 0, 'disable revokes runtime')
  pass('F3 disable revokes active generation before cleanup')
  await control('accept', 'restore')
  assert.equal((await manager.evaluate(`window.desktop.plugins.setEnabled(${JSON.stringify(pluginId)},true)`)).ok, true)
  await control('accept', 'context'); const beforeUpdateOrigin = await connectPlugin()
  await control('hold-ai'); await click('ai', false)
  await wait(async () => JSON.parse(await readFile(effectsPath)), e => e.aiDispatchCount === 4, 'pending old-generation AI reached')
  await control('hold-update')
  await manager.evaluate('globalThis.phase6e6UpdateResult=null; window.desktop.plugins.installFromUserDialog().then(result=>{globalThis.phase6e6UpdateResult=result}); true')
  await wait(async () => JSON.parse(await readFile(effectsPath)), e => e.updateConfirmationPending, 'replacement confirmation is unresolved')
  await wait(async () => (await targets()).filter(t => t.url.startsWith('webtools-plugin://')), t => t.length === 0, 'old READY view revoked before confirmation resolves')
  assert.equal(await manager.evaluate('globalThis.phase6e6UpdateResult'), null)
  await wait(async () => JSON.parse(await readFile(effectsPath)), e => e.aiAbortCount === 2, 'old pending effect aborted during update confirmation')
  plugin?.close(); plugin = undefined
  await control('deny-update')
  const cancelledUpdate = await wait(() => manager.evaluate('globalThis.phase6e6UpdateResult'), Boolean, 'denied update settles')
  assert.equal(cancelledUpdate.ok, true); assert.equal(cancelledUpdate.data.outcome, 'cancelled')
  assert.equal((await manager.evaluate('window.desktop.plugins.list()')).data[0].hash, snapshot.packageHash)
  await control('accept', 'context'); assert.notEqual(await connectPlugin(), beforeUpdateOrigin)
  assert.deepEqual(await outcome('storage'), { ok: true, result: { isolated: true } })
  pass('U1 unresolved update confirmation revokes old READY authority and pending effect; denial requires fresh generation')
  await control('approve-update')
  const updated = await manager.evaluate('window.desktop.plugins.installFromUserDialog()')
  assert.equal(updated.ok, true); assert.equal(updated.data.plugin.hash, updateSnapshot.packageHash); assert.equal(updated.data.plugin.version, '2.0.0')
  await wait(async () => (await targets()).filter(t => t.url.startsWith('webtools-plugin://')), t => t.length === 0, 'approved replacement closes old generation')
  pass('U2 approved replacement persists exact new version/hash without resurrecting old authority')
  await control('choose-network')
  const networkInstall = await manager.evaluate('window.desktop.plugins.installFromUserDialog()')
  assert.equal(networkInstall.ok, true); assert.equal(networkInstall.data.plugin.hash, networkSnapshot.packageHash)
  assert.equal(networkInstall.data.plugin.status, 'incompatible'); assert.equal(networkInstall.data.plugin.granted.includes('network.domains'), false)
  const networkGrant = await manager.evaluate(`window.desktop.plugins.setGrants(${JSON.stringify(pluginId)},['network.domains'])`)
  assert.equal(networkGrant.ok, false); assert.equal(networkGrant.error.code, 'INCOMPATIBLE_PLUGIN')
  const registryPath = path.join(profile, 'plugins', 'registry.json')
  assert.equal(JSON.parse(await readFile(registryPath)).plugins[0].granted.includes('network.domains'), false)
  const authorityEffects = JSON.parse(await readFile(effectsPath))
  await closeManager(); pass('G2 ordinary Manager close; all exact packaged processes exit')
  const staleRegistry = JSON.parse(await readFile(registryPath)); staleRegistry.plugins[0].granted.push('network.domains')
  await writeFile(registryPath, JSON.stringify(staleRegistry)) // Deliberate stale grant only in the stopped disposable profile.
  await control('accept'); await launch()
  const sanitized = (await manager.evaluate('window.desktop.plugins.list()')).data[0]
  assert.equal(sanitized.granted.includes('network.domains'), false); assert.equal(sanitized.status, 'incompatible')
  assert.equal(JSON.parse(await readFile(registryPath)).plugins[0].granted.includes('network.domains'), false)
  assert.equal((await manager.evaluate(`window.desktop.pluginCatalog.open({kind:'web',id:${JSON.stringify(pluginId)},featureId:'capabilities'})`)).ok, false)
  await closeManager()
  pass('N1 domains remains requested/unsupported; Main refuses grants; stale persisted grant sanitized on real packaged restart')
  const changed = spawnSync('git', ['diff','--name-only','HEAD'], {cwd:repo,encoding:'utf8'}).stdout.trim().split(/\r?\n/)
  const untracked = spawnSync('git', ['ls-files','--others','--exclude-standard'], {cwd:repo,encoding:'utf8'}).stdout.trim().split(/\r?\n/)
  const protectedFiles = new Set(['native/WebTools.NativeHost.Checks/Program.cs', 'native/WebTools.NativeHost/Catalog/AppCatalogService.cs', 'docs/bugfix-launcher-app-search-after-autostart.md'])
  const sourceFiles = [...new Set([...changed,...untracked])].filter(file => file && !protectedFiles.has(file)
    && ['electron/','src/','plugin-sdk/','native/','scripts/'].some(prefix => file.startsWith(prefix))).sort()
  const sourceIdentity = []
  for (const file of sourceFiles) sourceIdentity.push({ file, sha256:hash(await readFile(path.join(repo,file))) })
  const evidence = { result: 'BOUNDED_PACKAGED_ACCEPTANCE_PASS', scope: 'Phase 6E-6 only', sourceHead: spawnSync('git', ['rev-parse','HEAD'], {cwd:repo,encoding:'utf8'}).stdout.trim(),
    sourceIdentity, sourceIdentitySha256:hash(Buffer.from(JSON.stringify(sourceIdentity))), designSha256:hash(await readFile(path.join(repo,'docs','phase6e6-capability-boundary-design.md'))),
    executableSha256: hash(await readFile(managerExe)), appAsarSha256: hash(await readFile(asarPath)), sdkVersion, sdkTarballSha256: hash(await readFile(sdkTarball)),
    fixtureSha256: snapshot.packageHash, replacementFixtureSha256: updateSnapshot.packageHash, networkFixtureSha256: networkSnapshot.packageHash,
    pluginId, cases, rounds, effects: authorityEffects, restartEffects: JSON.parse(await readFile(effectsPath)), finalExactProcessCount: owned().length,
    seams: ['TEMP-only user consent decisions', 'deterministic AI final service effect; no real token/network', 'clipboard final effect hash collector; no real clipboard read/write',
      'typed Native context transport fixture invokes real FeatureInvocationService; does not certify physical Native gesture or Named Pipe in this round'],
    gate4: 'NOT CERTIFIED', networkDomains: 'UNSUPPORTED', productionInstallTouched: false, realUserProfileTouched: false }
  assert.equal(evidence.finalExactProcessCount, 0)
  const evidencePath = path.join(root, 'phase6e6-packaged-evidence.json'); await writeFile(evidencePath, JSON.stringify(evidence,null,2)+'\n')
  console.log(JSON.stringify({ result:evidence.result, cases:cases.length, evidencePath, sha256:hash(await readFile(evidencePath)), finalExactProcessCount:0 },null,2)); complete = true
} finally {
  if (!complete) { try { await closeManager() } catch { console.error('Exact isolated Manager did not close; no process was killed.') } }
  plugin?.close(); manager?.close(); await writeFile(path.join(root,'packaged-manager.log'), logs)
}
