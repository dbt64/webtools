import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SecretStoreCore } from './secret-store-core.ts'
import { AIProviderCredentialStore } from './ai-credentials.ts'

function createFakeCipher(delayMs = 0) {
  return {
    isAvailable: async () => true,
    encrypt: async (value) => {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
      return Buffer.from(`encrypted:${value}`).toString('base64')
    },
    decrypt: async (value) => {
      const decoded = Buffer.from(value, 'base64').toString('utf8')
      if (!decoded.startsWith('encrypted:')) throw new Error('bad ciphertext')
      return decoded.slice('encrypted:'.length)
    },
  }
}

test('serializes concurrent secret writes so independent credentials are not lost', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'webtools-secret-'))
  try {
    const store = new SecretStoreCore(join(directory, 'secrets.json'), createFakeCipher(5))
    await Promise.all([
      store.setSecret('ai-openai', 'openai-key'),
      store.setSecret('ai-deepseek', 'deepseek-key'),
      store.setSecret('translation-google-cloud-basic', 'cloud-key'),
    ])
    assert.equal(await store.getSecret('ai-openai'), 'openai-key')
    assert.equal(await store.getSecret('ai-deepseek'), 'deepseek-key')
    assert.equal(await store.getSecret('translation-google-cloud-basic'), 'cloud-key')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('keeps provider credentials isolated and reads the legacy AI key for Custom', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'webtools-secret-'))
  try {
    const secrets = new SecretStoreCore(join(directory, 'secrets.json'), createFakeCipher())
    const credentials = new AIProviderCredentialStore(secrets)
    await secrets.setSecret('ai-api-key', 'legacy-custom-key')
    await credentials.set('openai', 'openai-key')

    assert.equal(await credentials.get('custom'), 'legacy-custom-key')
    assert.equal(await credentials.get('openai'), 'openai-key')
    assert.equal(await credentials.get('deepseek'), null)
    await credentials.clear('custom')
    assert.equal(await credentials.get('custom'), null)
    assert.equal(await credentials.get('openai'), 'openai-key')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
