import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const app = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')

test('Manager exposes one website workspace named 网址 and keeps Favorites as its default home', () => {
  assert.match(app, /const activeSection = ref<Section>\('favorites'\)/)
  assert.match(app, /\{ id: 'favorites', label: '网址', icon:/)
  assert.doesNotMatch(app, /\{ id: 'entries', label: '网址'/)
  assert.doesNotMatch(app, /label: '收藏夹'/)
  assert.match(app, /<FavoritesView v-if="activeSection === 'favorites'"/)
  assert.doesNotMatch(app, /<EntriesView/)
})

test('legacy Native entries intent resolves to the consolidated website workspace', () => {
  assert.match(app, /intent\.section === 'entries'\s*\?\s*'favorites'/)
  assert.match(app, /activeSection\.value = targetSection/)
})
