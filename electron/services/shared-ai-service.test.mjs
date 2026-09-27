import test from 'node:test'
import assert from 'node:assert/strict'
import { SharedAIService } from './shared-ai-service.ts'

function setup(sharedAI, credentials = { get: async (provider) => `${provider}-secret` }) {
  const calls = []
  const adapter = { complete: async (request) => { calls.push(request); return 'READY' } }
  const service = new SharedAIService({
    dataStore: { snapshot: () => ({ settings: { sharedAI } }) },
    credentials,
    openAICompatibleAdapter: adapter,
    anthropicAdapter: adapter,
  })
  return { service, calls }
}

test('routes generic AI messages through the current default provider and its own saved model', async () => {
  const { service, calls } = setup({
    defaultProviderId: 'deepseek',
    providers: { openai: { model: 'gpt-4.1-mini' }, deepseek: { model: 'deepseek-flash' } },
  })
  const result = await service.complete([{ role: 'user', content: 'generic request' }], new AbortController().signal)
  assert.equal(result.text, 'READY')
  assert.equal(result.providerId, 'deepseek')
  assert.equal(result.model, 'deepseek-flash')
  assert.equal(calls[0].endpoint.toString(), 'https://api.deepseek.com/chat/completions')
  assert.equal(calls[0].apiKey, 'deepseek-secret')
  assert.deepEqual(calls[0].messages, [{ role: 'user', content: 'generic request' }])
})

test('uses Custom URL only for the selected Custom provider and never substitutes another key', async () => {
  const requested = []
  const credentials = { get: async (provider) => { requested.push(provider); return provider === 'custom' ? 'custom-key' : null } }
  const { service, calls } = setup({ defaultProviderId: 'custom', providers: { custom: { model: 'my-model', baseUrl: 'https://custom.example/api' } } }, credentials)
  const result = await service.complete([{ role: 'user', content: 'hello' }], new AbortController().signal)
  assert.equal(result.providerId, 'custom')
  assert.deepEqual(requested, ['custom'])
  assert.equal(calls[0].endpoint.toString(), 'https://custom.example/api/chat/completions')
  assert.equal(calls[0].apiKey, 'custom-key')
})

test('reports missing credentials instead of silently selecting another provider', async () => {
  const credentials = { get: async () => null }
  const { service, calls } = setup({ defaultProviderId: 'openai', providers: { openai: { model: 'gpt-4.1-mini' }, deepseek: { model: 'deepseek-flash' } } }, credentials)
  await assert.rejects(() => service.complete([{ role: 'user', content: 'hello' }], new AbortController().signal), (error) => error.code === 'AI_NOT_CONFIGURED')
  assert.equal(calls.length, 0)
})

test('exposes safe provider state without returning credentials or built-in endpoints', async () => {
  const { service } = setup({ defaultProviderId: 'openai', providers: { openai: { model: 'gpt-4.1-mini' } } })
  const info = await service.getProviderInfo('openai')
  assert.equal(info.configured, true)
  assert.equal(info.hasApiKey, true)
  assert.equal(info.model, 'gpt-4.1-mini')
  assert.equal('apiKey' in info, false)
  assert.equal('endpoint' in info, false)
  const descriptors = service.getProviderDescriptors()
  assert.equal(descriptors.some((provider) => 'endpoint' in provider), false)
})

test('keeps its connection check generic and outside the Translation domain', async () => {
  const { service, calls } = setup({ defaultProviderId: 'openai', providers: { openai: { model: 'gpt-4.1-mini' } } })
  const result = await service.testConnection(new AbortController().signal)
  assert.equal(result.text, 'READY')
  assert.deepEqual(calls[0].messages, [
    { role: 'system', content: 'Reply with the exact text READY.' },
    { role: 'user', content: 'Reply READY now.' },
  ])
  assert.equal(calls[0].maxOutputTokens, 16)
})
