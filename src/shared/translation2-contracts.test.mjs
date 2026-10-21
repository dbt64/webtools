import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_TRANSLATION2_WEBSITE_ORDER,
  TRANSLATION2_WEBSITE_PROVIDERS,
  createDefaultTranslation2WorkspaceSettings,
  normalizeTranslation2WorkspaceSettings,
  parseTranslation2ImportedApiDefinition,
  validateTranslation2WorkspaceSettings,
} from './translation2-contracts.ts'

test('imported definitions cannot persist API credentials as endpoint or static-field metadata', () => {
  const base = { schemaVersion: 1, id: 'private.api', name: 'Private API', endpoint: 'https://api.example.com/translate', method: 'POST', auth: { kind: 'bearer' }, request: { contentType: 'json', sourceField: 'text', targetLanguageField: 'target' }, response: { kind: 'text' }, timeoutMs: 5000 }
  assert.equal(parseTranslation2ImportedApiDefinition({ ...base, request: { ...base.request, staticFields: { api_key: 'synthetic-private-value' } } }), null)
  assert.equal(parseTranslation2ImportedApiDefinition({ ...base, endpoint: `${base.endpoint}?key=synthetic-private-value` }), null)
  assert.equal(parseTranslation2ImportedApiDefinition({ ...base, request: { ...base.request, staticFields: { model: 'sk-synthetic-private-value-1234567890' } } }), null)
})

test('defaults expose the native WebTools tab, one verified Google slice, and keep other websites disabled', () => {
  const settings = createDefaultTranslation2WorkspaceSettings()

  assert.deepEqual(settings.activeTab, { kind: 'webtools' })
  assert.deepEqual(settings.websiteOrder, DEFAULT_TRANSLATION2_WEBSITE_ORDER)
  assert.deepEqual(settings.visibleWebsiteIds, ['google'])
  assert.deepEqual(settings.selectedService, { kind: 'machine', instanceId: 'builtin.mymemory' })
  assert.deepEqual(settings.machineServices, [{
    id: 'builtin.mymemory',
    name: 'MyMemory 免费翻译',
    adapterId: 'mymemory',
    enabled: true,
    builtIn: true,
    testStatus: 'passed',
  }])
  assert.deepEqual(settings.importedDefinitions, [])
  assert.deepEqual(TRANSLATION2_WEBSITE_PROVIDERS.filter(provider => provider.releaseStatus === 'verified').map(provider => provider.id), ['google'])
})

test('normalization keeps website, machine API, and AI identities separate', () => {
  const normalized = normalizeTranslation2WorkspaceSettings({
    activeTab: { kind: 'website', providerId: 'google' },
    websiteOrder: ['google', 'youdao', 'google', 'invalid'],
    visibleWebsiteIds: ['google', 'invalid'],
    selectedService: { kind: 'ai', providerId: 'deepseek' },
    machineServices: [{
      id: 'custom.deepl.1',
      name: 'DeepL 1',
      adapterId: 'deepl',
      enabled: true,
      builtIn: false,
      testStatus: 'untested',
    }],
  })

  assert.deepEqual(normalized.activeTab, { kind: 'website', providerId: 'google' })
  assert.deepEqual(normalized.visibleWebsiteIds, ['google'])
  assert.deepEqual(normalized.websiteOrder.slice(0, 2), ['google', 'youdao'])
  assert.equal(new Set(normalized.websiteOrder).size, DEFAULT_TRANSLATION2_WEBSITE_ORDER.length)
  assert.deepEqual(normalized.selectedService, { kind: 'ai', providerId: 'deepseek' })
  assert.equal(normalized.machineServices.some(service => service.id === 'custom.deepl.1'), true)
  assert.equal(normalized.machineServices.some(service => service.id === 'builtin.mymemory'), true)
})

test('normalization rejects executable imported definitions and bounded-field violations', () => {
  const normalized = normalizeTranslation2WorkspaceSettings({
    activeTab: { kind: 'webtools' },
    websiteOrder: [],
    visibleWebsiteIds: [],
    selectedService: { kind: 'machine', instanceId: 'bad service' },
    machineServices: [
      { id: 'bad service', name: 'x'.repeat(81), adapterId: 'imported', enabled: true, builtIn: false, definitionId: 'demo', handler: 'return value' },
      { id: 'custom.valid', name: 'Valid', adapterId: 'imported', enabled: true, builtIn: false, definitionId: 'definition.valid' },
    ],
    importedDefinitions: [{
      schemaVersion: 1, id: 'definition.valid', name: 'Valid', endpoint: 'https://api.example.com/translate', method: 'POST',
      auth: { kind: 'none' }, request: { contentType: 'json', sourceField: 'text', targetLanguageField: 'target' },
      response: { kind: 'text' }, timeoutMs: 5000,
    }],
  })

  assert.equal(normalized.machineServices.some(service => service.id === 'bad service'), false)
  assert.equal(normalized.machineServices.some(service => service.id === 'custom.valid'), true)
  assert.deepEqual(normalized.selectedService, { kind: 'machine', instanceId: 'builtin.mymemory' })
  assert.equal(validateTranslation2WorkspaceSettings(normalized), true)
  assert.equal(validateTranslation2WorkspaceSettings({ ...normalized, script: 'alert(1)' }), false)
})

test('strict validation rejects cross-category identifiers and unknown properties', () => {
  const valid = createDefaultTranslation2WorkspaceSettings()
  assert.equal(validateTranslation2WorkspaceSettings(valid), true)
  assert.equal(validateTranslation2WorkspaceSettings({ ...valid, selectedService: { kind: 'website', providerId: 'google' } }), false)
  assert.equal(validateTranslation2WorkspaceSettings({ ...valid, selectedService: { kind: 'ai', providerId: 'not-real' } }), false)
  assert.equal(validateTranslation2WorkspaceSettings({ ...valid, websiteOrder: [...valid.websiteOrder, 'google'] }), false)
})

test('imported API definitions accept only bounded data mappings and no executable hooks', () => {
  const definition = {
    schemaVersion: 1,
    id: 'example.dictionary',
    name: 'Example Dictionary',
    endpoint: 'https://api.example.com/v1/translate',
    method: 'POST',
    auth: { kind: 'header', name: 'X-API-Key' },
    request: {
      contentType: 'json', sourceField: 'text', sourceLanguageField: 'source', targetLanguageField: 'target',
      staticFields: { mode: 'translate', preserveFormatting: true },
    },
    response: { kind: 'json', textPath: ['data', 'translation'] },
    timeoutMs: 12000,
  }

  assert.deepEqual(parseTranslation2ImportedApiDefinition(definition), definition)
  assert.equal(parseTranslation2ImportedApiDefinition({ ...definition, transform: 'return response.text' }), null)
  assert.equal(parseTranslation2ImportedApiDefinition({ ...definition, endpoint: 'http://example.com/translate' }), null)
  assert.equal(parseTranslation2ImportedApiDefinition({ ...definition, auth: { kind: 'header', name: 'Cookie' } }), null)
  assert.equal(parseTranslation2ImportedApiDefinition({ ...definition, response: { kind: 'json', textPath: [] } }), null)
})
