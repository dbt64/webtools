import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./TranslationApp.vue', import.meta.url), 'utf8')

test('provider tabs switch through the narrow host API and publish bounded website geometry', () => {
  assert.match(source, /window\.translation2\.selectTab\(/)
  assert.match(source, /window\.translation2\.setWebsiteBounds\(/)
  assert.match(source, /getBoundingClientRect\(\)/)
  assert.doesNotMatch(source, /:disabled="provider\.releaseStatus/)
})

test('a newer Host open re-hands exact source to the active website and lifecycle cleanup cancels native work', () => {
  assert.match(source, /onOpened\(open =>[\s\S]*selectTab\(activeTab\.value, true\)/)
  assert.match(source, /onBeforeUnmount\([\s\S]*translation2\.cancel/)
  assert.match(source, /websiteResizeObserver\?\.disconnect\(\)/)
})

test('website source fallback is visible instead of silently claiming synchronization', () => {
  assert.match(source, /网站中的最新原文无法读取/)
  assert.match(source, /websiteSyncNotice/)
})
