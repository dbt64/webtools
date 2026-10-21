import assert from 'node:assert/strict'
import test from 'node:test'

const loaded = await import('./src/actions.cjs').then(value => value.default, () => null)
const invocation = (text, open, signal = new AbortController().signal) => ({
  context: { type: 'text', source: 'selected-text', text }, signal, webtools: { external: { open } },
})
test('real search action encodes exact selection and does no work before explicit invocation', async () => {
  assert.ok(loaded, 'Selected Text Actions implementation is missing')
  const opened = []
  await loaded.searchSelection(invocation('中文 A&B\n🙂', async url => { opened.push(url) }))
  assert.deepEqual(opened, ['https://www.bing.com/search?q=%E4%B8%AD%E6%96%87+A%26B%0A%F0%9F%99%82'])
  await loaded.searchSelection(invocation('different', async url => { opened.push(url) }))
  assert.equal(opened[1], 'https://www.bing.com/search?q=different')
})
test('open-link example preserves explicit HTTPS target and rejects unsafe or cancelled input', async () => {
  assert.ok(loaded, 'Selected Text Actions implementation is missing')
  const opened = []; const open = async url => { opened.push(url) }
  await loaded.openSelectedLink(invocation(' \nhttps://example.com/path?q=x\t', open))
  assert.deepEqual(opened, ['https://example.com/path?q=x'])
  for (const text of ['file:///D:/x', 'javascript:alert(1)', 'https://user:password@example.com'])
    await assert.rejects(() => loaded.openSelectedLink(invocation(text, open)))
  const controller = new AbortController(); controller.abort()
  await assert.rejects(() => loaded.searchSelection(invocation('cancelled', open, controller.signal)))
  assert.equal(opened.length, 1)
})
