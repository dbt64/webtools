const test = require('node:test')
const assert = require('node:assert/strict')
const { createRuntimeHost, buildRuntimeOrigin, buildCsp, allowsRuntimeUrl } = require('./policy.cjs')

test('runtime origins use fresh 32-character lowercase random hosts', () => {
  const first = createRuntimeHost()
  const second = createRuntimeHost()
  assert.match(first, /^[0-9a-f]{32}$/)
  assert.match(second, /^[0-9a-f]{32}$/)
  assert.notEqual(first, second)
})

test('runtime resource policy accepts only the exact custom scheme and host', () => {
  const origin = buildRuntimeOrigin('0123456789abcdef0123456789abcdef')
  assert.equal(allowsRuntimeUrl('webtools-plugin://0123456789abcdef0123456789abcdef/web/index.html', origin), true)
  assert.equal(allowsRuntimeUrl('webtools-plugin://1123456789abcdef0123456789abcdef/web/index.html', origin), false)
  assert.equal(allowsRuntimeUrl('https://example.test/', origin), false)
  assert.equal(allowsRuntimeUrl('file:///C:/secret.txt', origin), false)
  assert.equal(allowsRuntimeUrl('javascript:alert(1)', origin), false)
})

test('CSP profiles allow local scripts only and enable WASM narrowly when requested', () => {
  const ordinary = buildCsp({ wasm: false })
  const withWasm = buildCsp({ wasm: true })
  assert.match(ordinary, /script-src 'self'/)
  assert.doesNotMatch(ordinary, /unsafe-inline|unsafe-eval|wasm-unsafe-eval/)
  assert.match(withWasm, /script-src 'self' 'wasm-unsafe-eval'/)
  assert.doesNotMatch(withWasm, /unsafe-inline|unsafe-eval(?:;|\s|$)/)
  assert.match(ordinary, /worker-src 'none'/)
  assert.match(ordinary, /frame-src 'none'/)
})
