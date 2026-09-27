import test from 'node:test'
import assert from 'node:assert/strict'
import { GoogleCloudBasicAdapter } from './google-cloud-basic-adapter.ts'

test('uses Cloud Translation Basic v2 with the API key only in its header', async () => {
  let captured
  const adapter = new GoogleCloudBasicAdapter(async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(String(init.body)) }
    return new Response(JSON.stringify({ data: { translations: [{ translatedText: 'Hola', detectedSourceLanguage: 'en' }] } }), { status: 200 })
  })
  const text = await adapter.translate({ apiKey: 'cloud-secret', text: 'Hello', sourceLanguage: 'auto', targetLanguage: 'es', signal: new AbortController().signal })
  assert.equal(text, 'Hola')
  assert.equal(captured.url, 'https://translation.googleapis.com/language/translate/v2')
  assert.equal(captured.init.method, 'POST')
  assert.equal(captured.init.redirect, 'manual')
  assert.equal(captured.init.headers['x-goog-api-key'], 'cloud-secret')
  assert.equal(captured.url.includes('cloud-secret'), false)
  assert.deepEqual(captured.body, { q: 'Hello', target: 'es', format: 'text' })
})

test('sends an explicitly selected source language and preserves text in the request', async () => {
  let body
  const adapter = new GoogleCloudBasicAdapter(async (_url, init) => {
    body = JSON.parse(String(init.body))
    return new Response(JSON.stringify({ data: { translations: [{ translatedText: 'Hello' }] } }), { status: 200 })
  })
  await adapter.translate({ apiKey: 'key', text: '你好\n第二行', sourceLanguage: 'zh-CN', targetLanguage: 'en', signal: new AbortController().signal })
  assert.deepEqual(body, { q: '你好\n第二行', source: 'zh-CN', target: 'en', format: 'text' })
})

test('normalizes key, quota, service and malformed response errors without exposing body content', async () => {
  for (const [status, expected] of [[403, /API Key 无效/], [429, /配额|频繁/], [503, /暂时不可用/]]) {
    const adapter = new GoogleCloudBasicAdapter(async () => new Response('cloud-secret and input', { status }))
    await assert.rejects(() => adapter.translate({ apiKey: 'cloud-secret', text: 'hello', sourceLanguage: 'auto', targetLanguage: 'en', signal: new AbortController().signal }), (error) => {
      assert.match(error.message, expected)
      assert.doesNotMatch(error.message, /cloud-secret|input/)
      return true
    })
  }

  const malformed = new GoogleCloudBasicAdapter(async () => new Response(JSON.stringify({ data: { translations: [] } }), { status: 200 }))
  await assert.rejects(() => malformed.translate({ apiKey: 'key', text: 'hello', sourceLanguage: 'auto', targetLanguage: 'en', signal: new AbortController().signal }), /没有返回译文/)
})
