import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { once } from 'node:events'

// Controlled local fixture only. Never attach to an existing browser/profile or user page.
const [label = 'baseline', outputArg, onlyControl] = process.argv.slice(2)
const sampleCount = Number(process.argv[5] ?? 10)
if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 20) throw new Error('Invalid sample count')
if (!outputArg || !['baseline', 'after'].includes(label)) throw new Error('Expected baseline|after and a disposable TEMP root')
const root = resolve(outputArg)
if (!root.toLowerCase().startsWith(resolve(tmpdir()).toLowerCase() + '\\')) throw new Error('Root must be below TEMP')
const directory = join(root, label)
await mkdir(directory, { recursive: true })
const html = `<!doctype html><meta charset="utf-8"><title>Super Panel controlled fixture</title>
<style>body{font:20px Segoe UI;padding:40px}input,textarea{font:inherit;display:block;margin:20px;width:600px}</style>
<p id="document" tabindex="0">Super Panel controlled document selection.</p>
<input id="input" value="Super Panel controlled input selection.">
<textarea id="textarea">Super Panel controlled textarea selection.</textarea>
<div id="editable" contenteditable="true">Super Panel controlled editable selection.</div>
<input id="password" type="password" value="Synthetic non-secret password fixture">`
  + '<button id="button">Controlled non-text focus</button>'
const server = createServer((request, response) => { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html) })
server.listen(0, '127.0.0.1'); await once(server, 'listening')
const pageUrl = `http://127.0.0.1:${server.address().port}/`
const debugPort = 19391
try { await fetch(`http://127.0.0.1:${debugPort}/json/version`); throw new Error('Fixture port is already in use') }
catch (error) { if (error.message === 'Fixture port is already in use') throw error }
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  `--user-data-dir=${join(directory, 'browser-profile')}`, `--remote-debugging-port=${debugPort}`,
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking', `--app=${pageUrl}`,
], { stdio: 'ignore' })
let socket
const pending = new Map(); let nextId = 0
async function request(method, params = {}) {
  const id = ++nextId
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 8000)
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value) }, reject })
  })
  socket.send(JSON.stringify({ id, method, params }))
  return result
}
async function waitUntil(action, timeout = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeout) { try { const value = await action(); if (value) return value } catch {} await new Promise(r => setTimeout(r, 100)) }
  throw new Error('Fixture readiness timeout')
}
const quote = value => `'${String(value).replaceAll("'", "''")}'`
try {
  const target = await waitUntil(async () => (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(t => t.url === pageUrl))
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await once(socket, 'open')
  socket.addEventListener('message', event => {
    const value = JSON.parse(event.data); const receiver = pending.get(value.id)
    if (!receiver) return
    pending.delete(value.id)
    if (value.error || value.result?.exceptionDetails) receiver.reject(new Error('CDP fixture command failed'))
    else receiver.resolve(value.result)
  })
  await waitUntil(async () => (await request('Runtime.evaluate', {
    expression: 'document.readyState === "complete" && Boolean(document.getElementById("document"))', returnByValue: true,
  })).result.value)
  const handle = await waitUntil(() => {
    const command = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class FixtureFocus{[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int c);}';$p=Get-Process -Id ${chrome.pid} -ErrorAction Stop;$h=$p.MainWindowHandle;if($h -ne 0){[FixtureFocus]::ShowWindow($h,9)|Out-Null;[FixtureFocus]::SetForegroundWindow($h)|Out-Null;$h.ToInt64()}`
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', timeout: 8000 }).trim()
  })
  const results = []
  for (const [id, selected] of [['document', true], ['document', false], ['input', true], ['input', false], ['textarea', true], ['textarea', false], ['editable', true], ['editable', false], ['password', true], ['button', false]]) {
    if (onlyControl && id !== onlyControl) continue
    await request('Runtime.evaluate', { expression: `(()=>{const e=document.getElementById(${JSON.stringify(id)});e.focus();if(e instanceof HTMLInputElement||e instanceof HTMLTextAreaElement)e.setSelectionRange(0,${selected ? 'e.value.length' : '0'});else{const r=document.createRange();r.selectNodeContents(e);${selected ? '' : 'r.collapse(true);'}const s=getSelection();s.removeAllRanges();s.addRange(r)}return true})()`, returnByValue: true })
    if (id === 'button') await request('Runtime.evaluate', { expression: '(()=>{const i=document.getElementById("input");i.focus();i.setSelectionRange(0,i.value.length);document.getElementById("button").focus();getSelection().removeAllRanges();return true})()', returnByValue: true })
    if (id === 'document') {
      const rectangle = await request('Runtime.evaluate', { expression: '(()=>{const r=document.getElementById("document").getBoundingClientRect();return {x:r.x+40,y:r.y+r.height/2}})()', returnByValue: true })
      const { x, y } = rectangle.result.value
      await request('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: selected ? 3 : 1 })
      await request('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: selected ? 3 : 1 })
    }
    const fixtureState = await request('Runtime.evaluate', { expression: `(()=>{const e=document.getElementById(${JSON.stringify(id)});return {selectedLength:e instanceof HTMLInputElement||e instanceof HTMLTextAreaElement?e.selectionEnd-e.selectionStart:getSelection().toString().length}})()`, returnByValue: true })
    if (Boolean(fixtureState.result.value.selectedLength) !== selected) throw new Error('Controlled fixture selection setup failed')
    const output = execFileSync('dotnet.exe', ['native/WebTools.NativeHost.Checks/bin/Release/net10.0-windows/WebTools.NativeHost.Checks.dll', '--super-panel-capture-probe', directory, handle, String(sampleCount)], { encoding: 'utf8', timeout: 25000 }).trim()
    if (!output.startsWith(directory)) throw new Error('Unexpected probe output')
    const samples = JSON.parse(await readFile(output, 'utf8'))
    const warm = samples.slice(1).map(s => s.captureMs).sort((a,b) => a-b)
    const summary = { case: `${id}-${selected ? 'selected' : 'empty'}`, file: output, count: samples.length,
      modes: [...new Set(samples.map(s => s.mode))], reasons: [...new Set(samples.map(s => s.reasonCode))],
      coldMs: samples[0].captureMs, warmMedianMs: warm[Math.floor(warm.length/2)], warmMaxMs: warm.at(-1) }
    results.push(summary); console.log(JSON.stringify(summary))
  }
  await writeFile(join(directory, onlyControl ? `summary-${onlyControl}.json` : 'summary.json'), JSON.stringify({ label, fixture: 'controlled-loopback-Chromium', processId: chrome.pid, results }, null, 2))
} finally {
  if (socket?.readyState === WebSocket.OPEN) { try { await request('Browser.close') } catch {} socket.close() }
  server.close()
  // No process-name kill and no access to the user's existing browser group.
  if (chrome.exitCode === null) {
    await Promise.race([once(chrome, 'exit'), new Promise(resolve => setTimeout(resolve, 10000))])
    if (chrome.exitCode === null) console.error(`ISOLATED_BROWSER_SHUTDOWN_NOT_CONFIRMED pid=${chrome.pid}`)
  }
}
