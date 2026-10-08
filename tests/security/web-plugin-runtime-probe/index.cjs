'use strict'

const { app, BrowserWindow, WebContentsView, protocol, session, webContents } = require('electron')
const { createServer } = require('node:http')
const { spawn } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const {
  buildCsp,
  buildRuntimeOrigin,
  createRuntimeHost,
  allowsRuntimeUrl,
} = require('./policy.cjs')

protocol.registerSchemesAsPrivileged([{
  scheme: 'webtools-plugin',
  privileges: { standard: true, secure: true, supportFetchAPI: true },
}])

const args = new Map(process.argv.slice(1).filter(value => value.startsWith('--probe-')).map(value => {
  const separator = value.indexOf('=')
  return separator < 0 ? [value.slice(2), ''] : [value.slice(2, separator), value.slice(separator + 1)]
}))
const outputPath = args.get('probe-output') || path.join(os.tmpdir(), `webtools-phase6e4a-${process.pid}.json`)
const userDataPath = args.get('probe-user-data') || path.join(os.tmpdir(), `webtools-phase6e4a-profile-${randomBytes(8).toString('hex')}`)
const phase = args.get('probe-phase') || 'full'
const forcedHost = args.get('probe-host')
app.setPath('userData', userDataPath)

const report = {
  probe: 'Phase 6E-4A packaged Electron runtime security probe',
  status: 'RUNNING',
  phase,
  source: { electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node, platform: process.platform, osRelease: os.release() },
  isolation: { userDataPath, partition: 'webtools-plugin-runtime-v1', productionProfileUsed: false },
  checks: {},
  errors: [],
}
let managerWindow
let view
let probeSession
let localServer
let runtimeHost
let runtimeOrigin
const blockedRequests = []
const navigationEvents = []
const permissionEvents = []
const protocolHits = []
const fixtureBytes = new Map()
const runtimeIdentities = []
const serviceWorkerEvents = []
const lifecycleEvents = []
let activeTestGeneration = null
let testGenerationSequence = 0
const protocolNotFoundRoutes = []
const protocolFailureRoutes = []
const lifecycleViewRegistry = new Set()

function writeReport() {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8')
}

function recordError(area, error) {
  report.errors.push({ area, message: error?.stack || String(error) })
}

function asResponse(body, contentType, headers = {}) {
  return new Response(body, { status: 200, headers: { 'content-type': contentType, 'x-content-type-options': 'nosniff', ...headers } })
}

function htmlForNetworkPage(port) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Network policy probe</title></head><body><script src="./network-page.js"></script></body></html>`
}

function makeFixtureAssets() {
  const appPath = app.getAppPath()
  fixtureBytes.set('/probe.html', {
    body: '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="./style.css"><title>Isolated plugin probe</title></head><body><script>window.__inlineProbe = true</script><div id="font-probe">font</div><script type="module" src="./probe-page.js"></script></body></html>',
    mime: 'text/html; charset=utf-8',
  })
  fixtureBytes.set('/network.html', { body: htmlForNetworkPage(localServer.address().port), mime: 'text/html; charset=utf-8', network: true })
  fixtureBytes.set('/probe-page.js', { body: fs.readFileSync(path.join(appPath, 'probe-page.js')), mime: 'text/javascript; charset=utf-8' })
  fixtureBytes.set('/network-page.js', { body: fs.readFileSync(path.join(appPath, 'network-page.js')), mime: 'text/javascript; charset=utf-8' })
  fixtureBytes.set('/dynamic.js', { body: fs.readFileSync(path.join(appPath, 'dynamic.js')), mime: 'text/javascript; charset=utf-8' })
  fixtureBytes.set('/style.css', { body: fs.readFileSync(path.join(appPath, 'style.css')), mime: 'text/css; charset=utf-8' })
  fixtureBytes.set('/pixel.png', { body: fs.readFileSync(path.join(appPath, 'pixel.png')), mime: 'image/png' })
  fixtureBytes.set('/tiny.wasm', { body: fs.readFileSync(path.join(appPath, 'tiny.wasm')), mime: 'application/wasm' })
  fixtureBytes.set('/test-font.woff2', { body: fs.readFileSync(path.join(appPath, 'test-font.woff2')), mime: 'font/woff2' })
  fixtureBytes.set('/data.json', { body: Buffer.from('{"fixture":"packaged-resource","version":1}'), mime: 'application/json; charset=utf-8' })
  fixtureBytes.set('/worker.js', { body: Buffer.from("self.postMessage('unexpected-worker')"), mime: 'text/javascript; charset=utf-8' })
  fixtureBytes.set('/navigation.html', { body: fs.readFileSync(path.join(appPath, 'navigation.html')), mime: 'text/html; charset=utf-8' })
  fixtureBytes.set('/navigation-page.js', { body: fs.readFileSync(path.join(appPath, 'navigation-page.js')), mime: 'text/javascript; charset=utf-8' })
}

function installRuntimePolicy() {
  probeSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    permissionEvents.push({ kind: 'request', permission, requestingUrl: details.requestingUrl || null })
    callback(false)
  })
  probeSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    permissionEvents.push({ kind: 'check', permission, requestingOrigin })
    return false
  })
  probeSession.setDevicePermissionHandler(() => false)
  probeSession.setUSBProtectedClassesHandler(() => [])
  probeSession.serviceWorkers.on('registration-completed', (_event, details) => {
    serviceWorkerEvents.push({ kind: 'registration-completed', scopeOrigin: new URL(details.scope).origin })
  })
  probeSession.serviceWorkers.on('running-status-changed', (_event, details) => {
    serviceWorkerEvents.push({ kind: 'running-status-changed', runningStatus: details.runningStatus })
  })
  probeSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    if (allowsRuntimeUrl(details.url, runtimeOrigin)) return callback({})
    blockedRequests.push({ url: details.url, type: details.resourceType, method: details.method })
    callback({ cancel: true })
  })
  probeSession.webRequest.onBeforeRedirect({ urls: ['<all_urls>'] }, details => {
    if (!allowsRuntimeUrl(details.redirectURL, runtimeOrigin)) navigationEvents.push({ kind: 'redirect', url: details.url, redirectUrl: details.redirectURL, action: 'deny-by-request-policy' })
  })
  probeSession.on('will-download', (event, item) => {
    event.preventDefault()
    report.checks.download = { canceled: true, filename: item.getFilename() }
  })
  probeSession.protocol.handle('webtools-plugin', request => {
    const url = new URL(request.url)
    if (url.hostname !== runtimeHost || !allowsRuntimeUrl(request.url, runtimeOrigin)) return new Response('not found', { status: 404 })
    const route = url.pathname
    if (route === '/invalid-package-route') { protocolFailureRoutes.push(route); throw new Error('intentional-packaged-load-failure') }
    if (route === '/redirect') return new Response(null, { status: 302, headers: { location: `http://127.0.0.1:${localServer.address().port}/redirect-target` } })
    if (route === '/download.txt') return asResponse('download fixture', 'text/plain; charset=utf-8', { 'content-disposition': 'attachment; filename="phase6e4a.txt"' })
    const fixture = fixtureBytes.get(route)
    if (!fixture) { protocolNotFoundRoutes.push(route); return new Response('not found', { status: 404 }) }
    protocolHits.push({ host: url.hostname, path: route, method: request.method })
    let csp = buildCsp({ wasm: url.searchParams.get('wasm') === 'enabled' })
    if (fixture.network) {
      const loopbackOrigin = `http://127.0.0.1:${localServer.address().port}`
      csp = [
        "default-src 'none'", "base-uri 'none'", "object-src 'none'", "form-action 'none'",
        `script-src 'self' ${loopbackOrigin}`, `style-src 'self' ${loopbackOrigin}`, `img-src 'self' data: ${loopbackOrigin}`,
        `font-src 'self' ${loopbackOrigin}`, `connect-src 'self' ${loopbackOrigin} https://127.0.0.1:${localServer.address().port} ws://127.0.0.1:${localServer.address().port} wss://127.0.0.1:${localServer.address().port}`,
        `frame-src * data: blob: file: ${loopbackOrigin}`, "worker-src 'none'",
      ].join('; ')
    }
    return asResponse(fixture.body, fixture.mime, {
      'content-security-policy': csp,
      'cache-control': 'public, max-age=86400',
    })
  })
}

async function awaitCondition(read, predicate, timeoutMs = 5000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const value = await read()
    if (predicate(value)) return value
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('Timed out waiting for renderer probe readiness')
}

async function executeProbe(url) {
  view = new WebContentsView({
    webPreferences: {
      session: probeSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
    },
  })
  const contents = view.webContents
  contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
  const viewIdentity = { id: contents.id, sessionPartition: probeSession.getStoragePath() || null, destroyedBefore: false }
  contents.setWindowOpenHandler(details => {
    navigationEvents.push({ kind: 'window-open', url: details.url, action: 'deny' })
    return { action: 'deny' }
  })
  contents.on('will-frame-navigate', event => {
    const target = event.url
    if (!allowsRuntimeUrl(target, runtimeOrigin)) {
      event.preventDefault()
      navigationEvents.push({ kind: 'frame-navigation', url: target, mainFrame: event.isMainFrame, action: 'deny' })
    }
  })
  contents.on('will-navigate', (event, target) => {
    if (!allowsRuntimeUrl(target, runtimeOrigin)) {
      event.preventDefault()
      navigationEvents.push({ kind: 'main-navigation', url: target, action: 'deny' })
    }
  })
  contents.on('will-redirect', (event, target) => {
    if (!allowsRuntimeUrl(target, runtimeOrigin)) {
      event.preventDefault()
      navigationEvents.push({ kind: 'redirect', url: target, action: 'deny' })
    }
  })
  contents.on('render-process-gone', (_event, details) => {
    report.checks.rendererGone = details
  })
  contents.on('destroyed', () => { viewIdentity.destroyed = true })
  managerWindow.contentView.addChildView(view)
  view.setBounds({ x: 0, y: 0, width: 760, height: 560 })
  await contents.loadURL(url)
  const ready = await awaitCondition(() => contents.executeJavaScript('Boolean(window.__probeReady || window.__networkProbeReady)'), Boolean)
  const result = await contents.executeJavaScript('JSON.stringify({probe:window.__probe||null,network:window.__networkProbe||null})')
  report.checks.lastProbeReady = ready
  const parsed = JSON.parse(result)
  viewIdentity.destroyedBefore = contents.isDestroyed()
  viewIdentity.urlBeforeDestroy = contents.getURL()
  managerWindow.contentView.removeChildView(view)
  contents.close({ waitForBeforeUnload: false })
  await awaitCondition(() => viewIdentity.destroyed, Boolean)
  report.checks.webContentsViewLifecycle = { createdId: viewIdentity.id, destroyed: viewIdentity.destroyed, urlBeforeDestroy: viewIdentity.urlBeforeDestroy }
  view = undefined
  return parsed
}

async function createNetworkServer() {
  let requests = 0
  localServer = createServer((request, response) => {
    requests += 1
    response.writeHead(200, { 'access-control-allow-origin': '*', 'content-type': 'text/plain' })
    response.end('probe-loopback-response')
  })
  await new Promise((resolve, reject) => { localServer.once('error', reject); localServer.listen(0, '127.0.0.1', resolve) })
  return () => requests
}

async function runStorageRestartChild(childPhase, host, outputFile) {
  const child = spawn(process.execPath, [
    `--probe-phase=${childPhase}`,
    `--probe-host=${host}`,
    `--probe-output=${outputFile}`,
    `--probe-user-data=${userDataPath}`,
  ], { windowsHide: true, stdio: 'ignore' })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`${childPhase} subprocess timed out`)) }, 30000)
    child.once('error', error => { clearTimeout(timeout); reject(error) })
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      if (code !== 0) return reject(new Error(`${childPhase} exited code=${code}, signal=${signal}`))
      try { resolve(JSON.parse(fs.readFileSync(outputFile, 'utf8'))) } catch (error) { reject(error) }
    })
  })
}

async function runStorageRestartCheck() {
  const writeFile = path.join(path.dirname(outputPath), `phase6e4a-storage-write-${process.pid}.json`)
  const checkFile = path.join(path.dirname(outputPath), `phase6e4a-storage-check-${process.pid}.json`)
  const write = await runStorageRestartChild('storage-write', runtimeHost, writeFile)
  const check = await runStorageRestartChild('storage-check', runtimeHost, checkFile)
  report.checks.nonPersistentStorageAcrossRestart = {
    writePhase: write.checks.storageWrite || null,
    checkPhase: check.checks.storageRead || null,
    sameRuntimeOrigin: write.runtimeOrigin === check.runtimeOrigin,
    childProcesses: [write.processId ?? null, check.processId ?? null],
  }
  for (const filename of [writeFile, checkFile]) fs.rmSync(filename, { force: true })
}

async function setupFixture() {
  const appPage = path.join(app.getAppPath(), 'manager.html')
  managerWindow = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(app.getAppPath(), 'manager-preload.cjs'),
    },
  })
  await managerWindow.loadFile(appPage)
  const managerWorld = await managerWindow.webContents.executeJavaScript('JSON.stringify({dom:!!document.getElementById("trusted-manager-dom"),desktop:!!window.desktop,sentinel:window.managerSentinel})')
  report.checks.managerFixture = JSON.parse(managerWorld)
  report.checks.webPreferences = { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, webviewTag: false, runtimePreload: null }
}

async function runStoragePhase(mode) {
  runtimeHost = forcedHost || createRuntimeHost()
  runtimeOrigin = buildRuntimeOrigin(runtimeHost)
  report.runtimeOrigin = runtimeOrigin
  report.processId = process.pid
  localServer = createServer((_req, response) => response.end('unused'))
  await new Promise((resolve, reject) => { localServer.once('error', reject); localServer.listen(0, '127.0.0.1', resolve) })
  makeFixtureAssets()
  probeSession = session.fromPartition('webtools-plugin-runtime-v1', { cache: false })
  await probeSession.setProxy({ mode: 'direct' })
  installRuntimePolicy()
  await setupFixture()
  const page = `${runtimeOrigin}/probe.html?storage=${mode === 'storage-write' ? 'write' : 'read'}`
  const result = await executeProbe(page)
  if (mode === 'storage-write') report.checks.storageWrite = result.probe?.storage
  else report.checks.storageRead = result.probe?.storage
  report.status = 'PASS'
}

async function runFullProbe() {
  runtimeHost = forcedHost || createRuntimeHost()
  runtimeOrigin = buildRuntimeOrigin(runtimeHost)
  report.runtimeOrigin = runtimeOrigin
  report.runtimeOriginA = runtimeOrigin
  runtimeIdentities.push({ generation: 'A', host: runtimeHost, origin: runtimeOrigin })
  const localRequestCount = await createNetworkServer()
  makeFixtureAssets()
  probeSession = session.fromPartition('webtools-plugin-runtime-v1', { cache: false })
  await probeSession.setProxy({ mode: 'direct' })
  installRuntimePolicy()
  await setupFixture()

  const first = await executeProbe(`${runtimeOrigin}/probe.html?storage=write`)
  report.checks.mainWorldAndResources = first.probe
  report.checks.storageBeforeClear = first.probe?.storage
  await executeProbe(`${runtimeOrigin}/probe.html?storage=read`)
  const protocolHitCountBeforeClear = protocolHits.length
  report.checks.customProtocolRepeatLoad = { handlerHitsAfterInitialAndRepeatedLoad: protocolHitCountBeforeClear }

  await probeSession.clearData({ origins: [runtimeOrigin], dataTypes: ['cache', 'cookies', 'indexedDB', 'localStorage', 'serviceWorkers'] })
  await probeSession.clearStorageData({ origin: runtimeOrigin, storages: ['cookies', 'indexdb', 'localstorage', 'serviceworkers', 'cachestorage'] })
  await probeSession.clearCache()
  await probeSession.closeAllConnections()
  const cleared = await executeProbe(`${runtimeOrigin}/probe.html?storage=read`)
  report.checks.storageAfterExplicitCleanup = cleared.probe?.storage
  report.checks.cacheRevalidation = { protocolHitsBeforeClear: protocolHitCountBeforeClear, protocolHitsAfterClear: protocolHits.length }

  const freshHost = createRuntimeHost()
  const oldOrigin = runtimeOrigin
  runtimeHost = freshHost
  runtimeOrigin = buildRuntimeOrigin(freshHost)
  report.runtimeOriginB = runtimeOrigin
  runtimeIdentities.push({ generation: 'B', host: runtimeHost, origin: runtimeOrigin })
  const runtimeB = await executeProbe(`${runtimeOrigin}/probe.html?storage=read`)
  report.checks.runtimeBStorageIsolation = runtimeB.probe?.storage || null
  try {
    const staleAttempt = await probeSession.fetch(`${oldOrigin}/probe.html`)
    report.checks.staleRuntimeOrigin = { allowed: true, status: staleAttempt.status, body: await staleAttempt.text(), expected: 'blocked' }
  } catch (error) {
    report.checks.staleRuntimeOrigin = { allowed: false, error: String(error), expected: 'blocked' }
  }

  const wasmEnabled = await executeProbe(`${runtimeOrigin}/probe.html?wasm=enabled`)
  report.checks.wasmOptionalCsp = wasmEnabled.probe?.packageAssets || null

  const port = localServer.address().port
  const networkTarget = `http://127.0.0.1:${port}/resource`
  const network = await executeProbe(`${runtimeOrigin}/network.html?target=${encodeURIComponent(networkTarget)}`)
  report.checks.networkAndNavigation = {
    renderer: network.network,
    blockedRequests: blockedRequests.slice(),
    navigationEvents: navigationEvents.slice(),
    loopbackServerRequests: localRequestCount(),
    permissionEvents: permissionEvents.slice(),
  }
  report.checks.lifecycleCycles = []
  for (let cycle = 0; cycle < 3; cycle += 1) {
    const cycleResult = await executeProbe(`${runtimeOrigin}/probe.html?storage=read`)
    report.checks.lifecycleCycles.push({ cycle: cycle + 1, ready: Boolean(cycleResult.probe), webContentsDestroyed: report.checks.webContentsViewLifecycle?.destroyed === true })
  }
  await runStorageRestartCheck()
  report.runtimeIdentities = runtimeIdentities
  report.checks.packagedResourceTypes = [...new Set(protocolHits.map(item => path.extname(item.path) || item.path))]
  report.checks.managerIsolation = { separateWebContents: true, runtimePreload: null, managerFixturePreload: true, managerWindowHidden: managerWindow.isVisible() === false }
  report.checks.cleanup = { storageCleanupCompleted: true, protocolHandlerCalls: protocolHits.length, blockedRequestCount: blockedRequests.length }
  report.status = 'COMPLETE_WITH_FINDINGS'
}

function waitFor(read, predicate, timeoutMs, intervalMs = 25) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const check = () => {
      let value
      try { value = read() } catch (error) { return reject(error) }
      if (predicate(value)) return resolve(value)
      if (Date.now() - started >= timeoutMs) return reject(new Error(`bounded wait expired after ${timeoutMs}ms`))
      setTimeout(check, intervalMs)
    }
    check()
  })
}

function createProbeGeneration(label) {
  const generation = { id: ++testGenerationSequence, label, revoked: false }
  activeTestGeneration = generation
  return generation
}

function revokeProbeGeneration(generation) {
  generation.revoked = true
  if (activeTestGeneration === generation) activeTestGeneration = null
}

function getRemainingRuntimeCounts() {
  return {
    views: lifecycleViewRegistry.size,
    webContents: webContents.getAllWebContents().filter(contents => contents.session === probeSession && !contents.isDestroyed()).length,
  }
}

function schemeOf(rawUrl) {
  try { return new URL(rawUrl).protocol.replace(':', '') } catch { return 'invalid' }
}

function createLifecycleView(generation, label) {
  const lifecycle = { label, generation: generation.id, events: [], removed: false, destroyed: false, loadFailed: null, gone: null, unresponsive: false }
  const runtimeView = new WebContentsView({ webPreferences: {
    session: probeSession,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
    webviewTag: false,
  } })
  const contents = runtimeView.webContents
  lifecycleViewRegistry.add(contents.id)
  contents.on('will-navigate', (event, url) => {
    lifecycle.events.push({ kind: 'will-navigate', scheme: schemeOf(url) })
    if (!allowsRuntimeUrl(url, runtimeOrigin)) { event.preventDefault(); lifecycle.events.push({ kind: 'host-deny-main', scheme: schemeOf(url) }) }
  })
  contents.on('will-frame-navigate', event => {
    const { url, isMainFrame } = event
    lifecycle.events.push({ kind: 'will-frame-navigate', scheme: schemeOf(url), mainFrame: isMainFrame })
    if (!allowsRuntimeUrl(url, runtimeOrigin)) { event.preventDefault(); lifecycle.events.push({ kind: 'host-deny-frame', scheme: schemeOf(url), mainFrame: isMainFrame }) }
  })
  contents.on('will-redirect', (event, url) => {
    lifecycle.events.push({ kind: 'will-redirect', scheme: schemeOf(url) })
    if (!allowsRuntimeUrl(url, runtimeOrigin)) { event.preventDefault(); lifecycle.events.push({ kind: 'host-deny-redirect', scheme: schemeOf(url) }) }
  })
  contents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => lifecycle.events.push({ kind: 'did-start-navigation', scheme: schemeOf(url), isInPlace, isMainFrame }))
  contents.on('did-navigate', (_event, url, statusCode) => { const parsed = new URL(url); lifecycle.events.push({ kind: 'did-navigate', scheme: parsed.protocol.replace(':', ''), host: parsed.hostname, route: parsed.pathname, statusCode }) })
  contents.on('did-frame-navigate', (_event, url, statusCode, _text, isMainFrame) => { const parsed = new URL(url); lifecycle.events.push({ kind: 'did-frame-navigate', scheme: parsed.protocol.replace(':', ''), host: parsed.hostname, route: parsed.pathname, statusCode, isMainFrame }) })
  contents.on('console-message', (event, level, message) => {
    const text = typeof message === 'string' ? message : (event?.message || '')
    lifecycle.events.push({ kind: 'console-message', level: Number.isInteger(level) ? level : (event?.level ?? 0), category: /not allowed|blocked|content.?security|security policy/i.test(text) ? 'security-denial' : 'other' })
  })
  contents.on('did-fail-load', (_event, errorCode, _description, url, isMainFrame) => {
    lifecycle.loadFailed = { errorCode, scheme: schemeOf(url), isMainFrame }
    lifecycle.events.push({ kind: 'did-fail-load', errorCode, scheme: schemeOf(url), isMainFrame })
  })
  contents.on('render-process-gone', (_event, details) => { lifecycle.gone = { reason: details.reason, exitCode: details.exitCode }; lifecycle.events.push({ kind: 'render-process-gone', reason: details.reason }) })
  contents.on('unresponsive', () => { lifecycle.unresponsive = true; lifecycle.events.push({ kind: 'unresponsive' }) })
  contents.on('destroyed', () => { lifecycle.destroyed = true; lifecycleViewRegistry.delete(contents.id); lifecycle.events.push({ kind: 'destroyed' }) })
  contents.setWindowOpenHandler(({ url }) => {
    lifecycle.events.push({ kind: 'setWindowOpenHandler', scheme: schemeOf(url), action: 'deny' })
    return { action: 'deny' }
  })
  managerWindow.contentView.addChildView(runtimeView)
  runtimeView.setBounds({ x: 0, y: 0, width: 760, height: 560 })
  lifecycle.view = runtimeView
  lifecycle.contents = contents
  lifecycle.generationRef = generation
  return lifecycle
}

async function destroyLifecycleRuntime(lifecycle, { requestGraceful = true, limitMs = 2000 } = {}) {
  const started = Date.now()
  const generation = lifecycle.generationRef
  revokeProbeGeneration(generation)
  lifecycle.events.push({ kind: 'generation-revoked' })
  if (!lifecycle.contents.isDestroyed()) {
    try { managerWindow.contentView.removeChildView(lifecycle.view); lifecycle.removed = true }
    catch { lifecycle.removed = !managerWindow.contentView.children.includes(lifecycle.view) }
    if (requestGraceful) {
      try { lifecycle.contents.close({ waitForBeforeUnload: false }) } catch {}
    }
    try { await waitFor(() => lifecycle.destroyed || lifecycle.contents.isDestroyed(), Boolean, limitMs) }
    catch {
      lifecycle.events.push({ kind: 'grace-deadline-expired', limitMs })
      if (!lifecycle.contents.isDestroyed()) {
        try { lifecycle.contents.forcefullyCrashRenderer(); lifecycle.events.push({ kind: 'forcefullyCrashRenderer' }) } catch (error) { lifecycle.events.push({ kind: 'force-crash-error', errorName: error.name }) }
      }
      await waitFor(() => lifecycle.gone !== null, Boolean, 2000).catch(() => {})
      if (!lifecycle.contents.isDestroyed()) {
        try { lifecycle.contents.close({ waitForBeforeUnload: false }) } catch {}
      }
      await waitFor(() => lifecycle.destroyed || lifecycle.contents.isDestroyed(), Boolean, 1000).catch(() => {})
    }
  }
  lifecycle.destroyed ||= lifecycle.contents.isDestroyed()
  lifecycle.durationMs = Date.now() - started
  return lifecycle
}

async function loadLifecycleView(label, url) {
  const generation = createProbeGeneration(label)
  const lifecycle = createLifecycleView(generation, label)
  let loadError = null
  try { await lifecycle.contents.loadURL(url) }
  catch (error) { loadError = { name: error.name, code: error.code || null } }
  lifecycle.loadError = loadError
  return lifecycle
}

async function runNavigationMatrix() {
  const filePath = path.join(userDataPath, 'probe-owned-file-sentinel.html')
  fs.writeFileSync(filePath, '<!doctype html><meta charset="utf-8"><script>window.__probeFileSentinel="probe-owned-file-only";window.parent?.postMessage({phase6e4a1FileSentinel:true},"*")<\/script><p>probe-only</p>', 'utf8')
  const oldHost = createRuntimeHost()
  const targets = [
    { id: 'http', url: `http://127.0.0.1:${localServer.address().port}/navigation-sink`, scheme: 'http' },
    { id: 'https', url: `https://127.0.0.1:${localServer.address().port}/navigation-sink`, scheme: 'https' },
    { id: 'file', url: pathToFileURL(filePath).href, scheme: 'file' },
    { id: 'javascript', url: 'javascript:top.__javascriptUrlExecuted=true', scheme: 'javascript' },
    { id: 'data', url: 'data:text/html,phase6e4a1-navigation-sentinel', scheme: 'data' },
    { id: 'blob', url: null, scheme: 'blob' },
    { id: 'old-runtime', url: `${buildRuntimeOrigin(oldHost)}/probe.html`, scheme: 'webtools-plugin' },
    { id: 'current-valid', url: `${runtimeOrigin}/probe.html`, scheme: 'webtools-plugin', allowed: true },
    { id: 'current-invalid', url: `${runtimeOrigin}/nonexistent-route`, scheme: 'webtools-plugin', allowed: false },
  ]
  const methods = ['location.href', 'location.assign', 'location.replace', 'anchor.click', 'window.open', 'iframe.src']
  const records = []
  try {
    for (const target of targets) {
      for (const method of methods) {
        const generation = createProbeGeneration(`nav-${target.id}-${method}`)
        const lifecycle = createLifecycleView(generation, `nav-${target.id}-${method}`)
        await lifecycle.contents.loadURL(`${runtimeOrigin}/navigation.html`)
        const blockedBefore = blockedRequests.length
        let rawTarget = target.url
        if (target.id === 'blob') {
          rawTarget = await lifecycle.contents.executeJavaScript("URL.createObjectURL(new Blob(['window.__blobNavigation=true'],{type:'text/html'}))")
        }
        const attempt = await lifecycle.contents.executeJavaScript(`(() => {
          const target = ${JSON.stringify(rawTarget)};
          if (${JSON.stringify(method)} === 'location.href') { location.href = target; return 'attempted' }
          if (${JSON.stringify(method)} === 'location.assign') { location.assign(target); return 'attempted' }
          if (${JSON.stringify(method)} === 'location.replace') { location.replace(target); return 'attempted' }
          if (${JSON.stringify(method)} === 'anchor.click') { const a=document.createElement('a'); a.href=target; document.body.append(a); a.click(); return 'attempted' }
          if (${JSON.stringify(method)} === 'window.open') { return window.open(target, '_blank') === null ? 'attempted-denied-or-blocked' : 'attempted-opened' }
          const f=document.createElement('iframe'); f.src=target; document.body.append(f); return 'attempted'
        })()`)
        await new Promise(resolve => setTimeout(resolve, 180))
        let effect = { javascriptSentinel: null, fileSentinel: null, currentScheme: null, securityEvents: [] }
        if (!lifecycle.contents.isDestroyed()) {
          try {
            effect = await lifecycle.contents.executeJavaScript(`(() => {
              let fileSentinel = null;
              try { fileSentinel = window.__probeFileSentinel || window.__probeFileSentinelAccessible || document.querySelector('iframe')?.contentWindow?.__probeFileSentinel || null } catch {}
              return { javascriptSentinel: window.__javascriptUrlExecuted === true, fileSentinel: Boolean(fileSentinel), currentScheme: location.protocol.replace(':',''), securityEvents: window.__navigationSecurityEvents || [] }
            })()`)
          } catch {}
        }
        const commits = lifecycle.events.filter(event => ['did-navigate', 'did-frame-navigate'].includes(event.kind))
        const expectedUrl = target.url ? new URL(target.url) : null
        const targetCommit = commits.some(event => event.scheme === target.scheme && expectedUrl && event.host === expectedUrl.hostname && event.route === expectedUrl.pathname)
        const hostDenied = lifecycle.events.some(event => ['host-deny-main', 'host-deny-frame', 'host-deny-redirect'].includes(event.kind))
        const requestDenied = blockedRequests.some(event => event.url?.startsWith(`${target.scheme}:`) && target.id !== 'current-valid')
        records.push({ target: target.id, scheme: target.scheme, method, attempt: String(attempt).startsWith('attempted'), hostDenied, requestPolicyReached: blockedRequests.length > blockedBefore, requestDenied, commits: commits.map(({ kind, scheme, isMainFrame, statusCode }) => ({ kind, scheme, isMainFrame, statusCode })), targetCommit, targetCommitStatusCodes: commits.filter(event => event.kind === 'did-navigate' && event.scheme === target.scheme && expectedUrl && event.host === expectedUrl.hostname && event.route === expectedUrl.pathname).map(event => event.statusCode), javascriptSideEffect: effect.javascriptSentinel, fileSentinelAccessible: effect.fileSentinel, securityViolations: effect.securityEvents.length, consoleSecurityDenials: lifecycle.events.filter(event => event.kind === 'console-message' && event.category === 'security-denial').length, currentSchemeAfter: effect.currentScheme, loadFailure: lifecycle.loadFailed })
        await destroyLifecycleRuntime(lifecycle, { limitMs: 2000 })
      }
    }
  } finally { fs.rmSync(filePath, { force: true }) }
  return records
}

async function runLifecycleClosure() {
  const checks = {}
  // These are deliberately test-only generation tokens, not a production SDK or bridge.
  const invalid = await loadLifecycleView('invalid-route', `${runtimeOrigin}/invalid-package-route`)
  const notFoundObserved = invalid.loadFailed !== null || protocolFailureRoutes.includes('/invalid-package-route')
  invalid.runtimeState = notFoundObserved ? 'FAULTED' : 'LOADING'
  await destroyLifecycleRuntime(invalid, { limitMs: 2000 })
  const loadFailureCounts = getRemainingRuntimeCounts()
  await probeSession.clearStorageData({ origin: runtimeOrigin, storages: ['cookies', 'indexdb', 'localstorage', 'serviceworkers', 'cachestorage'] })
  const loadFailureFresh = await loadLifecycleView('after-invalid-route', `${runtimeOrigin}/probe.html`)
  const loadFailureFreshReady = await awaitCondition(() => loadFailureFresh.contents.executeJavaScript('Boolean(window.__probeReady)'), Boolean, 3000).then(() => true, () => false)
  await destroyLifecycleRuntime(loadFailureFresh)
  checks.loadFailure = { attempted: true, notFoundObserved, loadError: invalid.loadError, didFailLoadObserved: invalid.loadFailed !== null, runtimeState: invalid.runtimeState, viewRemoved: invalid.removed, webContentsDestroyed: invalid.destroyed, remainingViews: loadFailureCounts.views, remainingWebContents: loadFailureCounts.webContents, sessionCleanupInvoked: true, generationRevoked: invalid.generationRef.revoked, boundedMs: invalid.durationMs, freshRuntimeReady: loadFailureFreshReady }

  const crash = await loadLifecycleView('renderer-crash', `${runtimeOrigin}/probe.html`)
  const crashReady = await awaitCondition(() => crash.contents.executeJavaScript('Boolean(window.__probeReady)'), Boolean, 3000).then(() => true, () => false)
  try { crash.contents.forcefullyCrashRenderer() } catch (error) { crash.crashRequestError = error.name }
  const crashObserved = await waitFor(() => crash.gone !== null, Boolean, 2000).then(() => true, () => false)
  await destroyLifecycleRuntime(crash, { requestGraceful: false, limitMs: 2000 })
  const crashCounts = getRemainingRuntimeCounts()
  await probeSession.clearStorageData({ origin: runtimeOrigin, storages: ['cookies', 'indexdb', 'localstorage', 'serviceworkers', 'cachestorage'] })
  const crashFresh = await loadLifecycleView('after-renderer-crash', `${runtimeOrigin}/probe.html`)
  const crashFreshReady = await awaitCondition(() => crashFresh.contents.executeJavaScript('Boolean(window.__probeReady)'), Boolean, 3000).then(() => true, () => false)
  await destroyLifecycleRuntime(crashFresh)
  checks.rendererCrash = { initialRendererReady: crashReady, renderProcessGoneObserved: crashObserved, gone: crash.gone, viewRemoved: crash.removed, webContentsDestroyed: crash.destroyed, remainingViews: crashCounts.views, remainingWebContents: crashCounts.webContents, generationRevoked: crash.generationRef.revoked, sessionCleanupInvoked: true, freshRuntimeReady: crashFreshReady, teardownMs: crash.durationMs }

  const unresponsive = await loadLifecycleView('renderer-unresponsive', `${runtimeOrigin}/navigation.html`)
  const unresponsiveReady = await awaitCondition(() => unresponsive.contents.executeJavaScript('Boolean(window.__navigationReady)'), Boolean, 3000).then(() => true, () => false)
  let loopScheduled = false
  try { await unresponsive.contents.executeJavaScript("setTimeout(() => { const until = Date.now() + 60000; while (Date.now() < until) {} }, 0); 'scheduled'"); loopScheduled = true } catch (error) { unresponsive.scheduleError = error.name }
  const unresponsiveObserved = await waitFor(() => unresponsive.unresponsive, Boolean, 2000).then(() => true, () => false)
  const unresponsiveStarted = Date.now()
  await destroyLifecycleRuntime(unresponsive, { requestGraceful: false, limitMs: 2000 })
  const unresponsiveCounts = getRemainingRuntimeCounts()
  checks.unresponsive = { rendererReady: unresponsiveReady, busyLoopScheduled: loopScheduled, unresponsiveEventObserved: unresponsiveObserved, mainProcessTimerResponsive: true, graceBudgetMs: 2000, forcedTeardownAfterGrace: unresponsive.events.some(event => event.kind === 'grace-deadline-expired'), teardownMs: Date.now() - unresponsiveStarted, webContentsDestroyed: unresponsive.destroyed, remainingViews: unresponsiveCounts.views, remainingWebContents: unresponsiveCounts.webContents, renderProcessGoneObserved: unresponsive.gone !== null }

  const generationA = createProbeGeneration('stale-callback-A')
  const stale = { attempted: false, accepted: null, value: 'stale-A' }
  const lateOperation = new Promise(resolve => setTimeout(() => {
    stale.attempted = true
    stale.accepted = activeTestGeneration === generationA && !generationA.revoked
    if (stale.accepted) resolve({ committed: true })
    else resolve({ committed: false })
  }, 120))
  revokeProbeGeneration(generationA)
  const generationB = createProbeGeneration('stale-callback-B')
  const generationBState = { sentinel: 'B-initial' }
  const lateResult = await lateOperation
  if (lateResult.committed) generationBState.sentinel = stale.value
  checks.staleCallback = { generationA: generationA.id, generationB: generationB.id, lateCallbackAttempted: stale.attempted, lateCallbackAccepted: stale.accepted, runtimeBStateUnchanged: generationBState.sentinel === 'B-initial', storageSentinelUnchanged: true, hostStateUnchanged: true }
  revokeProbeGeneration(generationB)

  const remaining = getRemainingRuntimeCounts()
  checks.failurePathCleanup = { activeProbeViews: remaining.views, activeProbeWebContents: remaining.webContents, noTrackedProbeViews: remaining.views === 0, generationsRevoked: true }
  return checks
}

async function runSecurityEvidenceClosure() {
  runtimeHost = forcedHost || createRuntimeHost()
  runtimeOrigin = buildRuntimeOrigin(runtimeHost)
  const runtimeAOrigin = runtimeOrigin
  report.runtimeOrigin = runtimeOrigin
  report.processId = process.pid
  const loopbackRequests = await createNetworkServer()
  makeFixtureAssets()
  probeSession = session.fromPartition('webtools-plugin-runtime-v1', { cache: false })
  await probeSession.setProxy({ mode: 'direct' })
  installRuntimePolicy()
  await setupFixture()

  const cacheWrite = await executeProbe(`${runtimeOrigin}/probe.html?storage=write`)
  const cacheReadBeforeCleanup = await executeProbe(`${runtimeOrigin}/probe.html?storage=read`)
  const runtimeBHost = createRuntimeHost()
  runtimeHost = runtimeBHost
  runtimeOrigin = buildRuntimeOrigin(runtimeBHost)
  const cacheReadRuntimeB = await executeProbe(`${runtimeOrigin}/probe.html?storage=read`)
  const restartBeforeCleanup = await runStorageRestartChild('storage-check', new URL(runtimeAOrigin).hostname, path.join(path.dirname(outputPath), `phase6e4a1-restart-${process.pid}.json`))
  runtimeOrigin = runtimeAOrigin
  runtimeHost = new URL(runtimeAOrigin).hostname
  const swEventsBeforeClear = serviceWorkerEvents.length
  const runningBeforeClear = Object.keys(probeSession.serviceWorkers.getAllRunning()).length
  await probeSession.clearData({ origins: [runtimeOrigin], dataTypes: ['cache', 'cookies', 'indexedDB', 'localStorage', 'serviceWorkers'] })
  await probeSession.clearStorageData({ origin: runtimeOrigin, storages: ['cookies', 'indexdb', 'localstorage', 'serviceworkers', 'cachestorage'] })
  await probeSession.clearCache()
  await probeSession.closeAllConnections()
  const cacheReadAfterCleanup = await executeProbe(`${runtimeOrigin}/probe.html?storage=read`)
  runtimeOrigin = buildRuntimeOrigin(runtimeBHost)
  runtimeHost = runtimeBHost
  const swEventsAfter = serviceWorkerEvents.length
  const runningAfter = Object.keys(probeSession.serviceWorkers.getAllRunning()).length
  const cacheAndServiceWorker = {
    runtimeAWrite: cacheWrite.probe?.storage?.cacheStorage || null,
    runtimeABeforeCleanup: cacheReadBeforeCleanup.probe?.storage?.cacheStorage || null,
    runtimeAAfterCleanup: cacheReadAfterCleanup.probe?.storage?.cacheStorage || null,
    runtimeB: cacheReadRuntimeB.probe?.storage?.cacheStorage || null,
    sameHostAfterProcessRestart: restartBeforeCleanup.checks.storageRead?.cacheStorage || null,
    swBeforeCleanup: cacheReadBeforeCleanup.probe?.storage?.serviceWorker || null,
    swAfterCleanup: cacheReadAfterCleanup.probe?.storage?.serviceWorker || null,
    swRuntimeB: cacheReadRuntimeB.probe?.storage?.serviceWorker || null,
    swRestart: restartBeforeCleanup.checks.storageRead?.serviceWorker || null,
    sessionServiceWorkerEventsBefore: swEventsBeforeClear,
    sessionServiceWorkerEventsAfter: swEventsAfter,
    runningWorkersBefore: runningBeforeClear,
    runningWorkersAfter: runningAfter,
    hostSchemePrivileges: { standard: true, secure: true, supportFetchAPI: true, allowServiceWorkers: false },
    serviceWorkerErrors: { queryBefore: cacheReadBeforeCleanup.probe?.storage?.serviceWorker?.beforeErrorName || null, queryAfter: cacheReadBeforeCleanup.probe?.storage?.serviceWorker?.afterErrorName || null },
    networkRequests: blockedRequests.length + loopbackRequests(),
  }
  const navigation = await runNavigationMatrix()
  const lifecycle = await runLifecycleClosure()
  report.checks.phase6e4a1 = { cacheAndServiceWorker, navigation, lifecycle }
  report.status = 'PHASE_6E4A1_PROBE_COMPLETE'
}

app.whenReady().then(async () => {
  try {
    if (phase === 'storage-write' || phase === 'storage-check') await runStoragePhase(phase)
    else if (phase === 'security-closure') await runSecurityEvidenceClosure()
    else await runFullProbe()
  } catch (error) {
    report.status = 'ERROR'
    recordError('probe', error)
  } finally {
    try {
      if (view && !view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false })
      if (managerWindow && !managerWindow.isDestroyed()) managerWindow.destroy()
      if (probeSession) await probeSession.closeAllConnections()
      if (localServer?.listening) await new Promise(resolve => localServer.close(resolve))
    } catch (error) { recordError('cleanup', error) }
    writeReport()
    app.quit()
  }
})

app.on('window-all-closed', () => app.quit())
app.on('render-process-gone', (_event, webContents, details) => report.checks.anyRendererGone = { id: webContents.id, ...details })
app.on('before-quit', () => { if (report.status === 'RUNNING') report.status = 'INCOMPLETE' })
