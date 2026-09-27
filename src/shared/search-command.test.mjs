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

test('launcher parser preserves current empty, whitespace, and prefix-only behavior', () => {
  for (const [input, expected] of [
    ['', { mode: 'local', query: '' }],
    ['   ', { mode: 'local', query: '' }],
    ['?', { mode: 'web', query: '' }],
    ['?   ', { mode: 'web', query: '' }],
    ['file:', { mode: 'files', query: '' }],
    ['FILE:   ', { mode: 'files', query: '' }],
    ['/', { mode: 'saved-websites', query: '' }],
    ['/   ', { mode: 'saved-websites', query: '' }],
  ]) {
    assert.deepEqual(searchCommands.parseSearchCommand(input), expected, JSON.stringify(input))
  }
})

test('launcher parser trims command payloads but requires the prefix at the first character', () => {
  assert.deepEqual(searchCommands.parseSearchCommand('  local query  '), { mode: 'local', query: 'local query' })
  assert.deepEqual(searchCommands.parseSearchCommand('?  web query  '), { mode: 'web', query: 'web query' })
  assert.deepEqual(searchCommands.parseSearchCommand('FILE:  report  '), { mode: 'files', query: 'report' })
  assert.deepEqual(searchCommands.parseSearchCommand('/  saved site  '), { mode: 'saved-websites', query: 'saved site' })
  assert.deepEqual(searchCommands.parseSearchCommand(' /saved site '), { mode: 'local', query: '/saved site' })
})

test('manager parsing keeps slash queries local while preserving web and file commands', () => {
  assert.deepEqual(searchCommands.parseManagerSearchCommand('/github'), { mode: 'local', query: 'github' })
  assert.deepEqual(searchCommands.parseManagerSearchCommand('?github'), { mode: 'web', query: 'github' })
  assert.deepEqual(searchCommands.parseManagerSearchCommand('file:report'), { mode: 'files', query: 'report' })
})
