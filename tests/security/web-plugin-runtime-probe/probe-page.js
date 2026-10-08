import { dynamicValue } from './dynamic.js'

const result = {
  mainWorld: {},
  packageAssets: {},
  csp: { violations: [] },
  storage: {},
  navigation: {},
  network: {},
}
window.__probe = result
document.addEventListener('securitypolicyviolation', event => {
  result.csp.violations.push({ directive: event.violatedDirective, blocked: event.blockedURI })
})

const globals = ['process', 'require', 'module', 'Buffer', 'ipcRenderer', 'electron', 'fs', 'child_process', 'desktop']
for (const name of globals) {
  try {
    const value = name === 'desktop' ? window.desktop : globalThis[name]
    result.mainWorld[name] = {
      type: typeof value,
      keys: value && (typeof value === 'object' || typeof value === 'function') ? Object.keys(value).slice(0, 20) : [],
      version: name === 'process' && value && typeof value === 'object' ? value.version ?? null : null,
    }
  } catch (error) { result.mainWorld[name] = { type: 'throws', error: String(error) } }
}
result.mainWorld.managerDom = Boolean(window.parent?.document?.getElementById('trusted-manager-dom'))
result.mainWorld.managerState = window.parent?.managerSentinel ?? null
result.mainWorld.managerOpener = window.opener?.managerSentinel ?? null
try { eval('1 + 1'); result.csp.eval = 'allowed' } catch (error) { result.csp.eval = error.name }
try { Function('return 1')(); result.csp.functionConstructor = 'allowed' } catch (error) { result.csp.functionConstructor = error.name }
result.packageAssets.dynamicImport = dynamicValue
result.csp.inlineScript = window.__inlineProbe === true ? 'allowed' : 'blocked'

async function readJson() {
  try { result.packageAssets.json = await (await fetch('./data.json')).json() }
  catch (error) { result.packageAssets.jsonError = String(error) }
}
async function readWasm() {
  try {
    const response = await fetch('./tiny.wasm')
    result.packageAssets.wasmMime = response.headers.get('content-type')
    const bytes = await response.arrayBuffer()
    const instance = await WebAssembly.instantiate(bytes)
    result.packageAssets.wasmMain = instance.instance.exports.main()
  } catch (error) { result.packageAssets.wasmError = error.name }
}
async function storage(mode) {
  const key = 'webtools-probe-sentinel'
  const cacheName = 'phase6e4a1-cache'
  const cacheKeys = [
    'webtools-plugin://cache-sentinel.invalid/probe-key',
    'https://cache-sentinel.invalid/probe-key',
    'http://cache-sentinel.invalid/probe-key',
    'data:text/plain,cache-sentinel',
    'blob:https://cache-sentinel.invalid/00000000-0000-4000-8000-000000000001',
  ]
  const cacheSentinel = 'phase6e4a1-offline-cache-sentinel'
  if (mode === 'write') {
    localStorage.setItem(key, 'runtime-a-only')
    document.cookie = 'probe=runtime-a-only; SameSite=None; Secure; Path=/'
    try {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('phase6e4a', 1)
        request.onupgradeneeded = () => request.result.createObjectStore('kv')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      await new Promise((resolve, reject) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put('runtime-a-only', key); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error) })
      db.close(); result.storage.indexedDbWrite = true
    } catch (error) { result.storage.indexedDbWrite = false; result.storage.indexedDbError = String(error) }
    result.storage.cacheStorage = { apiType: typeof caches, attempts: [] }
    try {
      const cache = await caches.open(cacheName)
      for (const cacheKey of cacheKeys) {
        const attempt = { scheme: new URL(cacheKey).protocol.replace(':', ''), put: false, read: false, errorName: null }
        try {
          await cache.put(new Request(cacheKey), new Response(cacheSentinel, { headers: { 'content-type': 'text/plain' } }))
          attempt.put = true
          const found = await cache.match(new Request(cacheKey))
          attempt.read = (await found?.text()) === cacheSentinel
        } catch (error) { attempt.errorName = error.name }
        result.storage.cacheStorage.attempts.push(attempt)
      }
      result.storage.cacheStorage.readableEntries = await cache.keys().then(keys => keys.length)
    } catch (error) {
      result.storage.cacheStorage.openErrorName = error.name
    }
  } else {
    result.storage.localStorage = localStorage.getItem(key)
    result.storage.cookie = document.cookie
    try {
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open('phase6e4a'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); request.onupgradeneeded = () => { request.transaction.abort() } })
      result.storage.indexedDb = await new Promise((resolve, reject) => { const req = db.transaction('kv').objectStore('kv').get(key); req.onsuccess = () => resolve(req.result ?? null); req.onerror = () => reject(req.error) }); db.close()
    } catch (error) { result.storage.indexedDb = null; result.storage.indexedDbError = error.name }
    try {
      const cache = await caches.open(cacheName)
      result.storage.cacheStorage = {
        apiType: typeof caches,
        readableEntries: await cache.keys().then(keys => keys.length),
        attempts: [],
      }
      for (const cacheKey of cacheKeys) {
        try {
          const found = await cache.match(new Request(cacheKey))
          result.storage.cacheStorage.attempts.push({ scheme: new URL(cacheKey).protocol.replace(':', ''), found: Boolean(found), sentinel: found ? (await found.text()) === cacheSentinel : false })
        } catch (error) { result.storage.cacheStorage.attempts.push({ scheme: new URL(cacheKey).protocol.replace(':', ''), errorName: error.name }) }
      }
    } catch (error) { result.storage.cacheStorage = { apiType: typeof caches, openErrorName: error.name } }
    try {
      result.storage.serviceWorker = {
        apiType: typeof navigator.serviceWorker,
        controller: navigator.serviceWorker?.controller ? 'present' : null,
        before: navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : null,
      }
    } catch (error) { result.storage.serviceWorker = { apiType: typeof navigator.serviceWorker, beforeErrorName: error.name } }
  }
}

async function probe() {
  await readJson()
  await readWasm()
  result.packageAssets.cssLoaded = [...document.styleSheets].some(sheet => { try { return sheet.href?.endsWith('/style.css') } catch { return false } })
  result.packageAssets.imageLoaded = await new Promise(resolve => { const image = new Image(); image.onload = () => resolve(true); image.onerror = () => resolve(false); image.src = './pixel.png' })
  try { const font = await fetch('./test-font.woff2'); result.packageAssets.fontMime = font.headers.get('content-type'); result.packageAssets.fontServed = font.ok }
  catch (error) { result.packageAssets.fontError = String(error) }
  const mode = new URL(location.href).searchParams.get('storage')
  if (mode === 'write' || mode === 'read') await storage(mode)
  if (mode === 'read') {
    const registrationsBefore = result.storage.serviceWorker?.before
    const sw = result.storage.serviceWorker || { apiType: typeof navigator.serviceWorker }
    sw.registrationAttempts = []
    if (navigator.serviceWorker) {
      for (const [name, script, options] of [
        ['package-local-default', './worker.js', undefined],
        ['package-local-explicit-scope', './worker.js', { scope: './subscope/' }],
      ]) {
        try {
          const registration = await Promise.race([
            navigator.serviceWorker.register(script, options),
            new Promise((_, reject) => setTimeout(() => reject(new Error('probe-timeout')), 1500)),
          ])
          sw.registrationAttempts.push({ name, outcome: 'resolved', active: Boolean(registration.active), installing: Boolean(registration.installing), waiting: Boolean(registration.waiting) })
        } catch (error) { sw.registrationAttempts.push({ name, outcome: 'rejected', errorName: error.name }) }
      }
      try {
        sw.registrationsAfter = (await navigator.serviceWorker.getRegistrations()).length
        sw.controllerAfter = navigator.serviceWorker.controller ? 'present' : null
      } catch (error) { sw.afterErrorName = error.name }
      try { await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('probe-timeout')), 500))]); sw.ready = 'resolved' }
      catch (error) { sw.ready = error.message === 'probe-timeout' ? 'timeout' : error.name }
    } else {
      sw.registrationAttempts = [{ name: 'package-local-default', outcome: 'api-unavailable' }, { name: 'package-local-explicit-scope', outcome: 'api-unavailable' }]
      sw.registrationsAfter = null
      sw.controllerAfter = null
      sw.ready = 'api-unavailable'
    }
    sw.before = registrationsBefore ?? null
    result.storage.serviceWorker = sw
  }
  result.navigation.origin = location.origin
  result.navigation.protocol = location.protocol
  result.navigation.normalizedDotSegment = new URL('/runtime/../probe.html', location.origin).pathname
  result.navigation.uppercaseOriginHost = new URL(location.origin.toUpperCase() + '/probe.html').host
  window.__probeReady = true
}

probe().catch(error => { result.fatal = String(error); window.__probeReady = true })
