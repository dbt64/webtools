import test from 'node:test'
import assert from 'node:assert/strict'
import { MyMemoryAdapter } from './mymemory-adapter.ts'
import { TranslationService } from './translation-service.ts'

const signal = new AbortController().signal

test('uses the fixed public endpoint with automatic source detection and no credential', async () => {
  let calledUrl
  let calledOptions
  const adapter = new MyMemoryAdapter(async (url, options) => {
    calledUrl = url
    calledOptions = options
    return new Response(JSON.stringify({ responseStatus: 200, quotaFinished: false, responseData: { translatedText: '你好' } }), { status: 200 })
  })
  const result = await adapter.translate({ text: 'hello world', sourceLanguage: 'auto', targetLanguage: 'zh-CN', signal })

  assert.equal(result, '你好')
  assert.equal(calledUrl.origin, 'https://api.mymemory.translated.net')
  assert.equal(calledUrl.pathname, '/get')
  assert.equal(calledUrl.searchParams.get('q'), 'hello world')
  assert.equal(calledUrl.searchParams.get('langpair'), 'en|zh-CN')
  assert.equal(calledUrl.searchParams.has('key'), false)
  assert.equal(calledOptions.method, 'GET')
  assert.equal(calledOptions.redirect, 'manual')
  assert.equal(calledOptions.signal, signal)
})

for (const [text, source] of [
  ['Hello, world! 🌍', 'en'],
  ['This is a translation test.', 'en'],
  ['你好，世界！', 'zh-CN'],
  ['这是一个翻译测试。', 'zh-CN'],
  ['こんにちは世界', 'ja'],
  ['日本語の翻訳です。', 'ja'],
]) {
  test(`resolves automatic source for ${JSON.stringify(text)} before calling MyMemory`, async () => {
    let calledUrl
    const adapter = new MyMemoryAdapter(async url => {
      calledUrl = url
      return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: 'traduction' } }))
    })
    assert.equal(await adapter.translate({ text, sourceLanguage: 'auto', targetLanguage: 'fr', signal }), 'traduction')
    assert.equal(calledUrl.searchParams.get('langpair'), `${source}|fr`)
    assert.equal(calledUrl.searchParams.get('q'), text)
  })
}

for (const text of ['test', 'bonjour le monde', 'hola mundo', 'café', '日本語', '東京', 'hello 世界 😀', '你好こんにちは', 'Привет мир', '123 🌍']) {
  test(`rejects ambiguous or unsupported automatic source ${JSON.stringify(text)} without a provider request`, async () => {
    let calls = 0
    const adapter = new MyMemoryAdapter(async () => {
      calls += 1
      return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: 'wrong language result' } }))
    })
    await assert.rejects(
      adapter.translate({ text, sourceLanguage: 'auto', targetLanguage: 'en', signal }),
      error => error.code === 'FREE_TRANSLATION_SOURCE_REQUIRED' && /来源语言/.test(error.message),
    )
    assert.equal(calls, 0)
  })
}

test('explicit en bypasses source detection and keeps the valid language pair', async () => {
  const adapter = new MyMemoryAdapter(async url => {
    assert.equal(url.searchParams.get('langpair'), 'en|zh-CN')
    return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: '你好世界' } }))
  })
  assert.equal(await adapter.translate({ text: 'hello world', sourceLanguage: 'en', targetLanguage: 'zh-CN', signal }), '你好世界')
})

test('returns source text when resolved source equals target without an invalid same-language request', async () => {
  const adapter = new MyMemoryAdapter(async () => { throw new Error('unexpected same-language request') })
  assert.equal(await adapter.translate({ text: '你好，世界！', sourceLanguage: 'auto', targetLanguage: 'zh-CN', signal }), '你好，世界！')
})

test('an already cancelled request rejects before source detection or network work', async () => {
  const controller = new AbortController()
  controller.abort(new DOMException('cancelled', 'AbortError'))
  const adapter = new MyMemoryAdapter(async () => { throw new Error('unexpected request') })
  await assert.rejects(
    adapter.translate({ text: 'hello world', sourceLanguage: 'auto', targetLanguage: 'zh-CN', signal: controller.signal }),
    error => error.name === 'AbortError',
  )
})

function serviceWithAdapter(adapter, timeoutMs = 1000) {
  return new TranslationService({
    dataStore: { snapshot: () => ({ settings: { sharedAI: {}, translation: { engine: 'mymemory' } } }) },
    sharedAI: { complete: () => { throw new Error('unexpected AI call') } },
    aiCredentials: { get: () => { throw new Error('unexpected credential access') } },
    myMemoryAdapter: adapter,
    qwenMtAdapter: { translate: () => { throw new Error('unexpected Qwen call') } },
    timeoutMs,
  })
}

const requestId = 'mymemory-test-001'
const autoRequest = { requestId, text: 'hello world', sourceLanguage: 'auto', targetLanguage: 'zh-CN' }

test('source resolution failure clears the active service request and permits a later explicit source', async () => {
  const adapter = new MyMemoryAdapter(async () => new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: '译文' } })))
  const service = serviceWithAdapter(adapter)
  await assert.rejects(service.translate({ ...autoRequest, text: 'bonjour le monde' }), error => error.code === 'FREE_TRANSLATION_SOURCE_REQUIRED')
  assert.equal(service.cancel(requestId), false)
  assert.equal((await service.translate({ ...autoRequest, text: 'bonjour le monde', sourceLanguage: 'fr' })).translation, '译文')
  assert.equal(service.cancel(requestId), false)
})

test('provider failure after source resolution clears the active service request', async () => {
  const service = serviceWithAdapter(new MyMemoryAdapter(async () => new Response('', { status: 503 })))
  await assert.rejects(service.translate(autoRequest), error => error.code === 'FREE_TRANSLATION_UNAVAILABLE')
  assert.equal(service.cancel(requestId), false)
})

for (const mode of ['timeout', 'cancel']) {
  test(`${mode} aborts the resolved MyMemory request and clears active service state`, async () => {
    let started
    const ready = new Promise(resolve => { started = resolve })
    const adapter = new MyMemoryAdapter((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
      started()
    }))
    const service = serviceWithAdapter(adapter, mode === 'timeout' ? 10 : 1000)
    const pending = service.translate(autoRequest)
    const rejected = assert.rejects(pending, error => error.code === (mode === 'timeout' ? 'TRANSLATION_TIMEOUT' : 'TRANSLATION_CANCELLED'))
    await ready
    if (mode === 'cancel') assert.equal(service.cancel(requestId), true)
    await rejected
    assert.equal(service.cancel(requestId), false)
  })
}

test('enforces the public API 500 UTF-8 byte limit before sending text', async () => {
  let calls = 0
  const adapter = new MyMemoryAdapter(async () => { calls += 1; throw new Error('unexpected request') })
  await assert.rejects(
    () => adapter.translate({ text: '你'.repeat(167), sourceLanguage: 'zh-CN', targetLanguage: 'en', signal }),
    (error) => error.code === 'FREE_TRANSLATION_TOO_LONG',
  )
  assert.equal(calls, 0)
})

test('reports exhausted anonymous quota instead of displaying a warning as a translation', async () => {
  const adapter = new MyMemoryAdapter(async () => new Response(JSON.stringify({
    responseStatus: 200,
    quotaFinished: true,
    responseData: { translatedText: 'MYMEMORY WARNING: free limit reached' },
  }), { status: 200 }))
  await assert.rejects(
    () => adapter.translate({ text: 'hello', sourceLanguage: 'en', targetLanguage: 'zh-CN', signal }),
    (error) => error.code === 'FREE_TRANSLATION_QUOTA',
  )
})
