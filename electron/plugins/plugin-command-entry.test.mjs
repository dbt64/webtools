import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { parseFeatureTextResult } from '../../src/shared/feature-quick-result-contracts.ts'

test('command entry boots using the actual Utility process.parentPort contract and returns guarded text', async () => {
  const port = new EventEmitter(); const messages = []
  port.postMessage = value => {
    messages.push(value)
    if (value.type === 'capability') queueMicrotask(() => port.emit('message', { data: { type: 'capability-result', id: value.id, ok: true, value: { type: 'text', source: 'selected-text', text: 'synthetic' } } }))
  }
  const source = await readFile(new URL('./plugin-command-entry.ts', import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(output, { exports: {}, process: { parentPort: port, env: {} }, Buffer, AbortController,
    require: name => {
      if (name === 'node:fs') return { readFileSync() {} }
      if (name === 'node:module') return { createRequire: () => () => async ({ resultTarget, context }) => resultTarget === 'super-panel' ? { kind: 'text', text: context.text } : undefined }
      if (name.includes('node-plugin-preload-bootstrap')) return { loadNodePluginPreload: (_args, deps) => deps.requirePlugin('synthetic.cjs') }
      if (name.includes('feature-quick-result-contracts')) return { parseFeatureTextResult }
      assert.fail(`Unexpected runtime dependency: ${name}`)
    } })
  assert.equal(port.listenerCount('message'), 1)
  port.emit('message', { data: { type: 'start', descriptor: {}, capabilities: [], resultTarget: 'super-panel' } })
  await new Promise(done => setImmediate(done))
  assert.deepEqual(messages.at(-1).result, { kind: 'text', text: 'synthetic' })
  assert.equal(messages.at(-1).type, 'completed')
})
