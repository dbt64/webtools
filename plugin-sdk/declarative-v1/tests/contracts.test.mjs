import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { ACTION_TYPES_V1, API_MAJOR_V1, BLOCK_TYPES_V1, CAPABILITIES_V1, LIMITS_V1, MANIFEST_VERSION_V1 } from '../index.mjs'
import { parseManifest } from '../../../electron/plugins/manifest.ts'

const root = new URL('../', import.meta.url)
const schema = JSON.parse(await readFile(new URL('manifest.schema.json', root), 'utf8'))

test('published schema is closed and declares only the host v1 authoring surface', () => {
  assert.equal(MANIFEST_VERSION_V1, 1)
  assert.equal(API_MAJOR_V1, 1)
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema')
  assert.equal(schema.additionalProperties, false)
  assert.deepEqual(Object.keys(schema.properties).sort(), ['actions', 'api', 'assets', 'author', 'description', 'entry', 'id', 'manifestVersion', 'name', 'pages', 'requestedCapabilities', 'settings', 'type', 'version'].sort())
  assert.equal(schema.properties.manifestVersion.const, 1)
  assert.equal(schema.properties.type.const, 'declarative-manager')
  assert.equal(schema.properties.api.properties.apiMajor.const, 1)
  assert.deepEqual(schema.properties.requestedCapabilities.items.enum, ['manager.page', 'plugin.config.read', 'plugin.config.write', 'plugin.storage.read', 'plugin.storage.write', 'external.open', 'clipboard.write', 'sharedAI.complete'])
  assert.deepEqual(CAPABILITIES_V1, schema.properties.requestedCapabilities.items.enum)
  assert.deepEqual(BLOCK_TYPES_V1, ['heading', 'paragraph', 'text-input', 'select', 'checkbox', 'divider', 'button'])
  assert.ok(ACTION_TYPES_V1.includes('sharedAI.complete'))
  assert.equal(LIMITS_V1.archive, 20 * 1024 * 1024)
  assert.match(schema.properties.id.pattern, /a-z0-9/)
  assert.equal(schema.properties.assets.maxItems, 255)
})

test('schema documents closed page, action and setting unions without host-internal fields', () => {
  const nestedText = JSON.stringify(schema)
  for (const hiddenField of ['pluginPath', 'installPath', 'registry', 'builtin', 'trusted', 'secretStore', 'ipcChannel']) assert.equal(nestedText.includes(`"${hiddenField}"`), false)
  assert.ok(schema.$defs.page.properties.blocks.items.oneOf.length >= 4)
  assert.ok(schema.properties.actions.items.oneOf.length >= 3)
  assert.equal(schema.properties.settings.items.oneOf.length, 4)
})

test('literal author manifest agrees with the actual host parser and rejects internal fields', () => {
  const example = { manifestVersion: 1, id: 'org.example.sdk.contract', name: 'Contract sample', description: '', author: { name: 'Example' }, version: '1.0.0', api: { apiMajor: 1, minHostVersion: '0.1.0' }, type: 'declarative-manager', entry: { pageId: 'home', label: 'Sample' }, requestedCapabilities: ['manager.page'], settings: [], pages: [{ id: 'home', title: 'Home', blocks: [{ type: 'paragraph', text: 'Sample page' }] }], actions: [], assets: [] }
  assert.equal(parseManifest(Buffer.from(JSON.stringify(example)), '0.1.0').id, 'org.example.sdk.contract')
  assert.throws(() => parseManifest(Buffer.from(JSON.stringify({ ...example, installPath: 'C:/private' })), '0.1.0'))
})
