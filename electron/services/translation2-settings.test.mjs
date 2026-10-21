import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DataStore } from './data-store.ts'
import { Translation2SettingsService } from './translation2-settings.ts'
import { createDefaultAppData } from '../../src/shared/domain.ts'

test('loading existing v2 data adds Translation 2.0 defaults without changing legacy translation settings', async () => {
  const testRoot = process.env.WEBTOOLS_TEST_ROOT || join(process.cwd(), '.tmp-tests')
  await mkdir(testRoot, { recursive: true })
  const directory = await mkdtemp(join(testRoot, 'translation2-data-'))
  const file = join(directory, 'nook-data.json')
  try {
    const previous = createDefaultAppData()
    previous.settings.translation = { engine: 'ai', sourceLanguage: 'en', targetLanguage: 'ja', qwenMtModel: 'legacy-model' }
    delete previous.settings.translation2
    await writeFile(file, JSON.stringify(previous), 'utf8')

    const store = new DataStore(file)
    const loaded = await store.load()

    assert.deepEqual(loaded.settings.translation, previous.settings.translation)
    assert.deepEqual(loaded.settings.translation2.activeTab, { kind: 'webtools' })
    assert.deepEqual(loaded.settings.translation2.visibleWebsiteIds, ['google'])
    assert.equal(JSON.parse(await readFile(file, 'utf8')).settings.translation2, undefined, 'normalization does not silently rewrite user data on read')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('settings updates accept only a complete normalized workspace projection', async () => {
  let state = createDefaultAppData()
  const service = new Translation2SettingsService({
    snapshot: () => structuredClone(state),
    update: async mutate => { state = mutate(structuredClone(state)); return structuredClone(state) },
  })
  const next = structuredClone(state.settings.translation2)
  next.selectedService = { kind: 'ai', providerId: 'anthropic' }

  assert.deepEqual((await service.update(next)).selectedService, { kind: 'ai', providerId: 'anthropic' })
  await assert.rejects(() => service.update({ ...next, selectedService: { kind: 'website', providerId: 'google' } }), /设置无效/)
  assert.deepEqual(service.get().selectedService, { kind: 'ai', providerId: 'anthropic' })
})

test('restore defaults keeps user-created machine services but resets built-in choices', async () => {
  let state = createDefaultAppData()
  state.settings.translation2.machineServices.push({
    id: 'custom.deepl.1', name: 'DeepL 1', adapterId: 'deepl', enabled: true, builtIn: false, testStatus: 'untested',
  })
  state.settings.translation2.selectedService = { kind: 'machine', instanceId: 'custom.deepl.1' }
  const service = new Translation2SettingsService({
    snapshot: () => structuredClone(state),
    update: async mutate => { state = mutate(structuredClone(state)); return structuredClone(state) },
  })

  const restored = await service.restoreDefaults()

  assert.deepEqual(restored.selectedService, { kind: 'machine', instanceId: 'builtin.mymemory' })
  assert.deepEqual(restored.visibleWebsiteIds, ['google'])
  assert.equal(restored.machineServices.some(item => item.id === 'custom.deepl.1'), true)
})
