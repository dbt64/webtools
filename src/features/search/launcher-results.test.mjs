import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSearchCommand } from '../../shared/search-command.ts'
import { appendTranslationAction, isTranslationCandidate } from './launcher-results.ts'

test('accepts English words and phrases for translation, even without app matches', () => {
  for (const query of ['test', 'hello world', 'Visual Studio Code', "don't stop", 'state-of-the-art', 'l’amour', 'state‑of‑the‑art', 'café']) {
    assert.equal(isTranslationCandidate(query), true, query)
  }
})

test('rejects empty, non-Latin, numeric-only, and mixed punctuation queries', () => {
  for (const query of ['', '   ', '你好', 'hello你好', '123', 'hello!', 'hello_world']) {
    assert.equal(isTranslationCandidate(query), false, query)
  }
})

test('appends an exact-query translation action after eight local rows', () => {
  const rows = Array.from({ length: 8 }, (_, index) => ({ kind: 'application', id: `app-${index}`, name: `App ${index}` }))
  const actions = appendTranslationAction(rows, '  Visual Studio Code  ', 'local')

  assert.equal(actions.length, 9)
  assert.deepEqual(actions[8], {
    kind: 'translation',
    text: '  Visual Studio Code  ',
    name: '翻译',
    subtitle: '翻译“Visual Studio Code”',
  })
})

test('adds no translation action for web, file, or saved-website modes', () => {
  for (const mode of ['web', 'files', 'saved-websites']) {
    const actions = appendTranslationAction([], 'hello world', mode)
    assert.deepEqual(actions, [])
  }
})

test('parsed web, Everything, and saved-website commands never receive translation actions', () => {
  for (const rawQuery of ['?hello world', 'file:hello world', '/hello world']) {
    const command = parseSearchCommand(rawQuery)
    assert.deepEqual(appendTranslationAction([], command.query, command.mode), [], rawQuery)
  }
})

test('shows translation for unmatched English phrases and keeps the exact raw query payload', () => {
  const actions = appendTranslationAction([], '  state-of-the-art  ', 'local')

  assert.deepEqual(actions, [{
    kind: 'translation',
    text: '  state-of-the-art  ',
    name: '翻译',
    subtitle: '翻译“state-of-the-art”',
  }])
})

test('places translation after matching local application rows', () => {
  const app = { kind: 'application', id: 'a111111111111111', name: 'Orbit Editor' }
  const actions = appendTranslationAction([app], 'Orbit Editor', 'local')

  assert.deepEqual(actions.map(({ kind }) => kind), ['application', 'translation'])
  assert.equal(actions[0], app)
  assert.equal(actions[1].text, 'Orbit Editor')
})
