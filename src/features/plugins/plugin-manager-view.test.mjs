import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import vue from '@vitejs/plugin-vue'
import { createServer } from 'vite'

const source = await readFile(new URL('./PluginManagerView.vue', import.meta.url), 'utf8')

test('rendered network permission is disabled and unchecked while approved storage permission stays selectable', async t => {
  const server = await createServer({ configFile: false, plugins: [vue()], optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' })
  t.after(() => server.close())
  const { default: View } = await server.ssrLoadModule('/src/features/plugins/PluginManagerView.vue')
  const entry = { kind: 'web', id: 'org.example.network', source: 'local-unsigned', icon: { kind: 'fallback' }, entry: { kind: 'web-features' },
    management: { canToggle: true, canManageGrants: true, canUninstall: true, canReplacePackage: true }, package: { id: 'org.example.network', manifestVersion: 2,
    name: 'Network', version: '1.0.0', hash: 'a'.repeat(64), enabled: false, status: 'incompatible', requested: ['network.domains', 'plugin.storage.read'],
    granted: ['network.domains'], installedVersions: ['1.0.0'], source: 'local-unsigned', webFeatures: [] } }
  const html = await renderToString(createSSRApp(View, { entries: [entry], loading: false }))
  const rows = [...html.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/g)].map(match => match[1])
  const network = rows.find(row => row.includes('访问声明的网络域名')); const storage = rows.find(row => row.includes('读取插件私有数据'))
  assert.ok(network); assert.match(network.match(/<input[^>]*>/)[0], /\bdisabled\b/); assert.doesNotMatch(network.match(/<input[^>]*>/)[0], /\bchecked\b/)
  assert.ok(storage); assert.doesNotMatch(storage.match(/<input[^>]*>/)[0], /\bdisabled\b/)
})

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
