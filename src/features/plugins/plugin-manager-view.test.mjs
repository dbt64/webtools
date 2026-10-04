import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./PluginManagerView.vue', import.meta.url), 'utf8')

test('plugin center includes explicit empty, loading, error and retry states', () => {
  for (const text of ['正在读取已安装的插件', '尚未安装插件', '重新加载']) assert.ok(source.includes(text))
})

test('plugin center exposes install, enable/disable, grants, details and uninstall through the typed host API', () => {
  for (const text of ['installFromUserDialog', 'setEnabled', 'setGrants', 'uninstall', 'pluginPermissionRows', 'iconDataUrl', '完整性摘要']) assert.ok(source.includes(text))
})

test('plugin center never accepts a filesystem path, renders HTML, or claims publisher trust from a digest', () => {
  assert.doesNotMatch(source, /v-html|filePaths|node:fs|confirmed\s*:/)
  assert.ok(source.includes('发布者未经验证'))
  assert.ok(source.includes('完整性摘要'))
})
