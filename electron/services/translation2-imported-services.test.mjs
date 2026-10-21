import test from 'node:test'
import assert from 'node:assert/strict'
import { createDefaultAppData } from '../../src/shared/domain.ts'
import { Translation2SettingsService } from './translation2-settings.ts'
import { Translation2ImportedServiceManager } from './translation2-imported-services.ts'

const definition = {
  schemaVersion: 1, id: 'example.translation', name: 'Example Translation', endpoint: 'https://api.example.com/translate', method: 'POST',
  auth: { kind: 'bearer' }, request: { contentType: 'json', sourceField: 'q', targetLanguageField: 'target' },
  response: { kind: 'json', textPath: ['data', 'text'] }, timeoutMs: 5000,
}

for (const mutation of ['unrelated-settings', 'delete', 'secret']) {
  test(`a delayed service test preserves ${mutation} changes instead of restoring its old workspace`, async () => {
    let data = createDefaultAppData(), release
    const settings = new Translation2SettingsService({ snapshot: () => data, update: async fn => (data = fn(data)) })
    const keys = new Map()
    const manager = new Translation2ImportedServiceManager({ settings,
      secrets: { getSecret: async id => keys.get(id) ?? null, setSecret: async (id,key) => { keys.set(id,key) }, deleteSecret: async id => { keys.delete(id) } },
      executor: { translate: () => new Promise(resolve => { release = resolve }) },
    })
    const saved = await manager.save({ definition, name: 'Delayed', secret: 'private-key' })
    const id = saved.selectedService.instanceId
    const pending = manager.test(id)
    while (!release) await new Promise(resolve => setImmediate(resolve))
    if (mutation === 'delete') await manager.delete(id)
    else if (mutation === 'secret') await manager.update(id, { secret: 'replacement-key' })
    else { const latest=settings.get(); latest.visibleWebsiteIds=[]; latest.selectedService={kind:'machine',instanceId:'builtin.mymemory'}; await settings.update(latest) }
    release('测试成功')
    if (mutation === 'unrelated-settings') { await pending; assert.deepEqual(settings.get().visibleWebsiteIds, []); assert.equal(settings.get().selectedService.instanceId,'builtin.mymemory') }
    else { await assert.rejects(()=>pending,/changed|更改|removed|删除/i); if(mutation==='delete') assert.equal(settings.get().machineServices.some(s=>s.id===id),false); else assert.equal(settings.get().machineServices.find(s=>s.id===id).testStatus,'untested') }
  })
}

test('DeepL key form creates a usable named API instance without a definition file or plaintext key in settings', async () => {
  let data = createDefaultAppData()
  const keys = new Map(), requests = []
  const settings = new Translation2SettingsService({ snapshot: () => data, update: async fn => (data = fn(data)) })
  const manager = new Translation2ImportedServiceManager({ settings,
    secrets: { getSecret: async id => keys.get(id) ?? null, setSecret: async (id,key) => { keys.set(id,key) }, deleteSecret: async id => { keys.delete(id) } },
    executor: { translate: async () => { throw new Error('DeepL must not use imported JSON mappings') } },
    deepl: { translate: async input => { requests.push(input); return '你好' } },
  })
  const saved = await manager.saveDeepL({ name: 'DeepL 1', secret: 'controlled-deepl-key', apiPlan: 'free' })
  assert.equal(saved.importedDefinitions.length, 0)
  assert.equal(JSON.stringify(saved).includes('controlled-deepl-key'), false)
  const id = saved.selectedService.instanceId
  assert.equal((await manager.credentialStatus())[id], true)
  const result = await manager.test(id)
  assert.equal(result.translation, '你好'); assert.equal(requests[0].apiPlan, 'free')
  assert.equal(requests[0].secret, 'controlled-deepl-key')
  assert.equal(result.settings.machineServices.find(s=>s.id===id).testStatus, 'passed')
  await manager.update(id, { secret: 'changed-key' })
  await manager.execute(id, { text: 'hello', sourceLanguage: 'auto', targetLanguage: 'zh-CN', signal: new AbortController().signal })
  assert.equal(requests[1].secret, 'changed-key')
  await manager.delete(id); assert.equal(keys.size, 0)
})

function setup({ fail = false } = {}) {
  let state = createDefaultAppData()
  const secrets = new Map()
  const settings = new Translation2SettingsService({
    snapshot: () => structuredClone(state),
    update: async mutate => { state = mutate(structuredClone(state)); return structuredClone(state) },
  })
  const manager = new Translation2ImportedServiceManager({
    settings,
    secrets: {
      getSecret: async key => secrets.get(key) ?? null,
      setSecret: async (key, value) => { secrets.set(key, value) },
      deleteSecret: async key => { secrets.delete(key) },
    },
    executor: { translate: async input => {
      assert.equal(input.secret, 'private-key')
      if (fail) throw new Error('provider failed')
      return '测试成功'
    } },
    createId: () => '11111111-1111-4111-8111-111111111111',
  })
  return { manager, settings, secrets }
}

test('save creates a named imported service while the credential stays outside settings', async () => {
  const env = setup()
  const saved = await env.manager.save({ definition, name: 'Example 1', secret: 'private-key' })
  const service = saved.machineServices.find(item => item.id === 'imported-11111111-1111-4111-8111-111111111111')

  assert.deepEqual(service, {
    id: 'imported-11111111-1111-4111-8111-111111111111', name: 'Example 1', adapterId: 'imported', enabled: true,
    builtIn: false, testStatus: 'untested', definitionId: definition.id,
  })
  assert.equal(saved.importedDefinitions.length, 1)
  assert.equal(JSON.stringify(saved).includes('private-key'), false)
  assert.equal(env.secrets.size, 1)
})

test('test marks the saved service passed and delete removes its definition and credential', async () => {
  const env = setup()
  await env.manager.save({ definition, name: 'Example 1', secret: 'private-key' })
  const tested = await env.manager.test('imported-11111111-1111-4111-8111-111111111111')

  assert.equal(tested.translation, '测试成功')
  assert.equal(tested.settings.machineServices[1].testStatus, 'passed')
  const removed = await env.manager.delete('imported-11111111-1111-4111-8111-111111111111')
  assert.equal(removed.machineServices.length, 1)
  assert.equal(removed.importedDefinitions.length, 0)
  assert.equal(env.secrets.size, 0)
})

test('invalid definitions, missing credentials, built-ins, and failed tests fail closed', async () => {
  const env = setup({ fail: true })
  await assert.rejects(() => env.manager.save({ definition: { ...definition, script: 'run()' }, name: 'Bad', secret: 'private-key' }), /definition/i)
  await assert.rejects(() => env.manager.save({ definition, name: 'Missing key', secret: '' }), /credential/i)
  await assert.rejects(() => env.manager.delete('builtin.mymemory'), /built-in/i)
  await env.manager.save({ definition, name: 'Example 1', secret: 'private-key' })
  await assert.rejects(() => env.manager.test('imported-11111111-1111-4111-8111-111111111111'), /provider failed/)
  assert.equal(env.settings.get().machineServices[1].testStatus, 'failed')
})
