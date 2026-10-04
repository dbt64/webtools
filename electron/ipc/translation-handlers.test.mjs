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

test('disabled Translation IPC rejects provider and Google work while Shared AI connection tests remain available', async () => {
  const testEnv = setup()
  const { handlers, calls } = testEnv

  assert.equal((await handlers['translate:run'](event, validTranslation)).error.code, 'TRANSLATION_DISABLED')
  assert.equal((await handlers['translate:open-google'](event, { text: 'hello', targetLanguage: 'zh-CN' })).error.code, 'TRANSLATION_DISABLED')
  assert.deepEqual(calls, { myMemory: 0, ai: 0, google: 0, connectionTest: 0 })
  assert.equal((await handlers['ai:test-connection'](event)).ok, true)
  assert.equal(calls.connectionTest, 1)
  testEnv.dispose()
})

test('enabled Translation IPC preserves current provider and manual Google behavior', async () => {
  const testEnv = setup()
  testEnv.enable()
  const { handlers, calls } = testEnv

  assert.equal((await handlers['translate:run'](event, validTranslation)).ok, true)
  assert.equal((await handlers['translate:open-google'](event, { text: 'hello', targetLanguage: 'zh-CN' })).ok, true)
  assert.deepEqual(calls, { myMemory: 1, ai: 0, google: 1, connectionTest: 0 })
  testEnv.dispose()
})

test('Translation IPC keeps the Manager main-frame sender boundary', async () => {
  const testEnv = setup()
  testEnv.manager(false)
  const { handlers, calls } = testEnv

  assert.equal((await handlers['translate:run'](event, validTranslation)).error.code, 'UNAUTHORIZED')
  assert.equal((await handlers['translate:open-google'](event, { text: 'hello', targetLanguage: 'zh-CN' })).error.code, 'UNAUTHORIZED')
  assert.equal(calls.myMemory + calls.google, 0)
  testEnv.dispose()
})
