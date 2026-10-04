import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const renderer = await readFile(new URL('./DeclarativePluginView.vue', import.meta.url), 'utf8')
const reviewDialog = await readFile(new URL('./PluginAIReviewDialog.vue', import.meta.url), 'utf8')

test('declarative rendering is an exhaustive fixed host component with plain text only', () => {
  for (const type of ['heading', 'paragraph', 'text-input', 'select', 'checkbox', 'divider', 'button']) assert.ok(renderer.includes(`'${type}'`) || renderer.includes(`type === '${type}'`))
  assert.doesNotMatch(renderer, /v-html|<component\s+:is|import\([^)]*plugin|eval\s*\(|new Function/)
})

test('declarative actions use typed invoke and keep late results scoped to the current page', () => {
  assert.ok(renderer.includes('window.desktop.plugins.invoke'))
  assert.ok(renderer.includes('pageGeneration'))
  assert.ok(renderer.includes('prepareAIReview'))
  assert.ok(renderer.includes('cancelAIReview'))
})

test('AI review renders every returned message and confirms only its opaque review ID', () => {
  assert.ok(reviewDialog.includes('review.messages'))
  assert.ok(reviewDialog.includes('confirmAIReview'))
  assert.ok(reviewDialog.includes('white-space: pre-wrap'))
  assert.doesNotMatch(reviewDialog, /slice\s*\(|confirmed\s*:\s*true|v-html/)
})

test('clipboard input is locally limited to the native consent preview maximum', () => {
  assert.ok(renderer.includes('pluginTextActionLimit(actionInput.value.action.type)'))
  assert.ok(renderer.includes(':maxlength="actionInputLimit"'))
  assert.ok(renderer.includes('24,000'))
})
