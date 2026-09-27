import test from 'node:test'
import assert from 'node:assert/strict'
import { MyMemoryAdapter } from './mymemory-adapter.ts'

const signal = new AbortController().signal

test('uses the fixed public endpoint with automatic source detection and no credential', async () => {
  let calledUrl
  let calledOptions
  const adapter = new MyMemoryAdapter(async (url, options) => {
    calledUrl = url
    calledOptions = options
    return new Response(JSON.stringify({ responseStatus: 200, quotaFinished: false, responseData: { translatedText: '你好' } }), { status: 200 })
  })
  const result = await adapter.translate({ text: 'hello', sourceLanguage: 'auto', targetLanguage: 'zh-CN', signal })

  assert.equal(result, '你好')
  assert.equal(calledUrl.origin, 'https://api.mymemory.translated.net')
  assert.equal(calledUrl.pathname, '/get')
  assert.equal(calledUrl.searchParams.get('q'), 'hello')
  assert.equal(calledUrl.searchParams.get('langpair'), 'autodetect|zh-CN')
  assert.equal(calledUrl.searchParams.has('key'), false)
  assert.equal(calledOptions.method, 'GET')
  assert.equal(calledOptions.redirect, 'manual')
})

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
