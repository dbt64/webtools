import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('all Native translation entry points use the independent window without Manager navigation or waiting for a provider', async () => {
  const main = await readFile(new URL('../main.ts',import.meta.url),'utf8')
  const begin = main.indexOf('async function openTranslation2Window(')
  const body = main.slice(begin,main.indexOf('function acknowledgeNativeManagerIntent',begin))
  assert.ok(begin>0)
  assert.match(body,/translationPreview\?\.invalidate\(\)/)
  assert.match(body,/translationService\?\.cancelAll\(\)/)
  assert.match(body,/await translationWindow\.open\(text\)/)
  assert.doesNotMatch(body,/showManager|handoff|\.translate\(/i)
  assert.match(main,/command\.section === 'translate'[\s\S]*?openTranslation2Window\(command\.requestId, null\)/)
  assert.match(main,/openTranslation: \(requestId, text\) => openTranslation2Window\(requestId, text \?\? null\)/)
  assert.match(main,/await openTranslation2Window\(command\.requestId, command\.text\)/)
})
