import test from 'node:test'
import assert from 'node:assert/strict'
import { isTranslationPreviewCandidate } from './translation-preview.ts'
import { parseSuperPanelSettings, DEFAULT_SUPER_PANEL_SETTINGS } from './super-panel-settings.ts'

test('English preview is bounded and excludes non-text actions, mixed scripts and malformed input', () => {
  for (const text of ['capability', 'Hello world!', 'getUserName', 'selected_text', 'This is a sentence.\nNext line.', 'It’s fine — really.']) {
    assert.equal(isTranslationPreviewCandidate(text), true, text)
  }
  for (const text of ['', ' \t', '123456', '中文', 'hello 中文', 'Hello 🙂', 'https://example.com', 'user@example.com', '<script>', 'a\u0000', '\ud800']) {
    assert.equal(isTranslationPreviewCandidate(text), false, text)
  }
  assert.equal(isTranslationPreviewCandidate('a'.repeat(3000)), true)
  assert.equal(isTranslationPreviewCandidate('a'.repeat(3001)), false)
})

test('old panel preferences remain readable and never opt into external translation', () => {
  const old = { enabled: true, mouseButton: 'middle', gesture: 'hold', holdMilliseconds: 600 }
  assert.equal(DEFAULT_SUPER_PANEL_SETTINGS.autoTranslationPreview, false)
  assert.equal(parseSuperPanelSettings(old)?.autoTranslationPreview, false)
  assert.equal(parseSuperPanelSettings({ ...old, autoTranslationPreview: true })?.autoTranslationPreview, true)
  assert.equal(parseSuperPanelSettings({ ...old, autoTranslationPreview: 'true' }), null)
  assert.equal(parseSuperPanelSettings({ ...old, arbitrary: true }), null)
})
