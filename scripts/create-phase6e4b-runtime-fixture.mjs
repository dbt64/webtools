import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { png, webManifest, webPackage } from '../electron/plugins/fixtures.mjs'

function option(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const output = option('--output')
if (!output || !isAbsolute(output) || basename(output).toLowerCase() !== 'phase6e4b-runtime-fixture.wtplugin') {
  throw new Error('Pass --output with an absolute TEMP path ending in phase6e4b-runtime-fixture.wtplugin.')
}
const root = resolve(tmpdir())
const directory = resolve(dirname(output))
const fromTemp = relative(root, directory)
if (!fromTemp || fromTemp === '..' || fromTemp.startsWith(`..${sep}`) || isAbsolute(fromTemp)) {
  throw new Error('The fixture must be written below the system temporary directory, outside the temporary root itself.')
}

const manifest = webManifest({
  id: 'org.webtools.phase6e4b.runtime-test',
  name: 'Phase 6E-4B Offline Runtime Fixture',
  description: 'Automated/manual acceptance fixture; not a shipping plugin.',
  version: '1.0.0',
  features: [
    { id: 'offline-demo', title: 'Offline Runtime Demo', entry: { kind: 'web-bundle', document: 'web/index.html' } },
    { id: 'offline-demo-wasm', title: 'Offline Runtime WASM Check', entry: { kind: 'web-bundle', document: 'web/wasm.html' }, executionRequirements: { wasm: true } },
    { id: 'offline-demo-delayed', title: 'Offline Runtime Loading Check', entry: { kind: 'web-bundle', document: 'web/delayed.html' } },
  ],
  webBundle: { files: [
    { path: 'web/index.html', mediaType: 'text/html' },
    { path: 'web/wasm.html', mediaType: 'text/html' },
    { path: 'web/delayed.html', mediaType: 'text/html' },
    { path: 'web/app.js', mediaType: 'text/javascript' },
    { path: 'web/dynamic.js', mediaType: 'text/javascript' },
    { path: 'web/style.css', mediaType: 'text/css' },
    { path: 'web/download.json', mediaType: 'application/json' },
    { path: 'web/empty.wasm', mediaType: 'application/wasm' },
  ] },
  assets: [{ path: 'assets/pixel.png', mediaType: 'image/png' }],
})

const files = [
  { name: 'web/index.html', data: '<!doctype html><html><head><meta charset="utf-8"><title>Offline Web Feature</title><link rel="stylesheet" href="./style.css"><script>window.__gate1InlineScriptRan = true</script></head><body><main><h1>Offline Web Feature</h1><img alt="local package asset" src="../assets/pixel.png"><p id="status">Loading local modules…</p><pre id="results"></pre><script type="module" src="./app.js"></script></main></body></html>' },
  { name: 'web/wasm.html', data: '<!doctype html><html><head><meta charset="utf-8"><title>Offline Web Feature WASM</title><link rel="stylesheet" href="./style.css"></head><body><main><h1>Offline Web Feature WASM</h1><img alt="local package asset" src="../assets/pixel.png"><p id="status">Loading local modules…</p><pre id="results"></pre><script type="module" src="./app.js"></script></main></body></html>' },
  { name: 'web/delayed.html', data: '<!doctype html><html><head><meta charset="utf-8"><title>Delayed Offline Web Feature</title></head><body><main><p id="status">Loading is intentionally held by the acceptance protocol handler</p></main></body></html>' },
  { name: 'web/app.js', data: `const status = document.querySelector('#status');
const results = document.querySelector('#results');
const evidence = { process: typeof process, require: typeof require, module: typeof module, Buffer: typeof Buffer, ipcRenderer: typeof ipcRenderer, electron: typeof electron, desktopBridge: typeof window.desktop, windowRequire: typeof window.require, managerDom: Boolean(document.querySelector('[data-manager-shell]')), runtimeHost: location.host, storageBefore: localStorage.getItem('phase6e4b-transient'), inlineScript: window.__gate1InlineScriptRan === true };
localStorage.setItem('phase6e4b-transient', 'must be cleared');
document.cookie = 'phase6e4c=must-be-cleared; path=/; SameSite=Strict';
evidence.cookieWrite = document.cookie.includes('phase6e4c=must-be-cleared');
const indexedDbWrite = await new Promise(resolve => { const request = indexedDB.open('phase6e4c', 1); request.onupgradeneeded = () => request.result.createObjectStore('probe'); request.onerror = () => resolve(false); request.onsuccess = () => { const transaction = request.result.transaction('probe', 'readwrite'); transaction.objectStore('probe').put('must be cleared', 'sentinel'); transaction.oncomplete = () => { request.result.close(); resolve(true); }; transaction.onerror = () => resolve(false); }; });
evidence.indexedDbWrite = indexedDbWrite;
const cacheWrite = await caches.open('phase6e4c').then(cache => cache.put(new Request(location.href), new Response('must be cleared'))).then(() => ({ ok: true }), error => ({ ok: false, error: (error?.name || 'Error') + ':' + String(error?.message || '').slice(0, 160) }));
evidence.cacheWrite = cacheWrite;
evidence.imageLoaded = await new Promise(resolve => { const image = document.querySelector('img'); if (image.complete) resolve(image.naturalWidth > 0); else { image.addEventListener('load', () => resolve(true), { once: true }); image.addEventListener('error', () => resolve(false), { once: true }); } });
try { eval('1'); evidence.javascriptEval = 'allowed'; } catch { evidence.javascriptEval = 'blocked'; }
try { evidence.functionConstructor = new Function('return 1')() === 1 ? 'allowed' : 'unexpected'; } catch { evidence.functionConstructor = 'blocked'; }
try { const response = await fetch('https://example.invalid/phase6e4b-probe'); evidence.remoteFetch = response.ok ? 'allowed' : 'response'; } catch { evidence.remoteFetch = 'blocked'; }
try { const response = await fetch(window.__gate1SinkUrl); evidence.loopbackFetch = response.ok ? 'allowed' : 'response'; } catch { evidence.loopbackFetch = 'blocked'; }
try { evidence.popup = window.open('https://example.invalid/phase6e4b-popup') === null ? 'denied' : 'opened'; } catch { evidence.popup = 'denied'; }
try { evidence.remoteDynamicImport = await import('https://example.invalid/phase6e4b-module').then(() => 'allowed', () => 'blocked'); } catch { evidence.remoteDynamicImport = 'blocked'; }
try { const local = await import('./dynamic.js'); evidence.dynamicImport = local.value; } catch { evidence.dynamicImport = 'failed'; }
const minimalWasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
try { await WebAssembly.compile(minimalWasm); evidence.wasmCompile = 'allowed'; } catch { evidence.wasmCompile = 'blocked'; }
try { await navigator.serviceWorker.register('./worker.js'); evidence.serviceWorker = 'allowed'; } catch { evidence.serviceWorker = 'blocked'; }
evidence.notificationPermission = await Notification.requestPermission().catch(() => 'denied');
evidence.geolocationPermission = await new Promise(resolve => navigator.geolocation.getCurrentPosition(() => resolve('allowed'), () => resolve('denied'), { timeout: 2000 }));
const download = document.createElement('a'); download.href = './download.json'; download.download = 'phase6e4c.json'; download.click();
window.__gate1Run = async () => {
  const host = location.host;
  const candidates = [
    '/web/unknown.js', '/web/%2e%2e/manifest.json', '/web/%252e%252e/manifest.json',
    '/web%2fapp.js', '/web%5capp.js', '/web//app.js', '/web/./app.js',
    '/web/app.js?query=1', '/web/app.js#fragment', '/web/%00app.js',
  ];
  const protocolResults = [];
  for (const path of candidates) {
    try { const response = await fetch('webtools-plugin://' + host + path, { cache: 'no-store' }); protocolResults.push({ path, status: response.status }); }
    catch { protocolResults.push({ path, status: 'blocked' }); }
  }
  try { await fetch('webtools-plugin://' + 'f'.repeat(32) + '/web/app.js'); protocolResults.push({ path: 'forged-origin', status: 'unexpected' }); }
  catch { protocolResults.push({ path: 'forged-origin', status: 'blocked' }); }
  return protocolResults;
};
status.textContent = 'Local package content loaded';
results.textContent = JSON.stringify(evidence, null, 2);
` },
  { name: 'web/dynamic.js', data: 'export const value = "same-origin dynamic import loaded";' },
  { name: 'web/download.json', data: '{"download":"denial fixture"}' },
  { name: 'web/empty.wasm', data: Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]) },
  { name: 'web/style.css', data: 'body { margin: 0; padding: 24px; color: #e8eef7; background: #141a22; font: 14px system-ui, sans-serif; } main { max-width: 760px; margin: 0 auto; } img { width: 24px; height: 24px; } pre { padding: 16px; border-radius: 8px; background: #202a36; white-space: pre-wrap; }' },
  { name: 'assets/pixel.png', data: png() },
]

await mkdir(directory, { recursive: true })
const sinkUrl = option('--sink-url') ?? 'http://127.0.0.1:9/phase6e4c-sink'
files.find(file => file.name === 'web/app.js').data = `window.__gate1SinkUrl = ${JSON.stringify(sinkUrl)};\n${files.find(file => file.name === 'web/app.js').data}`
await writeFile(output, webPackage(manifest, files))
console.log(`Created controlled Phase 6E-4B fixture: ${resolve(output)}`)
