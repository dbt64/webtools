import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { isCurrentPluginPageRequest, pluginNavigationItems, shouldReturnToPluginCenter } from './plugin-navigation.ts'

const active = { id: 'org.example.live', name: 'Live Tool', enabled: true, status: 'active', granted: ['manager.page'], iconDataUrl: 'data:image/png;base64,AA==' }
const disabled = { id: 'org.example.off', name: 'Off Tool', enabled: false, status: 'installed-disabled', granted: ['manager.page'] }

test('Apps navigation keeps enabled plugins accessible during actions and uses safe labels/icons', () => {
  assert.deepEqual(pluginNavigationItems([active, disabled]), [{ id: active.id, label: active.name, iconDataUrl: active.iconDataUrl }])
  assert.deepEqual(pluginNavigationItems([{ ...active, status: 'invoking' }]), [{ id: active.id, label: active.name, iconDataUrl: active.iconDataUrl }])
  assert.deepEqual(pluginNavigationItems([{ ...active, status: 'needs-permission' }]), [])
  assert.deepEqual(pluginNavigationItems([{ ...active, granted: [] }]), [])
})

test('current plugin route falls back after disable, permission loss, invalidation or uninstall', () => {
  assert.equal(shouldReturnToPluginCenter(active.id, [active]), false)
  for (const plugins of [[], [{ ...active, enabled: false }], [{ ...active, status: 'invalid' }], [{ ...active, granted: [] }]]) assert.equal(shouldReturnToPluginCenter(active.id, plugins), true)
})

test('plugin page response is accepted only for the current route and request generation', () => {
  const current = { section: 'plugin-page', pluginId: active.id, generation: 3 }
  assert.equal(isCurrentPluginPageRequest(current, current), true)
  assert.equal(isCurrentPluginPageRequest(current, { ...current, generation: 2 }), false)
  assert.equal(isCurrentPluginPageRequest(current, { ...current, pluginId: disabled.id }), false)
  assert.equal(isCurrentPluginPageRequest({ ...current, section: 'favorites' }, current), false)
})

test('Manager keeps Favorites as the default and preserves the Native Translation handoff', async () => {
  const app = await readFile(new URL('../../App.vue', import.meta.url), 'utf8')
  assert.ok(app.includes("ref<Section>('favorites')"))
  assert.ok(app.includes("intent.kind === 'translation-prefill'"))
  assert.ok(app.includes('acknowledgeNativeManagerIntent'))
  assert.ok(app.includes('pluginNavItems'))
  assert.ok(app.includes('window.desktop.pluginCatalog.open({ ...ref })'))
  assert.ok(app.includes('pluginPageGeneration'))
})
