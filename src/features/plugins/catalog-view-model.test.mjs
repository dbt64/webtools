import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { builtinPluginEntries } from '../../../electron/plugins/builtin-plugin-registry.ts'
import { catalogCanOpen, catalogKey, catalogRef, catalogNavigationItems, catalogShouldReturnToCenter, isCurrentCatalogRequest, catalogPresentation } from './catalog-view-model.ts'

const builtin = builtinPluginEntries('0.1.0')[0]
const pkg = { kind: 'declarative', id: builtin.id, source: 'local-unsigned', icon: { kind: 'fallback' }, package: { id: builtin.id, name: 'Third Party', enabled: true, status: 'active', granted: ['manager.page'] } }
test('tagged catalog navigation is ordered, collision-safe and filters unavailable packages', () => {
  assert.notEqual(catalogKey(builtin), catalogKey(pkg))
  assert.deepEqual(catalogRef(pkg), { kind: 'declarative', id: builtin.id })
  assert.deepEqual(catalogNavigationItems([builtin, pkg]).map(item => item.ref.kind), ['builtin', 'declarative'])
  for (const status of ['invalid', 'incompatible', 'installed-disabled', 'needs-permission']) assert.equal(catalogCanOpen({ ...pkg, package: { ...pkg.package, status } }), false)
  assert.equal(catalogCanOpen({ ...pkg, package: { ...pkg.package, granted: [] } }), false)
  assert.equal(catalogCanOpen({ ...pkg, package: { ...pkg.package, status: 'invoking' } }), true)
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
test('built-in presentation has bundled status, never unsigned package trust', () => {
  assert.equal(catalogPresentation(builtin).name, '翻译')
  assert.equal(catalogPresentation(builtin).status.label, '可用 · 内置')
  assert.equal(catalogPresentation(pkg).name, 'Third Party')
})
test('Manager center uses separate builtin details with no package/disable operations', async () => {
  const app = await readFile(new URL('../../App.vue', import.meta.url), 'utf8')
  const center = await readFile(new URL('./PluginManagerView.vue', import.meta.url), 'utf8')
  assert.ok(app.includes('<span>插件</span>'))
  assert.ok(app.includes('<span>插件管理</span>'))
  assert.ok(app.includes('window.desktop.pluginCatalog.open'))
  assert.ok(app.includes('activePluginRef'))
  const builtinBranch = center.slice(center.indexOf('v-if="selected?.kind === \'builtin\'"'), center.indexOf('v-else-if="selectedPackage"'))
  assert.ok(builtinBranch.includes('随 WebTools 发布'))
  assert.ok(builtinBranch.includes('打开翻译'))
  assert.doesNotMatch(builtinBranch, /SHA-256|uninstall|toggle\(|setGrants|停用|发布者未经验证/)
})
