import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

test('optional theme stylesheet is a public, packaged, token-consuming CSS entry only', async () => {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'))
  assert.equal(packageJson.exports['./theme.css'], './web/theme.css')
  assert.ok(packageJson.files.includes('web'))

  const css = await readFile(path.join(packageRoot, 'web', 'theme.css'), 'utf8')
  const selectors = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:^|})\s*([^{}]+)\s*\{/g)]
    .map(match => match[1].trim())
    .sort()
  assert.deepEqual(selectors, [':root', 'body'])
  assert.match(css, /color-scheme:\s*var\(--webtools-color-scheme,/u)
  assert.match(css, /color:\s*var\(--webtools-color-text,/u)
  assert.match(css, /background-color:\s*var\(--webtools-color-background,/u)
  assert.doesNotMatch(css, /!important|--webtools-color-(?:surface|border|accent)/u)
})
