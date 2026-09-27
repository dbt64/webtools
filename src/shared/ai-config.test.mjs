import test from 'node:test'
import assert from 'node:assert/strict'
import { reactive } from 'vue'
import { cloneSharedAISettings, createDefaultSharedAISettings, isValidSharedAISettings, normalizeSharedAISettings } from './ai-config.ts'

test('copies reactive AI settings without crashing the Settings view', () => {
  const original = reactive({
    defaultProviderId: 'qwen',
    providers: { qwen: { model: 'qwen-plus', region: 'cn-beijing', workspaceId: 'workspace_1' } },
  })
  const draft = cloneSharedAISettings(original)

  assert.deepEqual(draft, {
    defaultProviderId: 'qwen',
    providers: { qwen: { model: 'qwen-plus', region: 'cn-beijing', workspaceId: 'workspace_1' } },
  })
  draft.providers.qwen.model = 'qwen-mt-flash'
  assert.equal(original.providers.qwen.model, 'qwen-plus')
  assert.doesNotThrow(() => structuredClone(draft))
})

test('retains each provider model/config while changing the default provider', () => {
  const openai = { model: 'gpt-4.1-mini' }
  const deepseek = { model: 'deepseek-flash' }
  const initial = { defaultProviderId: 'openai', providers: { openai, deepseek } }
  const switched = { ...initial, defaultProviderId: 'deepseek' }
  assert.equal(isValidSharedAISettings(initial), true)
  assert.equal(switched.providers.openai.model, 'gpt-4.1-mini')
  assert.equal(switched.providers.deepseek.model, 'deepseek-flash')
})

test('switching a reactive draft creates an IPC-cloneable settings payload', () => {
  const draft = reactive({
    defaultProviderId: 'custom',
    providers: { custom: { model: 'local', baseUrl: 'http://127.0.0.1:11434/v1' } },
  })
  const switched = cloneSharedAISettings({ ...draft, defaultProviderId: 'deepseek' })
  assert.doesNotThrow(() => structuredClone(switched))
  assert.equal(switched.defaultProviderId, 'deepseek')
  assert.equal(isValidSharedAISettings(switched), true)
})

test('maps legacy AI settings to Custom without guessing a built-in provider', () => {
  const config = normalizeSharedAISettings(undefined, 'https://api.deepseek.com', 'deepseek-chat')
  assert.equal(config.defaultProviderId, 'custom')
  assert.deepEqual(config.providers.custom, { model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com' })
  assert.equal(config.providers.deepseek, undefined)
})

test('rejects arbitrary endpoints, unknown configuration fields, and credentials in endpoint URLs', () => {
  const base = createDefaultSharedAISettings()
  assert.equal(isValidSharedAISettings({ ...base, providers: { custom: { model: 'm', baseUrl: 'http://custom.example/v1' } } }), false)
  assert.equal(isValidSharedAISettings({ ...base, providers: { custom: { model: 'm', baseUrl: 'https://user:pass@example.com/v1' } } }), false)
  assert.equal(isValidSharedAISettings({ ...base, providers: { openai: { model: 'm', endpoint: 'https://evil.example' } } }), false)
  assert.equal(isValidSharedAISettings({ ...base, providers: { qwen: { model: 'm', region: 'cn-beijing', customHost: 'evil.example' } } }), false)
  assert.equal(isValidSharedAISettings({ ...base, endpoint: 'https://evil.example' }), false)
})

test('accepts a valid Custom endpoint while switching the default AI provider', () => {
  const settings = {
    defaultProviderId: 'deepseek',
    providers: {
      custom: { model: 'local-model', baseUrl: 'http://127.0.0.1:11434/v1' },
      deepseek: { model: 'deepseek-chat' },
    },
  }
  assert.equal(isValidSharedAISettings(settings), true)
  assert.equal(isValidSharedAISettings({ ...settings, defaultProviderId: 'custom' }), true)
})
