import { copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const args = new Map()
for (let index = 2; index < process.argv.length; index += 2) {
  if (!process.argv[index]?.startsWith('--') || !process.argv[index + 1]) throw new Error('Expected --name value arguments.')
  args.set(process.argv[index].slice(2), process.argv[index + 1])
}
const root = resolve(required('root'))
const port = Number(required('http-port'))
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('The fixture HTTP port is invalid.')
const tempRoot = resolve(tmpdir())
if (!inside(tempRoot, root) || root === tempRoot) throw new Error('Fixture output root must be a strict TEMP descendant.')
const sdkTarball = await canonicalFile(required('sdk-tarball'))
const addonBinary = await canonicalFile(required('native-addon'))
const helperBinary = await canonicalFile(required('helper'))
const supportDll = await canonicalFile(required('support-dll'))
const developer = join(root, 'external-plugin-author')
const fixtureDir = join(root, 'fixtures')
await mkdir(developer, { recursive: true }); await mkdir(fixtureDir, { recursive: true })

await write(developer, 'package.json', {
  name: 'plugin-runtime-authoring-fixture', version: '1.0.0', private: true, type: 'module',
  scripts: {
    'build:vanilla': 'vite build --config frameworks/vanilla/vite.config.mjs',
    'build:vue': 'vite build --config frameworks/vue/vite.config.mjs',
    'build:react': 'vite build --config frameworks/react/vite.config.mjs',
    'build:svelte': 'vite build --config frameworks/svelte/vite.config.mjs',
    'build:node': 'vite build --config runtime/node/vite.config.mjs',
  },
  dependencies: {
    axios: '1.20.0', yauzl: '3.4.0',
    '@webtools/runtime-native-addon': 'file:./dist/webtools-runtime-native-addon-1.0.0.tgz',
    'runtime-cjs-fixture': 'file:./dist/runtime-cjs-fixture-1.0.0.tgz',
  },
  devDependencies: {
    '@webtools/plugin-sdk': `file:${sdkTarball}`,
    vite: '8.3.4', vue: '3.5.43', '@vitejs/plugin-vue': '6.0.9',
    react: '19.3.0', 'react-dom': '19.3.0', '@vitejs/plugin-react': '6.1.2',
    svelte: '5.57.2', '@sveltejs/vite-plugin-svelte': '7.3.1',
  },
})
await mkdir(join(developer, 'dist'), { recursive: true })
await mkdir(join(developer, 'native-addon', 'build', 'Release'), { recursive: true })
await write(developer, 'native-addon/package.json', { name: '@webtools/runtime-native-addon', version: '1.0.0', main: 'index.cjs', exports: { '.': './index.cjs' }, files: ['index.cjs', 'build/Release/native_fixture.node'] })
await write(developer, 'native-addon/index.cjs', "module.exports = require('./build/Release/native_fixture.node')\n")
await copyFile(addonBinary, join(developer, 'native-addon', 'build', 'Release', 'native_fixture.node'))
await runPnpm(['pack', '--pack-destination', join(developer, 'dist')], join(developer, 'native-addon'))

await mkdir(join(developer, 'cjs-fixture'), { recursive: true })
await write(developer, 'cjs-fixture/package.json', { name: 'runtime-cjs-fixture', version: '1.0.0', main: 'index.cjs', exports: { '.': './index.cjs' }, files: ['index.cjs', 'data.json'] })
await write(developer, 'cjs-fixture/data.json', { format: 'json-exported-by-commonjs-fixture', value: 27 })
await write(developer, 'cjs-fixture/index.cjs', "const data = require('./data.json'); module.exports = { kind: 'commonjs', data }\n")
await runPnpm(['pack', '--pack-destination', join(developer, 'dist')], join(developer, 'cjs-fixture'))

await runPnpm(['install', '--ignore-scripts', '--no-frozen-lockfile'], developer)

for (const framework of ['vanilla', 'vue', 'react', 'svelte']) {
  const base = join(developer, 'frameworks', framework)
  await mkdir(join(base, 'public'), { recursive: true }); await mkdir(join(base, 'src'), { recursive: true })
  const viteBase = `/runtime/${framework}/`
  await write(base, 'vite.config.mjs', viteConfig(framework))
  await write(base, 'index.html', `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${framework}</title></head><body><div id="app"><pre id="result">waiting</pre></div><script type="module" src="/src/main.js"></script></body></html>\n`)
  await write(base, 'public/worker.js', "self.postMessage({ kind: 'dedicated-worker', value: 11 })\n")
  await write(base, 'public/module-worker.js', "self.postMessage({ kind: 'module-worker', value: 13 })\n")
  await write(base, 'public/pixel.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p1sAAAAASUVORK5CYII=', 'base64'))
  await write(base, 'public/fixture.wasm', Buffer.from('0061736d010000000105016000017f03020100070701036f6e6500000a06010400412a0b', 'hex'))
  await write(base, 'src/style.css', '#app:has([data-framework]) { color: color-mix(in srgb, #fff 80%, #18a); }\n')
  await write(base, 'src/main.js', framework === 'vanilla' ? vanillaMain(port) : frameworkMain(framework))
  if (framework === 'vue') {
    await write(base, 'src/App.vue', `<template><main data-framework="vue"><h1>Vue Runtime 2.0</h1><p>{{ status }}</p></main></template><script setup>import { ref, onMounted } from 'vue'; import { connectWebTools } from '@webtools/plugin-sdk/web'; const status=ref('loading'); onMounted(async()=>{ const api=connectWebTools(); await api.ready; await api.storage.set('framework-vue',{ok:true}); const response=await fetch('http://127.0.0.1:${port}/cors'); status.value=response.ok?'framework-pass':'network-failed'; document.documentElement.dataset.framework='vue'; });</script><style>@import './style.css';</style>\n`)
    await write(base, 'src/main.js', "import { createApp } from 'vue'; import App from './App.vue'; import './style.css'; createApp(App).mount('#app');\n")
  }
  if (framework === 'react') await write(base, 'src/main.js', `import React from 'react'; import {createRoot} from 'react-dom/client'; import {connectWebTools} from '@webtools/plugin-sdk/web'; import './style.css'; function App(){const [status,setStatus]=React.useState('loading'); React.useEffect(()=>{(async()=>{const api=connectWebTools(); await api.ready; await api.storage.set('framework-react',{ok:true}); const response=await fetch('http://127.0.0.1:${port}/cors'); setStatus(response.ok?'framework-pass':'network-failed'); document.documentElement.dataset.framework='react'})() },[]); return React.createElement('main',{'data-framework':'react'},React.createElement('h1',null,'React Runtime 2.0'),React.createElement('p',null,status))}; createRoot(document.getElementById('app')).render(React.createElement(App));\n`)
  if (framework === 'svelte') {
    await write(base, 'src/App.svelte', `<script>import {onMount} from 'svelte'; import {connectWebTools} from '@webtools/plugin-sdk/web'; let status='loading'; onMount(async()=>{const api=connectWebTools(); await api.ready; await api.storage.set('framework-svelte',{ok:true}); const response=await fetch('http://127.0.0.1:${port}/cors'); status=response.ok?'framework-pass':'network-failed'; document.documentElement.dataset.framework='svelte'});</script><main data-framework="svelte"><h1>Svelte Runtime 2.0</h1><p>{status}</p></main><style>@import './style.css';</style>\n`)
    await write(base, 'src/main.js', "import { mount } from 'svelte'; import App from './App.svelte'; mount(App,{target:document.getElementById('app')});\n")
  }
  await write(base, 'src/style.css', `@import "./fixture.css";\n`)
  await write(base, 'src/fixture.css', `@supports (color: color-mix(in srgb, white, black)) { #app:has([data-framework]) { color: color-mix(in srgb, #fff 80%, #18a); } }\n`)
  await write(base, 'vite.config.mjs', viteConfig(framework, viteBase))
}
for (const framework of ['vanilla', 'vue', 'react', 'svelte']) {
  await runPnpm(['run', `build:${framework}`], developer)
}
await mkdir(join(developer, 'runtime', 'node'), { recursive: true })
await mkdir(join(developer, 'runtime', 'resources'), { recursive: true })
await mkdir(join(developer, 'runtime', 'preload'), { recursive: true })
await copyFile(helperBinary, join(developer, 'runtime', 'resources', 'helper.exe'))
await copyFile(supportDll, join(developer, 'runtime', 'resources', 'support.dll'))
await write(developer, 'runtime/node/index.html', '<!doctype html><html><head><meta charset="UTF-8"><title>Node Runtime</title></head><body><main><h1>Node Plugin Runtime 2.0</h1><button id="run" type="button">Run Node and Host API probes</button><button id="clipboard" type="button">Test clipboard capability</button><pre id="result">waiting</pre></main><script type="module" src="./main.js"></script></body></html>\n')
  await write(developer, 'runtime/node/main.js', `import {connectWebTools} from '@webtools/plugin-sdk/web'; const api=connectWebTools(); const report={ready:false}; window.__pluginRuntimeReport=report; const render=()=>{document.querySelector('#result').textContent=JSON.stringify(report)}; api.ready.then(()=>{report.ready=true; document.documentElement.dataset.runtime='node-page-ready'; document.querySelector('#result').textContent='ready'}).catch(error=>{report.readyError=error.code||error.message}); document.querySelector('#run').addEventListener('click',async()=>{try{report.previousRuntimeClosed=localStorage.getItem('plugin-runtime-closed'); report.hostStorageBefore=await api.storage.get('e2e'); await api.storage.set('e2e',{marker:'runtime-2',stored:true}); report.hostStorageAfter=await api.storage.get('e2e'); report.context=await api.context.current(); report.native=await window.runtimeNode.run(); report.native.nodeIntegrationPage=typeof process==='undefined'&&typeof window.process==='undefined'&&typeof window.require==='undefined'; report.ai=await api.ai?.complete({prompt:'local acceptance'}); report.hostApiPassed=report.hostStorageAfter?.marker==='runtime-2'&&report.native?.nativeAddon==='native-addon-loaded'; }catch(error){report.error=error.code||error.message} render();}); document.querySelector('#clipboard').addEventListener('click',async()=>{try{await api.clipboard?.writeText('runtime-local-acceptance'); report.clipboard=true;}catch(error){report.error=error.code||error.message} render();}); api.onClose(()=>{localStorage.setItem('plugin-runtime-closed','yes')});`)
const nodePreloadPath = join(developer, 'runtime', 'preload', 'preload.cjs')
await write(developer, 'runtime/preload/preload.cjs', nodePreload(port))
const preloadSyntax = spawnSync(process.execPath, ['--check', nodePreloadPath], { encoding: 'utf8', windowsHide: true })
if (preloadSyntax.status !== 0) throw new Error(`Generated Node runtime preload failed syntax validation.\n${preloadSyntax.stdout}\n${preloadSyntax.stderr}`)
console.log('Generated Node runtime preload syntax: PASS')
await write(developer, 'runtime/node/vite.config.mjs', nodeRuntimeViteConfig())
await runPnpm(['run', 'build:node'], developer)

for (const version of ['1.0.0', '2.0.0']) {
  const manifest = await makeManifest(version, 'node', developer, port)
  await write(developer, 'manifest.json', manifest)
  const output = join(fixtureDir, version === '1.0.0' ? 'plugin-runtime-fixture.wtplugin' : 'plugin-runtime-update.wtplugin')
  await runPnpm(['exec', 'webtools-plugin', 'pack', '.', '--out', output, '--host-version', '0.1.0'], developer)
  await runPnpm(['exec', 'webtools-plugin', 'validate', output, '--host-version', '0.1.0'], developer)
}

const isolationRoot = join(root, 'isolation-source')
await mkdir(isolationRoot, { recursive: true })
await write(isolationRoot, 'package.json', JSON.parse(await readFile(join(developer, 'package.json'), 'utf8')))
// A distinct standard-Web identity with the same packaged frontend, used to prove per-origin storage separation.
await copyTree(join(developer, 'runtime', 'vanilla'), join(isolationRoot, 'runtime', 'vanilla'))
await write(isolationRoot, 'manifest.json', await makeManifest('1.0.0', 'web', isolationRoot, port, {
  id: 'org.webtools.acceptance.runtime-isolation', name: 'Plugin Runtime Isolation Fixture', frameworks: ['vanilla'],
}))
const isolationOutput = join(fixtureDir, 'plugin-runtime-isolation.wtplugin')
await runPnpm(['exec', 'webtools-plugin', 'pack', isolationRoot, '--out', isolationOutput, '--host-version', '0.1.0'], developer)
await runPnpm(['exec', 'webtools-plugin', 'validate', isolationOutput, '--host-version', '0.1.0'], developer)

const summaries = []
for (const filename of ['plugin-runtime-fixture.wtplugin', 'plugin-runtime-update.wtplugin', 'plugin-runtime-isolation.wtplugin']) {
  const path = join(fixtureDir, filename)
  const { stdout } = runPnpm(['exec', 'webtools-plugin', 'inspect', path, '--host-version', '0.1.0', '--json'], developer, true)
  summaries.push(JSON.parse(stdout).result)
}
console.log(JSON.stringify({ developer, fixtureDir, httpPort: port, packages: summaries }, null, 2))

function required(key) { const value = args.get(key); if (!value) throw new Error(`Missing --${key}.`); return value }
function inside(parent, child) { const rel = relative(parent, child); return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) }
async function canonicalFile(value) { const path = resolve(value); const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink() || await realpath(path) !== path) throw new Error(`Expected canonical regular file: ${path}`); return path }
async function write(base, name, value) { const path = join(base, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, typeof value === 'string' || Buffer.isBuffer(value) ? value : `${JSON.stringify(value, null, 2)}\n`) }
async function copyTree(source, target) { await mkdir(target, { recursive: true }); for (const name of await readdir(source)) { const from = join(source, name); const to = join(target, name); const stat = await lstat(from); if (stat.isSymbolicLink()) throw new Error('Fixture source contains a link.'); if (stat.isDirectory()) await copyTree(from, to); else if (stat.isFile()) await copyFile(from, to); else throw new Error('Fixture source contains a special file.') } }
function runPnpm(pnpmArgs, cwd, returnStdout = false) { const result = spawnSync('pnpm.cmd', pnpmArgs, { cwd, encoding: 'utf8', shell: true, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }); if (result.status !== 0) throw new Error(`pnpm ${pnpmArgs.join(' ')} failed (${result.status}).\n${result.stdout}\n${result.stderr}`); if (!returnStdout) { if (result.stdout) process.stdout.write(result.stdout); if (result.stderr) process.stderr.write(result.stderr) } return result }
function viteConfig(framework, base = `/runtime/${framework}/`) {
  const plugin = framework === 'vanilla' ? '' : framework === 'vue' ? "import vue from '@vitejs/plugin-vue';" : framework === 'react' ? "import react from '@vitejs/plugin-react';" : "import {svelte} from '@sveltejs/vite-plugin-svelte';"
  const plugins = framework === 'vanilla' ? '[]' : framework === 'vue' ? '[vue()]' : framework === 'react' ? '[react()]' : '[svelte()]'
  return `import {defineConfig} from 'vite'; import {fileURLToPath} from 'node:url'; import {dirname,resolve} from 'node:path'; ${plugin} const root=dirname(fileURLToPath(import.meta.url)); export default defineConfig({root,base:'${base}',plugins:${plugins},build:{outDir:resolve(root,'../../runtime/${framework}'),emptyOutDir:true,rollupOptions:{output:{entryFileNames:'assets/[name]-[hash].js',chunkFileNames:'assets/[name]-[hash].js',assetFileNames:'assets/[name]-[hash][extname]'}}}});\n`
}
function nodeRuntimeViteConfig() {
  return `import{defineConfig}from'vite';import{fileURLToPath}from'node:url';import{dirname,resolve}from'node:path';const root=dirname(fileURLToPath(import.meta.url));export default defineConfig({root,base:'/runtime/node-dist/',build:{outDir:resolve(root,'../../runtime/node-dist'),emptyOutDir:true,rollupOptions:{output:{entryFileNames:'assets/[name]-[hash].js',chunkFileNames:'assets/[name]-[hash].js',assetFileNames:'assets/[name]-[hash][extname]'}}}});\n`
}
function vanillaMain(httpPort) {
  return `import axios from 'axios'; import {connectWebTools} from '@webtools/plugin-sdk/web'; import './style.css'; const api=connectWebTools(); const report={framework:'vanilla',checks:{}}; window.__runtimeReport=report; const done=(name,value)=>{report.checks[name]=value; document.querySelector('#result').textContent=JSON.stringify(report)}; const wait=(worker)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('worker timeout')),5000);worker.onmessage=e=>{clearTimeout(timer);resolve(e.data)};worker.onerror=e=>{clearTimeout(timer);reject(new Error(e.message))}}); async function start(){await api.ready; report.hostReady=true; report.context=await api.context.current(); report.pluginStoreBefore=await api.storage.get('web-persist'); await api.storage.set('web-persist',{marker:'persistent-web',value:41}); report.pluginStore=await api.storage.get('web-persist'); const cors=await fetch('http://127.0.0.1:${httpPort}/cors').then(r=>r.json()); report.checks.fetch=cors.value==='cors-ok'; const xhr=await new Promise((resolve,reject)=>{const x=new XMLHttpRequest();x.open('GET','http://127.0.0.1:${httpPort}/xhr');x.onload=()=>resolve(JSON.parse(x.responseText));x.onerror=()=>reject(new Error('xhr error'));x.send()});report.checks.xhr=xhr.value==='xhr-ok'; report.checks.axios=(await axios.get('http://127.0.0.1:${httpPort}/axios')).data.value==='axios-ok'; report.checks.corsDenied=await fetch('http://127.0.0.1:${httpPort}/cors-deny').then(()=>false,()=>true); report.checks.sse=await new Promise((resolve,reject)=>{const e=new EventSource('http://127.0.0.1:${httpPort}/events');const timer=setTimeout(()=>{e.close();reject(new Error('sse timeout'))},5000);e.onmessage=event=>{clearTimeout(timer);e.close();resolve(JSON.parse(event.data).value==='sse-ok')};e.onerror=()=>{clearTimeout(timer);e.close();reject(new Error('sse error'))}}); report.checks.websocket=await new Promise((resolve,reject)=>{const w=new WebSocket('ws://127.0.0.1:${httpPort}/ws');const timer=setTimeout(()=>reject(new Error('websocket timeout')),5000);w.onmessage=e=>{clearTimeout(timer);w.close();resolve(e.data==='websocket-ok')};w.onerror=()=>{clearTimeout(timer);reject(new Error('websocket error'))}}); report.checks.dedicatedWorker=(await wait(new Worker('/runtime/vanilla/worker.js'))).kind==='dedicated-worker'; report.checks.moduleWorker=(await wait(new Worker('/runtime/vanilla/module-worker.js',{type:'module'}))).kind==='module-worker'; report.checks.wasm=(await WebAssembly.instantiateStreaming(fetch('/runtime/vanilla/fixture.wasm'))).instance.exports.one()===42; report.checks.blob=URL.createObjectURL(new Blob(['ok'],{type:'text/plain'})).startsWith('blob:'); report.checks.localAsset=await fetch('/runtime/vanilla/pixel.png').then(r=>r.ok); report.checks.modernCss=CSS.supports('color','color-mix(in srgb, white, black)')&&CSS.supports('selector(:has(*))'); const bad=await fetch('https://example.com/',{mode:'no-cors',signal:AbortSignal.timeout(10000)}).then(r=>r.type==='opaque',()=>false);report.checks.httpsTls=bad;report.previousLocalStorage=localStorage.getItem('runtime-local');localStorage.setItem('runtime-local','persisted');const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('runtime',1);request.onupgradeneeded=()=>request.result.createObjectStore('items');request.onerror=()=>reject(request.error);request.onsuccess=()=>resolve(request.result)});report.previousIndexedDb=await new Promise((resolve,reject)=>{const tx=db.transaction('items','readonly');const request=tx.objectStore('items').get('key');request.onsuccess=()=>resolve(request.result??null);request.onerror=()=>reject(request.error)});await new Promise((resolve,reject)=>{const tx=db.transaction('items','readwrite');tx.objectStore('items').put('indexeddb-persisted','key');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close(); const style=document.createElement('style'); style.textContent='#result{color:color-mix(in srgb,#fff 80%,#18a)}';document.head.append(style); document.documentElement.dataset.framework='vanilla'; report.complete=Object.values(report.checks).every(Boolean);document.querySelector('#result').textContent=JSON.stringify(report)} start().catch(error=>{report.error=error.message;document.querySelector('#result').textContent=JSON.stringify(report)});\n`
}
function frameworkMain(framework) { return `import {connectWebTools} from '@webtools/plugin-sdk/web'; const api=connectWebTools(); const marker='framework-${framework}'; async function verify(){await api.ready;await api.storage.set(marker,{ok:true});const response=await fetch('http://127.0.0.1:${port}/cors');document.documentElement.dataset.framework='${framework}';document.querySelector('#app').dataset.framework='${framework}';document.querySelector('#app').textContent='${framework} '+(response.ok?'framework-pass':'failed')} verify().catch(error=>{document.querySelector('#app').textContent='${framework} failed '+error.message})` }
function nodePreload(httpPort) {
  return `const {contextBridge,ipcRenderer}=require('electron');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const crypto=require('node:crypto');const {Buffer}=require('node:buffer');const stream=require('node:stream');const http=require('node:http');const https=require('node:https');const net=require('node:net');const childProcess=require('node:child_process');const axios=require('axios');const yauzl=require('yauzl');const {createRequire}=require('node:module');const addon=require('@webtools/runtime-native-addon');const cjs=require('runtime-cjs-fixture');const nested=createRequire(require.resolve('yauzl'))('pend');let localDataError=null;const dataDir=process.env.WEBTOOLS_PLUGIN_DATA;try{fs.mkdirSync(dataDir,{recursive:true})}catch(e){localDataError=e.message}async function get(url){return new Promise((resolve,reject)=>http.get(url,r=>{let value='';r.setEncoding('utf8');r.on('data',chunk=>value+=chunk);r.on('end',()=>{if(r.statusCode!==200)reject(new Error('HTTP '+r.statusCode));else resolve(JSON.parse(value))})}).on('error',reject))}async function helper(){return new Promise((resolve,reject)=>{const exe=path.join(__dirname,'..','resources','helper.exe');const child=childProcess.spawn(exe,['acceptance'],{cwd:path.dirname(exe),windowsHide:true,env:{...process.env,PATH:path.dirname(exe)+';'+process.env.PATH}});let out='';let err='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>err+=chunk);child.on('error',reject);child.on('close',code=>code===0?resolve(out.trim()):reject(new Error('helper '+code+' '+err)))})}const mainIpcProbe=ipcRenderer.invoke('settings:get').then(()=>({denied:false}),error=>({denied:/UNAUTHORIZED_MANAGER_IPC/.test(error.message),error:error.message}));contextBridge.exposeInMainWorld('runtimeNode',{run:async()=>{const dataFile=path.join(dataDir,'counter.txt');const count=Number(fs.existsSync(dataFile)?fs.readFileSync(dataFile,'utf8'):0)+1;fs.writeFileSync(dataFile,String(count));const nodeHttp=await get('http://127.0.0.1:${httpPort}/node');const xa=(await axios.get('http://127.0.0.1:${httpPort}/axios')).data.value;const pass=new stream.PassThrough();let streamValue='';pass.on('data',chunk=>streamValue+=chunk.toString());pass.end('stream-ok');const helperOutput=await helper();const ipc=await mainIpcProbe;const netProbe=await new Promise((resolve,reject)=>{const socket=net.connect(${httpPort+1},'127.0.0.1');let result='';socket.setEncoding('utf8');const timer=setTimeout(()=>{socket.destroy();reject(new Error('net timeout'))},5000);socket.on('connect',()=>socket.write('runtime-net'));socket.on('data',chunk=>{result+=chunk;if(result.includes('net-ok')){clearTimeout(timer);socket.end();resolve(true)}});socket.on('error',error=>{clearTimeout(timer);reject(error)})});return{versions:process.versions,net:netProbe,builtins:[fs,path,os,crypto,Buffer,stream,http,https,net,childProcess].every(Boolean),file:fs.readFileSync(dataFile,'utf8')===String(count),path:path.basename(dataFile)==='counter.txt',os:os.platform()==='win32',crypto:crypto.createHash('sha256').update('x').digest('hex').length===64,buffer:Buffer.from('node').toString()==='node',stream:streamValue==='stream-ok',nodeHttp:nodeHttp.value==='node-http-ok',axios:xa==='axios-ok',yauzl:typeof yauzl.open==='function',nestedDependency:typeof nested==='function',commonjs:cjs.kind==='commonjs'&&cjs.data.value===27,nativeAddon:addon.result(),helper:helperOutput,localDataPath:dataDir,localDataCount:count,localDataError,managerIpcDenied:ipc.denied,wasm:typeof WebAssembly.instantiate==='function',nodeIntegrationPage:typeof window.process==='undefined'}}});\n`
}
function makeManifest(version, runtimeKind, source, httpPort, options = {}) {
  const files = []
  const addTree = async (directory, prefix) => {
    for (const name of await readdir(directory)) {
      const path = join(directory, name); const stat = await lstat(path); const relativePath = `${prefix}/${name}`
      if (stat.isSymbolicLink()) throw new Error('Runtime fixture contains a link.')
      if (stat.isDirectory()) await addTree(path, relativePath)
      else if (stat.isFile()) files.push(runtimeFile(relativePath))
      else throw new Error('Runtime fixture contains a special file.')
    }
  }
  return (async () => {
    const frameworks = options.frameworks ?? ['vanilla', 'vue', 'react', 'svelte']
    for (const framework of frameworks) await addTree(join(source, 'runtime', framework), `runtime/${framework}`)
    const features = frameworks.map(framework => ({ id: framework, title: `${framework[0].toUpperCase()}${framework.slice(1)} Framework`, entry: { kind: 'web-bundle', document: `runtime/${framework}/index.html` }, requiredCapabilities: ['plugin.storage.read', 'plugin.storage.write', 'sharedAI.complete', 'clipboard.write'] }))
    if (runtimeKind === 'node') {
      await addTree(join(source, 'runtime', 'node-dist'), 'runtime/node-dist')
      for (const path of ['runtime/preload/preload.cjs', 'runtime/resources/helper.exe', 'runtime/resources/support.dll']) {
        files.push(runtimeFile(path))
      }
      features.push({ id: 'node-runtime', title: 'Node Runtime', entry: { kind: 'web-bundle', document: 'runtime/node-dist/index.html' }, requiredCapabilities: ['plugin.storage.read', 'plugin.storage.write', 'sharedAI.complete', 'clipboard.write'] })
    }
    const runtimeFiles = await Promise.all(files.map(async item => ({ ...item })))
    return { manifestVersion: 3, id: options.id ?? 'org.webtools.acceptance.runtime', name: options.name ?? 'Plugin Runtime Fixture', description: 'External SDK-built Plugin Runtime acceptance package.', author: { name: 'WebTools Plugin Runtime acceptance' }, version, api: { apiMajor: 1, minHostVersion: '0.1.0' }, type: 'plugin', requestedCapabilities: ['plugin.storage.read', 'plugin.storage.write', 'sharedAI.complete', 'clipboard.write'], runtime: runtimeKind === 'node' ? { kind: 'node', preload: 'runtime/preload/preload.cjs' } : { kind: 'web' }, compatibility: { platforms: ['win32'], architectures: ['x64'], ...(runtimeKind === 'node' ? { nodeAbi: '149' } : {}) }, features, runtimeFiles, dependencies: [], package: { format: 'wtplugin', packageVersion: 1 } }
  })()
}
function runtimeFile(path) {
  if (path === 'runtime/preload/preload.cjs') return { path, role: 'node-preload', mediaType: 'text/javascript' }
  if (path.endsWith('.exe')) return { path, role: 'helper', mediaType: 'application/octet-stream' }
  if (path.endsWith('.dll')) return { path, role: 'library', mediaType: 'application/octet-stream' }
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase()
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png' }
  const mediaType = types[extension]
  if (!mediaType) throw new Error(`No runtime media type for ${path}`)
  return { path, role: 'web', mediaType }
}
