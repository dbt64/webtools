import test from 'node:test'
import assert from 'node:assert/strict'
import { Translation2DeepLAdapter } from './translation2-deepl.ts'

test('DeepL uses the selected API endpoint, header auth, language mapping and bounded result', async () => {
  const calls = []
  const adapter = new Translation2DeepLAdapter(async (url, init) => {
    calls.push({ url: String(url), init })
    return Response.json({ translations: [{ text: '你好' }] })
  })
  const result = await adapter.translate({ apiPlan: 'free', secret: 'test-key', text: 'Hello', sourceLanguage: 'auto', targetLanguage: 'zh-CN', signal: new AbortController().signal })
  assert.equal(result, '你好')
  assert.equal(calls[0].url, 'https://api-free.deepl.com/v2/translate')
  assert.equal(calls[0].init.headers.Authorization, 'DeepL-Auth-Key test-key')
  assert.deepEqual(JSON.parse(calls[0].init.body), { text: ['Hello'], target_lang: 'ZH-HANS' })
  assert.equal(calls[0].init.redirect, 'manual')
  await adapter.translate({ apiPlan: 'pro', secret: 'test-key', text: '你好', sourceLanguage: 'zh-CN', targetLanguage: 'en', signal: new AbortController().signal })
  assert.equal(calls[1].url, 'https://api.deepl.com/v2/translate')
  assert.equal(JSON.parse(calls[1].init.body).source_lang, 'ZH')
})
