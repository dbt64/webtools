import test from 'node:test'
import assert from 'node:assert/strict'
import { createDefaultSharedAISettings, isValidSharedAISettings, normalizeSharedAISettings } from './ai-config.ts'

test('retains each provider model/config while changing the default provider', () => {
  const openai = { model: 'gpt-4.1-mini' }
  const deepseek = { model: 'deepseek-flash' }
  const initial = { defaultProviderId: 'openai', providers: { openai, deepseek } }
  const switched = { ...initial, defaultProviderId: 'deepseek' }
  assert.equal(isValidSharedAISettings(initial), true)
  assert.equal(switched.providers.openai.model, 'gpt-4.1-mini')
  assert.equal(switched.providers.deepseek.model, 'deepseek-flash')
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
