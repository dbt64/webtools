import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { defineCommand } from '../node.mjs'

test('SDK 1.8 retains the guarded optional command result contract without changing void execution', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.version, '1.8.0')
  assert.equal(defineCommand(() => {})({}), undefined)
  const command = defineCommand(invocation => invocation.resultTarget === 'super-panel' ? { kind: 'text', text: 'synthetic' } : undefined)
  assert.equal(command({}), undefined)
  assert.deepEqual(command({ resultTarget: 'super-panel' }), { kind: 'text', text: 'synthetic' })
})
