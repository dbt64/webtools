import test from 'node:test'
import assert from 'node:assert/strict'
import { TranslationService, validateTranslationRequest } from './translation-service.ts'
import { ServiceError } from './service-error.ts'

const requestId = '123e4567-e89b-12d3-a456-426614174000'
const baseRequest = { requestId, text: 'source text', sourceLanguage: 'auto', targetLanguage: 'zh-CN' }

function setup(engine, overrides = {}) {
  const state = {
    settings: {
      sharedAI: { defaultProviderId: 'openai', providers: { openai: { model: 'gpt-4.1-mini' }, qwen: { model: 'qwen3.8-flash', region: 'cn-beijing', workspaceId: 'ws_demo' } } },
      translation: { engine, sourceLanguage: 'auto', targetLanguage: 'zh-CN', qwenMtModel: 'qwen-mt-flash' },
    },
  }
  const calls = { ai: [], free: [], qwen: [], secrets: [] }
  const service = new TranslationService({
    dataStore: { snapshot: () => structuredClone(state) },
    sharedAI: {
      complete: async (messages, signal) => { calls.ai.push({ messages, signal }); return { text: 'AI output', providerId: 'openai', providerName: 'OpenAI', model: 'gpt-4.1-mini' } },
      getDefaultProviderInfo: async () => ({ providerId: 'openai', providerName: 'OpenAI', model: 'gpt-4.1-mini', hasApiKey: true, configured: true, documentationUrl: '', requiresQwenWorkspace: false }),
    },
    aiCredentials: { get: async (provider) => { calls.secrets.push(`ai:${provider}`); return provider === 'qwen' ? 'qwen-key' : null } },
    myMemoryAdapter: { translate: async (input) => { calls.free.push(input); return 'Free output' } },
    qwenMtAdapter: { translate: async (input) => { calls.qwen.push(input); return 'Qwen output' } },
    timeoutMs: 1000,
    ...overrides,
  })
  return { service, state, calls }
}

test('AI engine uses the Shared AI service and keeps source text separate from system rules', async () => {
  const { service, calls } = setup('ai')
  const result = await service.translate(baseRequest)
  assert.equal(result.translation, 'AI output')
  assert.equal(result.provider.providerId, 'openai')
  assert.equal(calls.ai.length, 1)
  assert.equal(calls.free.length, 0)
  assert.equal(calls.qwen.length, 0)
  assert.equal(calls.ai[0].messages[1].content.endsWith('source text'), true)
})

test('MyMemory is configured without a key and translates without calling Shared AI', async () => {
  const { service, calls } = setup('mymemory')
  const provider = await service.getProviderInfo()
  const result = await service.translate(baseRequest)
  assert.deepEqual(provider, { engine: 'mymemory', providerName: 'MyMemory 免费翻译', configured: true })
  assert.equal(result.translation, 'Free output')
  assert.equal(result.provider.engine, 'mymemory')
  assert.deepEqual(calls.secrets, [])
  assert.equal(calls.ai.length, 0)
})

test('Qwen-MT uses Qwen Shared AI credentials and workspace without requiring the default AI provider', async () => {
  const { service, calls } = setup('qwen-mt')
  const result = await service.translate(baseRequest)
  assert.equal(result.translation, 'Qwen output')
  assert.equal(result.provider.engine, 'qwen-mt')
  assert.deepEqual(calls.secrets, ['ai:qwen'])
  assert.equal(calls.qwen[0].endpoint.toString(), 'https://ws_demo.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions')
  assert.equal(calls.ai.length, 0)
})

test('reports not configured instead of silently falling back to another engine', async () => {
  const { service } = setup('qwen-mt', {
    aiCredentials: { get: async () => null },
  })
  await assert.rejects(() => service.translate(baseRequest), (error) => error.code === 'TRANSLATION_NOT_CONFIGURED')
})

test('free provider errors do not silently trigger AI translation', async () => {
  const { service, calls } = setup('mymemory', {
    myMemoryAdapter: { translate: async () => { throw new ServiceError('FREE_TRANSLATION_QUOTA', '今日额度已用完。') } },
  })
  await assert.rejects(() => service.translate(baseRequest), (error) => error.code === 'FREE_TRANSLATION_QUOTA')
  assert.equal(calls.ai.length, 0)
})

test('cancellation aborts the active provider request and Manager cleanup cancels all requests', async () => {
  const started = []
  const { service } = setup('ai', {
    sharedAI: {
      complete: (_messages, signal) => new Promise((resolve, reject) => {
        started.push(signal)
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      }),
      getDefaultProviderInfo: async () => ({ providerId: 'openai', providerName: 'OpenAI', model: 'gpt-4.1-mini', hasApiKey: true, configured: true, documentationUrl: '', requiresQwenWorkspace: false }),
    },
  })
  const one = { ...baseRequest, requestId }
  const p1 = service.translate(one)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(service.cancel(requestId), true)
  await assert.rejects(p1, (error) => error.code === 'TRANSLATION_CANCELLED')

  const secondId = '123e4567-e89b-12d3-a456-426614174001'
  const p2 = service.translate({ ...baseRequest, requestId: secondId })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(service.cancelAll(), 1)
  await assert.rejects(p2, (error) => error.code === 'TRANSLATION_CANCELLED')
  assert.equal(started.length, 2)
  assert.equal(started.every((signal) => signal.aborted), true)
})

test('times out stale provider work and validates bounded request IDs, language, and text', async () => {
  const { service } = setup('ai', {
    timeoutMs: 5,
    sharedAI: {
      complete: (_messages, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
      getDefaultProviderInfo: async () => ({ providerId: 'openai', providerName: 'OpenAI', model: 'gpt-4.1-mini', hasApiKey: true, configured: true, documentationUrl: '', requiresQwenWorkspace: false }),
    },
  })
  await assert.rejects(() => service.translate(baseRequest), (error) => error.code === 'TRANSLATION_TIMEOUT')
  assert.equal(validateTranslationRequest(baseRequest), true)
  assert.equal(validateTranslationRequest({ ...baseRequest, requestId: 'x' }), false)
  assert.equal(validateTranslationRequest({ ...baseRequest, sourceLanguage: 'invalid' }), false)
  assert.equal(validateTranslationRequest({ ...baseRequest, text: 'x'.repeat(20_001) }), false)
})
