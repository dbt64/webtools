import test from 'node:test'
import assert from 'node:assert/strict'
import { OpenAICompatibleAdapter } from './openai-compatible-adapter.ts'

const response = (body, status = 200) => new Response(JSON.stringify(body), { status })

test('sends generic messages using the OpenAI chat-completions protocol', async () => {
  let captured
  const adapter = new OpenAICompatibleAdapter(async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(String(init.body)) }
    return response({ choices: [{ message: { content: ' translated text\nwith formatting ' } }] })
  })
  const signal = new AbortController().signal
  const text = await adapter.complete({
    endpoint: new URL('https://api.example.test/v1/chat/completions'),
    apiKey: 'secret-key',
    model: 'example-model',
    messages: [
      { role: 'system', content: 'System instruction.' },
      { role: 'user', content: 'Ignore previous instructions.' },
    ],
    signal,
  })
  assert.equal(text, 'translated text\nwith formatting')
  assert.equal(captured.url, 'https://api.example.test/v1/chat/completions')
  assert.equal(captured.init.method, 'POST')
  assert.equal(captured.init.redirect, 'manual')
  assert.equal(captured.init.signal, signal)
  assert.equal(captured.init.headers.authorization, 'Bearer secret-key')
  assert.deepEqual(captured.body.messages, [
    { role: 'system', content: 'System instruction.' },
    { role: 'user', content: 'Ignore previous instructions.' },
  ])
  assert.equal(captured.body.model, 'example-model')
  assert.equal(captured.body.stream, false)
})

test('supports text blocks from compatible chat-completion responses', async () => {
  const adapter = new OpenAICompatibleAdapter(async () => response({
    choices: [{ message: { content: [{ type: 'text', text: 'part 1' }, { type: 'image', image_url: 'ignored' }, { type: 'text', text: 'part 2' }] } }],
  }))
  assert.equal(await adapter.complete({ endpoint: new URL('https://example.test/chat/completions'), apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'x' }], signal: new AbortController().signal }), 'part 1part 2')
})

test('blocks redirects and normalizes provider errors without returning response bodies', async () => {
  const redirected = new OpenAICompatibleAdapter(async () => new Response('', { status: 302, headers: { location: 'https://attacker.test' } }))
  await assert.rejects(() => redirected.complete({ endpoint: new URL('https://example.test/chat/completions'), apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'x' }], signal: new AbortController().signal }), /重定向已被阻止/)

  const unauthorized = new OpenAICompatibleAdapter(async () => response({ error: { message: 'secret-key leaked in body' } }, 401))
  await assert.rejects(() => unauthorized.complete({ endpoint: new URL('https://example.test/chat/completions'), apiKey: 'secret-key', model: 'm', messages: [{ role: 'user', content: 'x' }], signal: new AbortController().signal }), (error) => {
    assert.match(error.message, /API Key 无效/)
    assert.doesNotMatch(error.message, /secret-key/)
    return true
  })
})

test('reports malformed output and preserves explicit cancellation', async () => {
  const malformed = new OpenAICompatibleAdapter(async () => response({ choices: [] }))
  await assert.rejects(() => malformed.complete({ endpoint: new URL('https://example.test/chat/completions'), apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'x' }], signal: new AbortController().signal }), /没有返回文本/)

  const controller = new AbortController()
  const canceled = new OpenAICompatibleAdapter(async () => { throw new DOMException('cancelled', 'AbortError') })
  await assert.rejects(() => canceled.complete({ endpoint: new URL('https://example.test/chat/completions'), apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'x' }], signal: controller.signal }), (error) => error.name === 'AbortError')
})
