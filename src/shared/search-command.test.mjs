import assert from 'node:assert/strict'
import test from 'node:test'
import * as searchCommands from './search-command.ts'

test('manager quick search keeps slash-prefixed text in local search mode', () => {
  assert.deepEqual(searchCommands.parseManagerSearchCommand('/github'), {
    mode: 'local',
    query: 'github',
  })
})

test('manager quick search preserves web and Everything command modes', () => {
  assert.deepEqual(searchCommands.parseManagerSearchCommand('?github'), {
    mode: 'web',
    query: 'github',
  })
  assert.deepEqual(searchCommands.parseManagerSearchCommand('file:report'), {
    mode: 'files',
    query: 'report',
  })
})

test('launcher parsing keeps slash as saved-websites mode', () => {
  assert.deepEqual(searchCommands.parseSearchCommand('/github'), {
    mode: 'saved-websites',
    query: 'github',
  })
})
