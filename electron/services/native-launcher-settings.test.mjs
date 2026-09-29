import assert from 'node:assert/strict'
import test from 'node:test'
import { createDefaultAppData } from '../../src/shared/domain.ts'
import { overlayNativeLauncherSettings, projectWebsitesForNative } from './native-launcher-settings.ts'

test('Native owns only Launcher preferences and keeps Manager-only settings in DataStore', () => {
  const managerSettings = createDefaultAppData().settings
  managerSettings.websiteLayout = 'list'
  managerSettings.translation.engine = 'webtools-ai'
  const native = {
    schemaVersion: 1,
    quickSearchShortcut: 'Control+Alt+J',
    theme: 'light',
    launcherDisplayMode: 'expanded',
    launchOnStartup: true,
    searchEngines: [{ id: 'bing', name: 'Bing', template: 'https://bing.com/?q=%s', enabled: true, builtIn: false, order: 0 }],
    defaultSearchEngineId: 'bing',
    everythingEnabled: false,
    everythingEsPath: '',
    websites: [],
    appSearchMemory: [],
  }
  const merged = overlayNativeLauncherSettings(managerSettings, native)
  assert.equal(merged.quickSearchShortcut, 'Control+Alt+J')
  assert.equal(merged.defaultSearchEngineId, 'bing')
  assert.equal(merged.websiteLayout, 'list')
  assert.equal(merged.translation.engine, 'webtools-ai')
})

test('Native website synchronization wraps the lightweight projection in an object payload', () => {
  const projection = projectWebsitesForNative([{
    id: 'site-1', name: 'Docs', url: 'https://docs.example', favicon: 'data:image/png;base64,secret', folderIds: ['folder-1'], createdAt: 123,
  }])
  assert.deepEqual(projection, { websites: [{ id: 'site-1', name: 'Docs', url: 'https://docs.example', description: '', folderIds: ['folder-1'] }] })
})
