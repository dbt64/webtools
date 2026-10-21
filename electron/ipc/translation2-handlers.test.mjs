import test from 'node:test'
import assert from 'node:assert/strict'
import { createTranslation2Handlers } from './translation2-handlers.ts'
import { TRANSLATION2_IPC_CHANNELS } from '../../src/shared/translation2-ipc.ts'
import { createDefaultTranslation2WorkspaceSettings } from '../../src/shared/translation2-contracts.ts'

const request = {
  requestId: '123e4567-e89b-12d3-a456-426614174000',
  text: 'hello', sourceLanguage: 'auto', targetLanguage: 'zh-CN',
}

function setup({ authorized = true } = {}) {
  let settings = createDefaultTranslation2WorkspaceSettings()
  const calls = { targets: [], cancelled: [], closed: 0, minimized: 0, pinned: false, updated: 0, imported: [], websites: [], bounds: [] }
  const { handlers } = createTranslation2Handlers({
    isTranslationMainFrame: () => authorized,
    window: {
      snapshot: () => ({ generation: 7, sourceText: 'exact source' }),
      close: async () => { calls.closed += 1 },
      isPinned: () => calls.pinned,
      setPinned: value => { calls.pinned = value; return { pinned: value } },
      minimize: () => { calls.minimized++ },
    },
    settings: {
      get: () => structuredClone(settings),
      update: async value => { settings = structuredClone(value); calls.updated += 1; return structuredClone(settings) },
      restoreDefaults: async () => { settings = createDefaultTranslation2WorkspaceSettings(); return structuredClone(settings) },
    },
    translation: {
      translateWithTarget: async (_request, target) => { calls.targets.push(target); return { translation: '你好', provider: { engine: 'mymemory', providerName: 'MyMemory', configured: true } } },
      cancel: id => { calls.cancelled.push(id); return true },
    },
    importedServices: {
      credentialStatus: async () => ({ 'builtin.mymemory': true, 'imported-demo-0001': false }),
      testDraft: async value => { calls.imported.push(['test-draft', value]); return { translation: '测试成功' } },
      save: async value => { calls.imported.push(['save', value]); return structuredClone(settings) },
      update: async (id, value) => { calls.imported.push(['update', id, value]); return structuredClone(settings) },
      test: async id => { calls.imported.push(['test', id]); return { translation: '测试成功', settings: structuredClone(settings) } },
      delete: async id => { calls.imported.push(['delete', id]); return structuredClone(settings) },
    },
    websites: {
      select: async (...args) => { calls.websites.push(args); return { sourceText: args[1], sourceSynchronized: true } },
      setBounds: value => { calls.bounds.push(value); if (value.x < 0) throw new Error('invalid bounds') },
    },
    sharedAI: {
      getProviderDescriptors: () => [
        { id: 'openai', name: 'OpenAI' },
        { id: 'deepseek', name: 'DeepSeek' },
      ],
      getProviderInfo: async id => ({ providerId: id, providerName: id, model: `${id}-model`, configured: id === 'openai' }),
    },
    languageDefaults: () => ({ sourceLanguage: 'en', targetLanguage: 'zh-CN' }),
    theme: () => 'dark',
  })
  return { handlers, calls, getSettings: () => settings, setSettings: value => { settings = value } }
}

test('Translation controls only mutate the owning main-frame window and accept closed argument shapes', async () => {
  const { handlers, calls } = setup()
  assert.deepEqual(await handlers[TRANSLATION2_IPC_CHANNELS.setPinned]({}, true), { ok: true, data: { pinned: true } })
  assert.equal((await handlers[TRANSLATION2_IPC_CHANNELS.bootstrap]({})).data.pinned, true)
  assert.equal((await handlers[TRANSLATION2_IPC_CHANNELS.minimize]({})).ok, true)
  assert.equal(calls.minimized, 1)
  assert.equal((await handlers[TRANSLATION2_IPC_CHANNELS.setPinned]({}, 'true')).ok, false)
  assert.equal((await handlers[TRANSLATION2_IPC_CHANNELS.minimize]({}, 1)).ok, false)
  const denied = setup({ authorized: false })
  assert.equal((await denied.handlers[TRANSLATION2_IPC_CHANNELS.setPinned]({}, true)).ok, false)
  assert.equal(denied.calls.pinned, false)
})

test('bootstrap projects exact source, safe provider state, categories and no credentials', async () => {
  const { handlers } = setup()
  const result = await handlers[TRANSLATION2_IPC_CHANNELS.bootstrap]({})

  assert.equal(result.ok, true)
  assert.deepEqual(result.data.open, { generation: 7, sourceText: 'exact source' })
  assert.deepEqual(result.data.languageDefaults, { sourceLanguage: 'en', targetLanguage: 'zh-CN' })
  assert.deepEqual(result.data.aiProviders, [
    { id: 'openai', name: 'OpenAI', model: 'openai-model', configured: true },
    { id: 'deepseek', name: 'DeepSeek', model: 'deepseek-model', configured: false },
  ])
  assert.equal(JSON.stringify(result.data).includes('apiKey'), false)
  assert.equal(result.data.theme, 'dark')
  assert.deepEqual(result.data.machineConfigured, { 'builtin.mymemory': true, 'imported-demo-0001': false })
})

test('translation resolves the current machine or AI selection in Main', async () => {
  const env = setup()
  let result = await env.handlers[TRANSLATION2_IPC_CHANNELS.translate]({}, request)
  assert.equal(result.ok, true)
  assert.deepEqual(env.calls.targets[0], { kind: 'machine', adapterId: 'mymemory', instanceId: 'builtin.mymemory' })

  const next = structuredClone(env.getSettings())
  next.selectedService = { kind: 'ai', providerId: 'deepseek' }
  env.setSettings(next)
  result = await env.handlers[TRANSLATION2_IPC_CHANNELS.translate]({}, { ...request, requestId: '123e4567-e89b-12d3-a456-426614174001' })
  assert.equal(result.ok, true)
  assert.deepEqual(env.calls.targets[1], { kind: 'ai', providerId: 'deepseek' })
})

test('authorization rejects every operation and does not invoke services', async () => {
  const { handlers, calls } = setup({ authorized: false })
  for (const handler of Object.values(handlers)) assert.equal((await handler({})).error.code, 'UNAUTHORIZED')
  for (const [channel, args] of [
    [TRANSLATION2_IPC_CHANNELS.bootstrap, []],
    [TRANSLATION2_IPC_CHANNELS.updateSettings, [createDefaultTranslation2WorkspaceSettings()]],
    [TRANSLATION2_IPC_CHANNELS.restoreDefaults, []],
    [TRANSLATION2_IPC_CHANNELS.translate, [request]],
    [TRANSLATION2_IPC_CHANNELS.cancel, [request.requestId]],
    [TRANSLATION2_IPC_CHANNELS.testImportedDraft, [{ definition: {}, secret: '' }]],
    [TRANSLATION2_IPC_CHANNELS.saveImported, [{ definition: {}, name: 'x', secret: '' }]],
    [TRANSLATION2_IPC_CHANNELS.updateImported, ['imported-demo-0001', { enabled: false }]],
    [TRANSLATION2_IPC_CHANNELS.testImported, ['imported-demo-0001']],
    [TRANSLATION2_IPC_CHANNELS.deleteImported, ['imported-demo-0001']],
    [TRANSLATION2_IPC_CHANNELS.selectTab, [{ tab: { kind: 'webtools' }, sourceText: '', sourceLanguage: 'auto', targetLanguage: 'zh-CN', openGeneration: 7 }]],
    [TRANSLATION2_IPC_CHANNELS.setWebsiteBounds, [{ x: 0, y: 58, width: 800, height: 600 }]],
    [TRANSLATION2_IPC_CHANNELS.close, []],
  ]) {
    const result = await handlers[channel]({}, ...args)
    assert.equal(result.ok, false, channel)
    assert.equal(result.error.code, 'UNAUTHORIZED')
  }
  assert.deepEqual(calls.targets, [])
  assert.deepEqual(calls.cancelled, [])
  assert.equal(calls.closed, 0)
  assert.deepEqual(calls.imported, [])
})

test('enabled website tabs are persisted and source text is synchronized on return', async () => {
  const env = setup()
  let result = await env.handlers[TRANSLATION2_IPC_CHANNELS.selectTab]({}, {
    tab: { kind: 'website', providerId: 'google' }, sourceText: 'Hello', sourceLanguage: 'auto', targetLanguage: 'zh-CN', openGeneration: 7,
  })
  assert.equal(result.ok, true)
  assert.deepEqual(env.calls.websites[0], ['google', 'Hello', 'auto', 'zh-CN', 7])
  assert.deepEqual(result.data.settings.activeTab, { kind: 'website', providerId: 'google' })

  result = await env.handlers[TRANSLATION2_IPC_CHANNELS.selectTab]({}, {
    tab: { kind: 'webtools' }, sourceText: 'Hello', sourceLanguage: 'auto', targetLanguage: 'zh-CN', openGeneration: 7,
  })
  assert.equal(result.ok, true)
  assert.deepEqual(env.calls.websites[1], [null, 'Hello', 'auto', 'zh-CN', 7])
  assert.deepEqual(result.data.settings.activeTab, { kind: 'webtools' })
})

test('unknown website IDs and invalid website bounds fail closed', async () => {
  const env = setup()
  const unavailable = await env.handlers[TRANSLATION2_IPC_CHANNELS.selectTab]({}, {
    tab: { kind: 'website', providerId: 'youdao' }, sourceText: 'Hello', sourceLanguage: 'auto', targetLanguage: 'zh-CN', openGeneration: 7,
  })
  assert.equal(unavailable.ok, false)
  assert.equal(unavailable.error.code, 'TRANSLATION_WEBSITE_UNAVAILABLE')
  assert.equal(env.calls.websites.length, 0)

  const bounds = await env.handlers[TRANSLATION2_IPC_CHANNELS.setWebsiteBounds]({}, { x: -1, y: 0, width: 10, height: 10 })
  assert.equal(bounds.ok, false)
  assert.equal(bounds.error.code, 'INVALID_TRANSLATION_WEBSITE_BOUNDS')
})

test('imported service operations stay behind the Translation window boundary', async () => {
  const { handlers, calls } = setup()
  const draft = { definition: { schemaVersion: 1 }, secret: 'secret' }
  assert.equal((await handlers[TRANSLATION2_IPC_CHANNELS.testImportedDraft]({}, draft)).ok, true)
  assert.equal((await handlers[TRANSLATION2_IPC_CHANNELS.saveImported]({}, { ...draft, name: 'Demo' })).ok, true)
  assert.equal((await handlers[TRANSLATION2_IPC_CHANNELS.updateImported]({}, 'imported-demo-0001', { enabled: false })).ok, true)
  assert.equal((await handlers[TRANSLATION2_IPC_CHANNELS.testImported]({}, 'imported-demo-0001')).ok, true)
  assert.equal((await handlers[TRANSLATION2_IPC_CHANNELS.deleteImported]({}, 'imported-demo-0001')).ok, true)
  assert.deepEqual(calls.imported.map(call => call[0]), ['test-draft', 'save', 'update', 'test', 'delete'])
})

test('cancel and close are explicit and bounded', async () => {
  const { handlers, calls } = setup()
  assert.deepEqual(await handlers[TRANSLATION2_IPC_CHANNELS.cancel]({}, request.requestId), { ok: true, data: { cancelled: true } })
  assert.deepEqual(await handlers[TRANSLATION2_IPC_CHANNELS.cancel]({}, 'bad'), { ok: false, error: { code: 'INVALID_REQUEST', message: '翻译请求标识无效。' } })
  assert.deepEqual(await handlers[TRANSLATION2_IPC_CHANNELS.close]({}), { ok: true, data: undefined })
  assert.deepEqual(calls.cancelled, [request.requestId])
  assert.equal(calls.closed, 1)
})

test('restoring defaults deactivates a remote website view before selecting the native tab', async () => {
  const env = setup()
  await env.handlers[TRANSLATION2_IPC_CHANNELS.restoreDefaults]({})
  assert.equal(env.calls.websites.length, 1)
  assert.equal(env.calls.websites[0][0], null)
  assert.deepEqual(env.getSettings().activeTab, { kind: 'webtools' })
})
