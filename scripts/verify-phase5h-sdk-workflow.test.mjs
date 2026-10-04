import test from 'node:test'
import assert from 'node:assert/strict'
import { workflowCommands } from './verify-phase5h-sdk-workflow.mjs'

test('documented third-party workflow uses only public SDK types, frozen pnpm install and CLI commands', () => {
  const commands = workflowCommands()
  assert.deepEqual(commands[0], ['install'])
  assert.deepEqual(commands[1], ['install', '--frozen-lockfile'])
  assert.ok(commands.some(args => args[0] === 'exec' && args[1] === 'tsc'))
  assert.ok(commands.some(args => args[0] === 'exec' && args[1] === 'webtools-plugin' && args[2] === 'validate'))
  assert.ok(commands.some(args => args[0] === 'exec' && args[1] === 'webtools-plugin' && args[2] === 'pack'))
  assert.equal(JSON.stringify(commands).includes('electron/plugins'), false)
  assert.equal(JSON.stringify(commands).includes('src/shared'), false)
})
