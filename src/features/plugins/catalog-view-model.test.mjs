import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { builtinPluginEntries } from '../../../electron/plugins/builtin-plugin-registry.ts'
import { catalogCanOpen, catalogKey, catalogRef, catalogNavigationItems, catalogShouldReturnToCenter, isCurrentCatalogRequest, catalogPresentation } from './catalog-view-model.ts'

const builtin = builtinPluginEntries('0.1.0', { status: 'ready', enabled: true, generation: 0 })[0]
const pkg = { kind: 'declarative', id: builtin.id, source: 'local-unsigned', icon: { kind: 'fallback' }, package: { id: builtin.id, name: 'Third Party', enabled: true, status: 'active', granted: ['manager.page'] } }
test('tagged catalog navigation is ordered, collision-safe and filters unavailable packages', () => {
  assert.notEqual(catalogKey(builtin), catalogKey(pkg))
  assert.deepEqual(catalogRef(pkg), { kind: 'declarative', id: builtin.id })
  assert.deepEqual(catalogNavigationItems([builtin, pkg]).map(item => item.ref.kind), ['builtin', 'declarative'])
  for (const status of ['invalid', 'incompatible', 'installed-disabled', 'needs-permission']) assert.equal(catalogCanOpen({ ...pkg, package: { ...pkg.package, status } }), false)
  assert.equal(catalogCanOpen({ ...pkg, package: { ...pkg.package, granted: [] } }), false)
  assert.equal(catalogCanOpen({ ...pkg, package: { ...pkg.package, status: 'invoking' } }), true)
  const disabledBuiltin = builtinPluginEntries('0.1.0', { status: 'disabled', enabled: false, generation: 1 })[0]
  assert.equal(catalogCanOpen(disabledBuiltin), false)
  assert.deepEqual(catalogNavigationItems([disabledBuiltin, pkg]).map(item => item.ref.kind), ['declarative'])
  assert.equal(catalogPresentation(disabledBuiltin).status.label, '已停用')
  assert.equal(catalogShouldReturnToCenter(catalogRef(pkg), [builtin]), true)
  assert.equal(catalogShouldReturnToCenter(catalogRef(builtin), [builtin]), false)
})
test('page/refresh freshness requires tagged identity, generation and current route', () => {
  const request = { section: 'plugin-page', ref: catalogRef(pkg), generation: 3 }
  assert.equal(isCurrentCatalogRequest(request, request), true)
  assert.equal(isCurrentCatalogRequest({ ...request, ref: catalogRef(builtin) }, request), false)
  assert.equal(isCurrentCatalogRequest({ ...request, section: 'settings' }, request), false)
  assert.equal(isCurrentCatalogRequest({ ...request, generation: 4 }, request), false)
})
test('built-in presentation reflects runtime status without unsigned package trust', () => {
  assert.equal(catalogPresentation(builtin).name, '翻译')
  assert.equal(catalogPresentation(builtin).status.label, '可用 · 内置')
  assert.equal(catalogPresentation(pkg).name, 'Third Party')
  const unavailable = builtinPluginEntries('0.1.0', { status: 'unavailable', enabled: false, errorCode: 'STATE_INVALID', generation: 0 })[0]
  assert.equal(catalogPresentation(unavailable).status.label, '需要恢复')
})
test('Manager center manages the bundled Translation state separately from package operations', async () => {
  const app = await readFile(new URL('../../App.vue', import.meta.url), 'utf8')
  const center = await readFile(new URL('./PluginManagerView.vue', import.meta.url), 'utf8')
  assert.ok(app.includes('<span>插件</span>'))
  assert.ok(app.includes("'插件管理'"), 'the plugin overview remains the empty-selection route')
  assert.ok(app.includes('catalogInstalledNavigationItems(catalogEntries.value)'))
  assert.ok(app.includes('window.desktop.pluginCatalog.open'))
  assert.ok(app.includes('activePluginRef'))
  assert.ok(center.includes("selectedBuiltin ? '随 WebTools 提供的内置功能' : '本机导入的插件包'"))
  assert.ok(center.includes('打开翻译窗口'))
  assert.ok(center.includes('内置翻译已停用'))
  assert.ok(center.includes('备份并恢复状态'))
  assert.ok(center.includes('内置翻译由 WebTools 管理'))
})
