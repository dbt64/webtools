import test from 'node:test'
import assert from 'node:assert/strict'
import { formatPluginConsentDetail } from './plugin-consent-view.ts'

test('version consent explains old/new versions, permission delta and reauthorization', () => {
  const detail = formatPluginConsentDetail({
    kind: 'upgrade', pluginId: 'org.example.demo', name: 'Demo', version: '2.0.0', capabilities: ['manager.page', 'sharedAI.complete'],
    versionChange: {
      kind: 'upgrade', currentVersion: '1.0.0', incomingVersion: '2.0.0',
      addedCapabilities: ['sharedAI.complete'], removedCapabilities: ['clipboard.write'], reauthorizationRequired: true,
    },
  })

  assert.match(detail, /当前版本：1\.0\.0/)
  assert.match(detail, /即将导入：2\.0\.0/)
  assert.match(detail, /升级/)
  assert.match(detail, /新增申请能力：使用共享 AI/)
  assert.match(detail, /不再申请能力：写入剪贴板/)
  assert.match(detail, /需要重新授权/)
})

test('new plugin consent says import alone grants no capability', () => {
  const detail = formatPluginConsentDetail({
    kind: 'install', pluginId: 'org.example.demo', name: 'Demo', version: '1.0.0', capabilities: ['manager.page'],
    versionChange: { kind: 'new-install', incomingVersion: '1.0.0', addedCapabilities: ['manager.page'], removedCapabilities: [], reauthorizationRequired: false },
  })

  assert.match(detail, /当前版本：未安装/)
  assert.match(detail, /新插件将保持停用/)
  assert.match(detail, /不会自动授予/)
})
