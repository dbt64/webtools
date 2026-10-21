import test from 'node:test'
import assert from 'node:assert/strict'
import { BuiltinTranslationPreview } from './builtin-translation-preview.ts'
import { TranslationService } from './translation-service.ts'
import { ServiceError } from './service-error.ts'

const id = '6528d127-0182-4a60-9e4b-8c89070c50f0'
function fixture(engine = 'mymemory', translate = async () => '真实通路的隔离译文') {
  const settings = { translation: { engine, sourceLanguage: 'auto', targetLanguage: 'zh-CN', qwenMtModel: 'qwen-mt-flash' }, sharedAI: { defaultProviderId: 'custom', providers: { custom: { model: 'stub' }, qwen: { model: 'qwen-mt-flash', region: 'cn-beijing', workspaceId: 'stub' } } } }
  const calls = []; let enabled = true; let admission = 1
  const service = new TranslationService({ dataStore: { snapshot: () => ({ settings: structuredClone(settings) }) },
    aiCredentials: { get: async () => 'isolated-not-a-real-secret' },
    sharedAI: { getDefaultProviderInfo: async () => ({ providerName: 'Stub AI', providerId: 'custom', configured: true }),
      complete: async (messages, signal) => { calls.push({ messages, signal }); return { text: await translate(signal), providerName: 'Stub AI', providerId: 'custom', model: 'stub' } } },
    myMemoryAdapter: { translate: async request => { calls.push(request); return translate(request.signal) } },
    qwenMtAdapter: { translate: async request => { calls.push(request); return translate(request.signal) } },
    translationAdmission: { captureGeneration: () => admission, isGenerationCurrent: value => value === admission }, timeoutMs: 1000 })
  const preview = new BuiltinTranslationPreview({ service, settings: () => structuredClone(settings), enabled: async () => enabled })
  return { settings, calls, service, preview, disable() { enabled = false; preview.invalidate() }, revoke() { admission++; preview.invalidate() } }
}

test('preview reuses each existing TranslationService provider, English auto-source and configured target', async () => {
  for (const engine of ['mymemory', 'ai', 'qwen-mt']) {
    const env = fixture(engine)
    const value = await env.preview.run(id, 'capability', new AbortController().signal)
    assert.match(value.text, /隔离译文/)
    assert.equal(value.isCurrent(), true)
    assert.equal(env.calls.length, 1)
    if (engine !== 'ai') assert.equal(env.calls[0].sourceLanguage, 'en')
    assert.equal(JSON.stringify(env.preview).includes('capability'), false)
  }
})

test('disabled setting, non-English content and provider input limits cause zero provider requests', async () => {
  const disabled = fixture(); disabled.disable()
  assert.equal(await disabled.preview.run(id, 'hello', new AbortController().signal), null)
  const env = fixture()
  for (const text of ['', '中文', 'https://example.com', 'hello 中文', 'a'.repeat(3001)]) {
    assert.equal(await env.preview.run(id, text, new AbortController().signal), null)
  }
  assert.match((await env.preview.run(id, 'a'.repeat(501), new AbortController().signal)).text, /500|过长|限制/)
  env.settings.translation.sourceLanguage = 'ja'
  assert.match((await env.preview.run(id, 'hello', new AbortController().signal)).text, /来源|英语/)
  assert.equal(env.calls.length, 0)
})

test('an unconfigured current provider reports setup state without a provider request or fallback', async () => {
  const env = fixture('ai')
  env.service.getProviderInfo = async () => ({ engine: 'ai', providerName: 'Stub AI', configured: false })
  const value = await env.preview.run(id, 'hello world', new AbortController().signal)
  assert.match(value.text, /尚未配置/)
  assert.equal(env.calls.length, 0)
})

test('cancel, setting change, new preview and admission revoke abort provider work and suppress late output', async () => {
  for (const action of ['cancel', 'settings', 'replace', 'revoke']) {
    let resolve; let started
    const gate = new Promise(done => { started = done })
    const env = fixture('ai', signal => { started(signal); return new Promise(done => { resolve = done }) })
    const abort = new AbortController()
    const pending = env.preview.run(id, 'first English selection', abort.signal)
    const signal = await gate
    if (action === 'cancel') abort.abort()
    if (action === 'settings') env.disable()
    if (action === 'revoke') env.revoke()
    if (action === 'replace') await env.preview.run('eec8790c-1b26-428e-b41f-33acdb9d3fb5', '中文', new AbortController().signal)
    assert.equal(signal.aborted, true)
    resolve('LATE_PRIVATE_OUTPUT')
    assert.equal(await pending, null)
  }
})

test('config changes during provider lookup prevent a request; accepted output is revoked by config change', async () => {
  const env = fixture('ai')
  let release
  const provider = env.service.getProviderInfo.bind(env.service)
  env.service.getProviderInfo = async () => { await new Promise(done => { release = done }); return provider() }
  const pending = env.preview.run(id, 'English text', new AbortController().signal)
  while (!release) await new Promise(done => setImmediate(done))
  env.settings.sharedAI.providers.custom.model = 'changed'; release()
  assert.equal(await pending, null); assert.equal(env.calls.length, 0)
  env.service.getProviderInfo = provider
  const result = await env.preview.run(id, 'English text', new AbortController().signal)
  env.settings.translation.targetLanguage = 'ja'
  assert.equal(result.isCurrent(), false)
})

test('provider errors and oversized output use safe bounded product copy, never raw provider messages', async () => {
  for (const output of [() => { throw new ServiceError('FREE_TRANSLATION_QUOTA', 'PRIVATE_TOKEN_AND_TEXT') }, () => { throw new Error('PRIVATE_TOKEN_AND_TEXT') }, () => 'x'.repeat(8193), () => ' \n']) {
    const env = fixture('mymemory', output)
    const value = await env.preview.run(id, 'private English selection', new AbortController().signal)
    assert.equal(value.text.includes('PRIVATE_TOKEN_AND_TEXT'), false)
    assert.equal(value.text.includes('private English selection'), false)
    assert.ok(value.text.length > 0 && value.text.length < 500)
  }
  const empty = await fixture('mymemory', () => ' \n').preview.run(id, 'English text', new AbortController().signal)
  assert.match(empty.text, /为空|限制/)
})
