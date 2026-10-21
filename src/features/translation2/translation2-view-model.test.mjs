import test from 'node:test'
import assert from 'node:assert/strict'
import { createDefaultTranslation2WorkspaceSettings } from '../../shared/translation2-contracts.ts'
import {
  applyTranslation2Open,
  buildTranslation2ServiceGroups,
  buildTranslation2Tabs,
  createTranslation2ViewState,
  isTranslation2RequestCurrent,
} from './translation2-view-model.ts'

test('tabs always start with WebTools and include only visible verified websites in saved order', () => {
  const settings = createDefaultTranslation2WorkspaceSettings()
  settings.websiteOrder = ['google', 'youdao', 'microsoft', 'tencent', 'sogou', 'deepl', 'caiyun', 'cnki']
  settings.visibleWebsiteIds = ['google']
  const descriptors = [
    { id: 'google', name: 'Google', releaseStatus: 'verified' },
    { id: 'youdao', name: '有道', releaseStatus: 'unverified' },
  ]

  assert.deepEqual(buildTranslation2Tabs(settings, descriptors), [
    { kind: 'webtools', id: 'webtools', label: 'WebTools 翻译' },
    { kind: 'website', id: 'google', label: 'Google' },
  ])
})

test('service selector keeps machine APIs and AI providers in explicit groups', () => {
  const settings = createDefaultTranslation2WorkspaceSettings()
  settings.machineServices.push({ id: 'custom.deepl.1', name: 'DeepL 1', adapterId: 'deepl', enabled: false, builtIn: false, testStatus: 'untested' })
  settings.machineServices.push({ id: 'imported.demo', name: 'Imported Demo', adapterId: 'imported', enabled: true, builtIn: false, testStatus: 'passed', definitionId: 'demo' })
  const groups = buildTranslation2ServiceGroups(settings, [
    { id: 'openai', name: 'OpenAI', configured: true, model: 'gpt-test' },
    { id: 'deepseek', name: 'DeepSeek', configured: false, model: 'deepseek-test' },
  ], { 'builtin.mymemory': true, 'imported.demo': false })

  assert.deepEqual(groups.map(group => group.label), ['机器翻译 API', 'AI 翻译'])
  assert.deepEqual(groups[0].items.map(item => [item.label, item.configured]), [['MyMemory 免费翻译', true], ['Imported Demo', false]])
  assert.deepEqual(groups[1].items.map(item => [item.label, item.configured]), [['OpenAI · gpt-test', true], ['DeepSeek · deepseek-test', false]])
})

test('newer open source replaces old source and invalidates result/request state', () => {
  const state = createTranslation2ViewState({ generation: 2, sourceText: 'old' })
  state.result = 'old result'
  state.request = { id: 'request-old', generation: 2 }

  const next = applyTranslation2Open(state, { generation: 3, sourceText: 'new exact source' })

  assert.equal(next.sourceText, 'new exact source')
  assert.equal(next.result, '')
  assert.equal(next.error, '')
  assert.equal(next.request, null)
  assert.equal(next.openGeneration, 3)
  assert.equal(next.contentGeneration, state.contentGeneration + 1)
})

test('stale or duplicate open projections cannot overwrite current state', () => {
  const state = createTranslation2ViewState({ generation: 4, sourceText: 'current' })
  state.result = 'current result'
  assert.equal(applyTranslation2Open(state, { generation: 3, sourceText: 'stale' }), state)
  assert.equal(applyTranslation2Open(state, { generation: 4, sourceText: 'duplicate' }), state)
})

test('request result is current only for the active view generation and request identity', () => {
  const state = createTranslation2ViewState({ generation: 8, sourceText: 'text' })
  state.contentGeneration = 3
  state.request = { id: 'request-current', contentGeneration: 3 }
  assert.equal(isTranslation2RequestCurrent(state, { id: 'request-current', contentGeneration: 3 }), true)
  assert.equal(isTranslation2RequestCurrent(state, { id: 'request-old', contentGeneration: 3 }), false)
  assert.equal(isTranslation2RequestCurrent(state, { id: 'request-current', contentGeneration: 2 }), false)
})

test('local edits never cause a newer Host open projection to be discarded', () => {
  const state = createTranslation2ViewState({ generation: 2, sourceText: 'before edit' })
  state.contentGeneration = 20
  state.sourceText = 'local edit'

  const next = applyTranslation2Open(state, { generation: 3, sourceText: 'new selected text' })

  assert.equal(next.openGeneration, 3)
  assert.equal(next.contentGeneration, 21)
  assert.equal(next.sourceText, 'new selected text')
})
