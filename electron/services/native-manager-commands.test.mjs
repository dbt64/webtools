import assert from 'node:assert/strict'
import test from 'node:test'
import { parseNativeManagerCommand } from './native-manager-commands.ts'

test('Native plugin command preserves composite identity and rejects paths/extra fields/builtin spoofing', () => {
  const command = ref => ({ protocolVersion: 1, requestId: 'plugin-1', type: 'open-plugin', payload: { requestId: 'intent-1', ref } })
  for (const kind of ['builtin', 'declarative'])
    assert.deepEqual(parseNativeManagerCommand(command({ kind, id: 'webtools.translation' })), { kind: 'open-plugin', requestId: 'plugin-1', ref: { kind, id: 'webtools.translation' } })
  for (const ref of [{ id: 'webtools.translation' }, { kind: 'builtin', id: 'org.example.notes' }, { kind: 'declarative', id: '../private' }, { kind: 'declarative', id: 'org.example.notes', path: 'C:/archive' }])
    assert.throws(() => parseNativeManagerCommand(command(ref)))
})

test('parses only fixed, typed Manager actions and preserves exact translation text', () => {
  assert.deepEqual(parseNativeManagerCommand({ protocolVersion: 1, requestId: 'home-1', type: 'open-page', payload: { requestId: 'intent-home', section: 'favorites' } }), {
    kind: 'open-page', requestId: 'home-1', section: 'favorites',
  })
  assert.deepEqual(parseNativeManagerCommand({ protocolVersion: 1, requestId: 'page-1', type: 'open-page', payload: { requestId: 'intent-1', section: 'settings' } }), {
    kind: 'open-page', requestId: 'page-1', section: 'settings',
  })
  assert.deepEqual(parseNativeManagerCommand({ protocolVersion: 1, requestId: 'translate-1', type: 'translation-prefill', payload: { requestId: 'intent-2', text: '  exact text  ' } }), {
    kind: 'translation-prefill', requestId: 'translate-1', text: '  exact text  ',
  })
  assert.throws(() => parseNativeManagerCommand({ protocolVersion: 1, requestId: 'bad', type: 'execute', payload: { command: 'not allowed' } }), /unsupported/i)
  assert.throws(() => parseNativeManagerCommand({ protocolVersion: 1, requestId: 'bad', type: 'open-page', payload: { requestId: 'intent-3', section: 'search' } }), /page request/i)
  assert.throws(() => parseNativeManagerCommand({ protocolVersion: 1, requestId: 'bad', type: 'open-page', payload: { section: 'https://example.com' } }), /page request/i)
})

test('feature-invoke accepts only an exact bounded FeatureRef request from the Launcher', async () => {
  const invoke = payload => ({ protocolVersion: 1, requestId: 'native-envelope-1', type: 'feature-invoke', payload })
  const ref = { pluginId: 'org.example.notes', featureId: 'legacy-manager-page' }
  const requestId = '6528d127-0182-4a60-9e4b-8c89070c50f0'
  const { parseNativeManagerCommand } = await import('./native-manager-commands.ts')
  assert.deepEqual(parseNativeManagerCommand(invoke({ requestId, ref, source: 'launcher' })), {
    kind: 'feature-invoke', request: { requestId, ref, source: 'launcher' },
  })
  for (const payload of [
    { requestId, ref, source: 'launcher', pageId: 'home' },
    { requestId: 'not-a-uuid', ref, source: 'launcher' },
    { requestId, ref, source: 'super-panel' },
    { requestId, ref: { ...ref, path: 'C:\\private' }, source: 'launcher' },
    { requestId, ref: { pluginId: 'x'.repeat(2048), featureId: 'legacy-manager-page' }, source: 'launcher' },
  ]) assert.throws(() => parseNativeManagerCommand(invoke(payload)))
})
