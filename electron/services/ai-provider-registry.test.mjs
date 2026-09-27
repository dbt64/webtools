import test from 'node:test'
import assert from 'node:assert/strict'
import { getAIProviderDescriptors, resolveAIProviderEndpoint } from './ai-provider-registry.ts'

test('publishes safe built-in provider descriptors without arbitrary endpoints', () => {
  const providers = getAIProviderDescriptors()
  assert.deepEqual(providers.map(({ id }) => id), ['openai', 'anthropic', 'gemini', 'deepseek', 'qwen', 'custom'])
  assert.equal(providers.find(({ id }) => id === 'openai').defaultModel, 'gpt-4.1-mini')
  assert.equal(providers.find(({ id }) => id === 'deepseek').defaultModel, 'deepseek-flash')
  assert.equal(providers.some((provider) => 'endpoint' in provider), false)
})

test('resolves fixed provider endpoints and requires a Qwen workspace from an allowlisted region', () => {
  assert.equal(resolveAIProviderEndpoint('openai').toString(), 'https://api.openai.com/v1/chat/completions')
  assert.equal(resolveAIProviderEndpoint('deepseek').toString(), 'https://api.deepseek.com/chat/completions')
  assert.equal(resolveAIProviderEndpoint('qwen', { region: 'ap-southeast-1', workspaceId: 'ws_demo-123' }).toString(), 'https://ws_demo-123.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions')
  assert.throws(() => resolveAIProviderEndpoint('qwen', { region: 'other-region', workspaceId: 'ws_demo-123' }), /地区/)
  assert.throws(() => resolveAIProviderEndpoint('qwen', { region: 'cn-beijing', workspaceId: '' }), /工作空间/)
})

test('restricts Custom endpoints to HTTPS or loopback HTTP and excludes credentials and query data', () => {
  assert.equal(resolveAIProviderEndpoint('custom', { baseUrl: 'https://example.test/v1/' }).toString(), 'https://example.test/v1/chat/completions')
  assert.throws(() => resolveAIProviderEndpoint('custom', { baseUrl: 'http://example.test/v1' }), /HTTPS/)
  assert.throws(() => resolveAIProviderEndpoint('custom', { baseUrl: 'https://user:pass@example.test/v1' }), /账号/)
  assert.throws(() => resolveAIProviderEndpoint('custom', { baseUrl: 'https://example.test/v1?token=x' }), /查询参数/)
})
