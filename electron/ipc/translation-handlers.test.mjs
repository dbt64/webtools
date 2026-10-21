import test from 'node:test'
import assert from 'node:assert/strict'
import { createTranslationIpcHandlers } from './translation-handlers.ts'
import { TranslationService } from '../services/translation-service.ts'

function setup() {
  let enabled = false
  let generation = 1
  const calls = { myMemory: 0, ai: 0, google: 0, connectionTest: 0 }
  const dataStore = { snapshot: () => ({ settings: {
    sharedAI: { defaultProviderId: 'openai', providers: { openai: { model: 'test-model' }, qwen: { model: 'qwen-mt-flash' } } },
    translation: { engine: 'mymemory', sourceLanguage: 'auto', targetLanguage: 'zh-CN', qwenMtModel: 'qwen-mt-flash' },
  } }) }
  const sharedAIService = {
    complete: async () => { calls.ai += 1; return { text: 'translated', providerId: 'openai', providerName: 'OpenAI', model: 'test-model' } },
    getDefaultProviderInfo: async () => ({ providerId: 'openai', providerName: 'OpenAI', model: 'test-model', hasApiKey: false, configured: false, documentationUrl: '', requiresQwenWorkspace: false }),
    getProviderDescriptors: () => [],
    getQwenRegions: () => [],
    getProviderInfo: async () => ({}),
    testConnection: async () => { calls.connectionTest += 1; return { providerName: 'OpenAI', model: 'test-model' } },
  }
  const translationService = new TranslationService({
    dataStore,
    sharedAI: sharedAIService,
    aiCredentials: { get: async () => null },
    myMemoryAdapter: { translate: async () => { calls.myMemory += 1; return 'translated' } },
    qwenMtAdapter: { translate: async () => 'translated' },
    translationAdmission: {
      captureGeneration: () => enabled ? generation : null,
      isGenerationCurrent: value => enabled && value === generation,
    },
  })
  let managerAllowed = true
  const created = createTranslationIpcHandlers({
    translationService,
    sharedAIService,
    aiCredentials: { get: async () => null, set: async () => {}, clear: async () => {} },
    openExternal: async () => { calls.google += 1 },
    isManagerMainFrame: () => managerAllowed,
  })
  return {
    ...created,
    calls,
    enable: () => { enabled = true; generation += 1 },
    invalidate: () => { generation += 1 },
    manager: value => { managerAllowed = value },
  }
}

const event = { sender: {}, senderFrame: {} }
const validTranslation = { requestId: '123e4567-e89b-12d3-a456-426614174000', text: 'hello', sourceLanguage: 'auto', targetLanguage: 'zh-CN' }

test('Legacy Manager translation endpoints are removed while Shared AI administration remains', async () => {
 const env = setup()
 for (const key of ['translate:run','translate:cancel','translate:provider-info','translate:open-google']) assert.equal(env.handlers[key], undefined)
 assert.equal((await env.handlers['ai:test-connection'](event, 'openai')).ok, true)
 assert.equal(env.calls.connectionTest, 1); env.dispose()
})
test('Shared AI administration retains the Manager main-frame sender boundary', async () => {
 const env = setup(); env.manager(false)
 for(const handler of Object.values(env.handlers)) assert.equal((await handler(event, 'openai', 'not-a-real-key')).error.code, 'UNAUTHORIZED')
 assert.equal(env.calls.connectionTest, 0); env.dispose()
})
