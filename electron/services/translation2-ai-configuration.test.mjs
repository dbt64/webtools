import test from 'node:test'
import assert from 'node:assert/strict'
import { Translation2AIConfiguration } from './translation2-ai-configuration.ts'

test('AI setup saves a named provider credential in secret storage, tests that provider and never returns a key', async () => {
  let data = { settings: { sharedAI: { defaultProviderId: 'openai', providers: {} } } }
  const keys = new Map(), invoked = []
  const service = new Translation2AIConfiguration({
    store: { snapshot: () => data, update: async fn => (data = fn(data)) },
    credentials: { get: async id => keys.get(id) ?? null, set: async (id, key) => { keys.set(id, key) }, clear: async id => { keys.delete(id) } },
    sharedAI: { getProviderInfo: async id => ({ configured: keys.has(id), hasApiKey: keys.has(id), model: data.settings.sharedAI.providers[id]?.model || '' }), testConnection: async (_signal, id) => { invoked.push(id); return { text: keys.get(id) } } },
  })
  const key = 'sk-test-only-not-real-credential-0000000'
  const saved = await service.save({ providerId: 'deepseek', config: { model: 'deepseek-flash' }, secret: key })
  assert.equal(keys.get('deepseek'), key)
  assert.equal(data.settings.sharedAI.defaultProviderId, 'openai')
  assert.equal(JSON.stringify(data).includes(key), false)
  assert.equal(JSON.stringify(saved).includes(key), false)
  const tested = await service.test('deepseek')
  assert.deepEqual(invoked, ['deepseek'])
  assert.equal(JSON.stringify(tested).includes(key), false)
  await assert.rejects(() => service.save({ providerId: 'deepseek', config: { model: key }, secret: '' }))
})
