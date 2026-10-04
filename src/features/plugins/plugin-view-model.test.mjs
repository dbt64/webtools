import test from 'node:test'
import assert from 'node:assert/strict'
import { isProxy, reactive } from 'vue'
import { pluginCanOpen, pluginGrantPayload, pluginInstallFeedback, pluginPermissionRows, pluginStatusView, pluginTextActionLimit } from './plugin-view-model.ts'

const plugin = (overrides = {}) => ({ id: 'org.example.demo', name: 'Demo', version: '1.0.0', hash: 'a'.repeat(64), enabled: false, status: 'installed-disabled', requested: ['manager.page', 'sharedAI.complete'], granted: [], installedVersions: ['1.0.0'], source: 'local-unsigned', ...overrides })

test('plugin states distinguish disabled, missing permission, incompatible and validation failures', () => {
  assert.equal(pluginStatusView(plugin()).label, '已停用')
  assert.equal(pluginStatusView(plugin({ enabled: true, status: 'needs-permission' })).label, '需要权限')
  assert.equal(pluginStatusView(plugin({ status: 'incompatible', errorCode: 'INCOMPATIBLE_PLUGIN' })).tone, 'warning')
  assert.equal(pluginStatusView(plugin({ status: 'invalid', errorCode: 'INTEGRITY_FAILED' })).recovery, '请重新导入原始插件包。')
})

test('only enabled active plugins with the page capability appear in Apps navigation', () => {
  assert.equal(pluginCanOpen(plugin({ enabled: true, status: 'active', granted: ['manager.page'] })), true)
  assert.equal(pluginCanOpen(plugin({ enabled: true, status: 'invoking', granted: ['manager.page'] })), true)
  assert.equal(pluginCanOpen(plugin({ enabled: true, status: 'active', granted: [] })), false)
  assert.equal(pluginCanOpen(plugin({ enabled: false, status: 'installed-disabled', granted: ['manager.page'] })), false)
})

test('permission display exposes requested, granted and missing capability state without implying trust', () => {
  assert.deepEqual(pluginPermissionRows(plugin({ granted: ['manager.page'] })), [
    { id: 'manager.page', requested: true, granted: true, label: '添加 Manager 页面' },
    { id: 'sharedAI.complete', requested: true, granted: false, label: '使用共享 AI' },
  ])
  assert.equal(pluginStatusView(plugin()).trust, '本地导入；发布者未经验证')
})

test('permission IPC payload copies Vue reactive grants into a structured-cloneable array', () => {
  const draft = reactive(['manager.page', 'plugin.config.read'])
  const payload = pluginGrantPayload(draft)
  assert.deepEqual(payload, ['manager.page', 'plugin.config.read'])
  assert.equal(isProxy(payload), false)
})

test('install feedback distinguishes new install, upgrade and reauthorization state', () => {
  const installed = { outcome: 'installed', change: { kind: 'upgrade', currentVersion: '1.0.0', incomingVersion: '2.0.0' }, plugin: plugin({ enabled: true, status: 'needs-permission' }) }
  assert.match(pluginInstallFeedback(installed), /1\.0\.0.*2\.0\.0/)
  assert.match(pluginInstallFeedback(installed), /需要重新授权/)
  assert.match(pluginInstallFeedback({ outcome: 'installed', change: { kind: 'new-install', incomingVersion: '1.0.0' }, plugin: plugin() }), /新插件保持停用/)
})

test('clipboard confirmation input limit matches the native dialog safe preview cap', () => {
  assert.equal(pluginTextActionLimit('clipboard.write'), 24_000)
  assert.equal(pluginTextActionLimit('plugin.storage.write'), 50_000)
  assert.equal(pluginTextActionLimit('sharedAI.complete'), 50_000)
})
