import test from 'node:test'
import assert from 'node:assert/strict'
import { Translation2ImportedApiExecutor } from './translation2-imported-api.ts'

const definition = {
  schemaVersion: 1,
  id: 'local.acceptance',
  name: 'Local acceptance',
  endpoint: 'http://127.0.0.1:43191/translate',
  method: 'POST',
  auth: { kind: 'bearer' },
  request: {
    contentType: 'json', sourceField: 'q', sourceLanguageField: 'source', targetLanguageField: 'target',
    staticFields: { format: 'text' },
  },
  response: { kind: 'json', textPath: ['result', 'text'] },
  timeoutMs: 5000,
}

test('executor builds one bounded request, extracts text, and never returns the credential', async () => {
  const calls = []
  const executor = new Translation2ImportedApiExecutor(async (url, init) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify({ result: { text: '你好' } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  })

  const result = await executor.translate({
    definition, secret: 'acceptance-secret', text: 'hello', sourceLanguage: 'auto', targetLanguage: 'zh-CN', signal: new AbortController().signal,
  })

  assert.equal(result, '你好')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, definition.endpoint)
  assert.equal(calls[0].init.redirect, 'manual')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer acceptance-secret')
  assert.deepEqual(JSON.parse(calls[0].init.body), { q: 'hello', source: 'auto', target: 'zh-CN', format: 'text' })
})

test('executor rejects redirects, oversized output, missing response path, and unsafe remote http', async () => {
  const redirect = new Translation2ImportedApiExecutor(async () => new Response('', { status: 302, headers: { location: 'https://other.example/' } }))
  await assert.rejects(() => redirect.translate({ definition, secret: 'x', text: 'hello', sourceLanguage: 'auto', targetLanguage: 'zh-CN', signal: new AbortController().signal }), /redirect/i)

  const missing = new Translation2ImportedApiExecutor(async () => new Response('{"wrong":true}', { status: 200, headers: { 'content-type': 'application/json' } }))
  await assert.rejects(() => missing.translate({ definition, secret: 'x', text: 'hello', sourceLanguage: 'auto', targetLanguage: 'zh-CN', signal: new AbortController().signal }), /response/i)

  const unsafe = structuredClone(definition)
  unsafe.endpoint = 'http://api.example.com/translate'
  await assert.rejects(() => missing.translate({ definition: unsafe, secret: 'x', text: 'hello', sourceLanguage: 'auto', targetLanguage: 'zh-CN', signal: new AbortController().signal }), /endpoint/i)
})
