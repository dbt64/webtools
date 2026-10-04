import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./verify-phase5d-plugin-ui-smoke.mjs', import.meta.url), 'utf8')

test('packaged smoke starts owned processes inside cleanup scope and identities NativeHost before pipe wait', () => {
  const guardedSpawn = source.indexOf('try {\n  probe = startProbe()')
  const nativeSpawn = source.indexOf('native = spawn(nativeExe')
  const identityCapture = source.indexOf('nativeIdentity = await until(')
  const pipeWait = source.indexOf('socket = await until(')
  assert.ok(guardedSpawn >= 0 && nativeSpawn > guardedSpawn)
  assert.ok(identityCapture > nativeSpawn && pipeWait > identityCapture)
})

test('packaged smoke failure cleanup re-discovers exact owned process identities and closes Manager before NativeHost', () => {
  assert.ok(source.includes('process.pid === native.pid && process.path?.toLowerCase() === nativeExe.toLowerCase()'))
  assert.ok(source.includes("closeOwnedProcess('close', mainIdentity, managerExe"))
  assert.ok(source.includes("closeOwnedProcess('close-native', nativeIdentity, nativeExe"))
  const cleanup = source.slice(source.indexOf('} finally {\n  cdp?.close()'))
  const restart = cleanup.indexOf('probe = startProbe()')
  const scan = cleanup.indexOf('let processes = await os()')
  assert.ok(restart >= 0 && scan > restart, 'cleanup must obtain a fresh identity probe before scanning owned processes')
  assert.ok(!cleanup.slice(0, restart).includes('if (probe && probe.exitCode === null)'), 'identity scan must not be skipped when the first probe exits')
  assert.ok(source.includes('Directly spawned PowerShell identity probe'))
  assert.ok(source.includes('function runOneShotProbe(request)'))
  assert.ok(source.includes('await cleanupWithOneShotProbe()'))
  assert.ok(source.includes("report.result = 'INCOMPLETE: ISOLATED PROCESS CLEANUP FAILED'"))
})

test('each process identity probe has a private response queue and stop waits for stream closure', () => {
  const client = source.slice(source.indexOf('function startProbe()'), source.indexOf('async function os('))
  assert.ok(client.includes('const pending = []'))
  assert.ok(client.includes("createInterface({ input: child.stdout }).on('line'"))
  assert.ok(client.includes("child.on('close', () => { client.isClosed = true; resolveClosed(true)"))
  const stop = source.slice(source.indexOf('async function stopProbe('), source.indexOf('let socket'))
  assert.ok(stop.includes('client.closed'))
  assert.ok(!stop.includes("once(child, 'exit')"))
})
