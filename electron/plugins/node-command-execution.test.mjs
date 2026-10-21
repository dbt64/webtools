import assert from 'node:assert/strict'
import test from 'node:test'
import { dirname } from 'node:path'
import { EventEmitter } from 'node:events'
import { NodeCommandExecutionAdapter } from './node-command-execution.ts'
import { runtimeV3Manifest, runtimeV3Package } from './fixtures.mjs'
import { validatePackageV3ForRuntime } from './package-validator.ts'
import { createWebFeatureAuthority } from './web-feature-authority.ts'
import { PluginRuntimeDiagnostics } from './plugin-runtime-diagnostics.ts'

async function setup(messages, { holdExit = false, killThrows = false, effects = {}, capabilityCompletion } = {}) {
  const capabilities = effects.externalOpen ? ['external.open'] : []
  const manifest = runtimeV3Manifest({ runtime: { kind: 'node' }, requestedCapabilities: capabilities, features: [{ id: 'quick', title: 'Quick',
    entry: { kind: 'node-command', module: 'command.cjs' }, presentation: { type: 'command' }, requiredCapabilities: capabilities }],
    runtimeFiles: [{ path: 'command.cjs', role: 'node-command', mediaType: 'text/javascript' }] })
  const pkg = await validatePackageV3ForRuntime(runtimeV3Package(manifest, [{ name: 'command.cjs', data: 'module.exports=()=>{}' }]), '0.1.0')
  const authority = createWebFeatureAuthority(pkg.snapshot, 'quick', () => true, () => {})
  const child = new EventEmitter(); let started; let cleanupFailed = false; let options
  child.postMessage = message => {
    if (message.type === 'start') { started = message; queueMicrotask(() => { for (const item of messages) child.emit('message', item) }) }
    if (message.type === 'capability-result' && capabilityCompletion) queueMicrotask(() => child.emit('message', capabilityCompletion(message)))
    if (message.type === 'cancel' && !holdExit) queueMicrotask(() => child.emit('exit', 0))
  }
  child.kill = () => { if (killThrows) throw new Error('owned cleanup failed'); child.emit('exit', 0); return true }
  const adapter = new NodeCommandExecutionAdapter({
    fork: (_file, value) => { options = value; queueMicrotask(() => child.emit('spawn')); return child },
    resolve: async () => ({ pluginId: manifest.id, packageHash: pkg.hash, preloadPath: 'D:/isolated/command.cjs', preloadHash: 'a'.repeat(64), localDataPath: 'D:/isolated/data' }),
    capabilities: () => ({ store: {}, effects }), diagnostics: new PluginRuntimeDiagnostics([]),
    onOwnershipChanged() {}, onCleanupFailed() { cleanupFailed = true },
  })
  return { adapter, authority, child, started: () => started, forkOptions: () => options, cleanupFailed: () => cleanupFailed }
}

test('Utility startup preserves the existing validated command directory as cwd', async () => {
  const env = await setup([{ type: 'completed' }])
  await env.adapter.execute(env.authority)
  assert.equal(env.forkOptions().cwd, dirname('D:/isolated/command.cjs'))
})

test('only a successful Host external.open marks command completion, without trusting child claims', async () => {
  let opened = 0
  const messages = [{ type: 'capability', id: 1, method: 'external.open', payload: { url: 'https://example.test/search?q=fixture' } }]
  const env = await setup(messages, { effects: { externalOpen: async () => { opened++ } },
    capabilityCompletion: reply => { assert.equal(reply.ok, true); return { type: 'completed' } } })
  assert.deepEqual(await env.adapter.execute(env.authority, undefined, { resultTarget: 'super-panel' }), { status: 'completed', externalOpened: true })
  assert.equal(opened, 1)

  const failure = await setup(messages, { effects: { externalOpen: async () => { throw new Error('Controlled open failure') } },
    capabilityCompletion: reply => { assert.equal(reply.ok, false); return { type: 'completed' } } })
  assert.deepEqual(await failure.adapter.execute(failure.authority), { status: 'completed' })
  const forged = await setup([{ type: 'completed', externalOpened: true }])
  await assert.rejects(forged.adapter.execute(forged.authority), error => error.code === 'COMMAND_PROTOCOL_ERROR')
})

test('external open can also return Quick Result; a failed or cancelled command never becomes a successful open outcome', async () => {
  const messages = [{ type: 'capability', id: 1, method: 'external.open', payload: { url: 'https://example.test/' } }]
  for (const terminal of [{ type: 'completed', result: { kind: 'text', text: 'Keep this result visible' } },
    { type: 'failed', message: 'Failure after external open' }, { type: 'cancelled' }]) {
    const env = await setup(messages, { effects: { externalOpen: async () => {} }, capabilityCompletion: () => terminal })
    const pending = env.adapter.execute(env.authority, undefined, { resultTarget: 'super-panel' })
    if (terminal.type === 'failed') await assert.rejects(pending, error => error.code === 'COMMAND_FAILED')
    else assert.deepEqual(await pending, terminal.type === 'cancelled' ? { status: 'cancelled' }
      : { status: 'completed', externalOpened: true, result: terminal.result })
  }
})

test('Command text is returned only after owned child cleanup and void remains compatible', async () => {
  const env = await setup([{ type: 'completed', result: { kind: 'text', text: 'bounded result' } }], { holdExit: true })
  let completed = false
  const pending = env.adapter.execute(env.authority, undefined, { resultTarget: 'super-panel' }).then(value => { completed = true; return value })
  while (!env.started()) await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(completed, false)
  assert.equal(env.started().resultTarget, 'super-panel')
  env.child.emit('exit', 0)
  assert.deepEqual(await pending, { status: 'completed', result: { kind: 'text', text: 'bounded result' } })
  assert.equal(env.adapter.hasActiveWork, false)
  assert.equal(env.authority.isCurrent(), false)
  const legacy = await setup([{ type: 'completed' }])
  assert.deepEqual(await legacy.adapter.execute(legacy.authority), { status: 'completed' })
})

test('Command output without a result target is discarded and malformed/duplicate results fail', async () => {
  const env = await setup([{ type: 'completed', result: { kind: 'text', text: 'not retained' } }])
  assert.deepEqual(await env.adapter.execute(env.authority), { status: 'completed' })
  for (const messages of [
    [{ type: 'completed', result: { kind: 'text', text: 'x'.repeat(8193) } }],
    [{ type: 'completed', result: { kind: 'text', text: 'x', ref: 'forged' } }],
    [{ type: 'completed' }, { type: 'completed', result: { kind: 'text', text: 'second' } }],
  ]) {
    const invalid = await setup(messages)
    await assert.rejects(invalid.adapter.execute(invalid.authority, undefined, { resultTarget: 'super-panel' }), error => error.code === 'COMMAND_PROTOCOL_ERROR')
  }
})

test('cancel and cleanup failure never release a computed result', async () => {
  const abort = new AbortController()
  const env = await setup([{ type: 'completed', result: { kind: 'text', text: 'cancelled result' } }], { holdExit: true })
  const pending = env.adapter.execute(env.authority, undefined, { resultTarget: 'super-panel', signal: abort.signal })
  while (!env.started()) await new Promise(resolve => setImmediate(resolve))
  abort.abort(); env.child.emit('exit', 0)
  assert.deepEqual(await pending, { status: 'cancelled' })
  const failed = await setup([{ type: 'completed', result: { kind: 'text', text: 'must not escape' } }], { holdExit: true, killThrows: true })
  await assert.rejects(failed.adapter.execute(failed.authority, undefined, { resultTarget: 'super-panel' }), /cleanup failed/)
  assert.equal(failed.cleanupFailed(), true)
  assert.equal(failed.adapter.hasActiveWork, false)
})
