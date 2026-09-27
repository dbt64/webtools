import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDefaultAppData } from '../../src/shared/domain.ts'
import { DataStore } from './data-store.ts'

test('normalizes legacy v2 AI settings to Custom without losing the original fields', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'webtools-data-'))
  const filePath = join(directory, 'data.json')
  const legacy = createDefaultAppData()
  delete legacy.settings.sharedAI
  delete legacy.settings.translation
  legacy.settings.aiBaseUrl = 'https://legacy.example/v1'
  legacy.settings.aiModel = 'legacy-model'
  await writeFile(filePath, JSON.stringify(legacy), 'utf8')

  try {
    const store = new DataStore(filePath)
    const loaded = await store.load()
    assert.equal(loaded.version, 2)
    assert.equal(loaded.settings.sharedAI.defaultProviderId, 'custom')
    assert.deepEqual(loaded.settings.sharedAI.providers.custom, {
      model: 'legacy-model',
      baseUrl: 'https://legacy.example/v1',
    })
    assert.equal(loaded.settings.aiBaseUrl, 'https://legacy.example/v1')
    assert.equal(loaded.settings.aiModel, 'legacy-model')
    assert.deepEqual(loaded.settings.translation, {
      engine: 'mymemory',
      sourceLanguage: 'auto',
      targetLanguage: 'zh-CN',
      qwenMtModel: 'qwen-mt-flash',
    })
    const persisted = JSON.parse(await readFile(filePath, 'utf8'))
    assert.equal(persisted.version, 2)
    assert.equal(persisted.settings.aiBaseUrl, 'https://legacy.example/v1')
    assert.equal(persisted.settings.aiModel, 'legacy-model')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('normalizes pre-2.0 v2 data without AI fields into deterministic defaults', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'webtools-data-'))
  const filePath = join(directory, 'data.json')
  const existing = createDefaultAppData()
  delete existing.settings.sharedAI
  delete existing.settings.translation
  await writeFile(filePath, JSON.stringify(existing), 'utf8')

  try {
    const loaded = await new DataStore(filePath).load()
    assert.equal(loaded.settings.sharedAI.defaultProviderId, 'openai')
    assert.deepEqual(loaded.settings.sharedAI.providers, {})
    assert.equal(loaded.settings.translation.engine, 'mymemory')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('migrates an existing Google Cloud selection to the keyless default', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'webtools-data-'))
  const filePath = join(directory, 'data.json')
  const existing = createDefaultAppData()
  existing.settings.translation.engine = 'google-cloud-basic'
  await writeFile(filePath, JSON.stringify(existing), 'utf8')

  try {
    const loaded = await new DataStore(filePath).load()
    assert.equal(loaded.settings.translation.engine, 'mymemory')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('drops malformed provider configuration while preserving valid provider settings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'webtools-data-'))
  const filePath = join(directory, 'data.json')
  const existing = createDefaultAppData()
  existing.settings.sharedAI = {
    defaultProviderId: 'openai',
    providers: {
      openai: { model: 'gpt-4.1-mini' },
      deepseek: { model: 'deepseek-flash', baseUrl: 'https://attacker.invalid' },
      unknown: { model: 'not-a-provider' },
    },
  }
  await writeFile(filePath, JSON.stringify(existing), 'utf8')

  try {
    const loaded = await new DataStore(filePath).load()
    assert.deepEqual(loaded.settings.sharedAI.providers, {
      openai: { model: 'gpt-4.1-mini' },
      deepseek: { model: 'deepseek-flash' },
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
