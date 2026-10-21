import assert from 'node:assert/strict'
import test from 'node:test'
import { parseNativeManagerCommand } from './native-manager-commands.ts'
import { ElectronHostOwnership } from './electron-host-ownership.ts'

test('page, plugin and Translation commands execute under their owned intent rather than the pipe envelope ID', async () => {
  for (const [type, payload] of [
    ['open-page', { section: 'favorites' }],
    ['open-plugin', { ref: { kind: 'builtin', id: 'webtools.translation' } }],
    ['translation-prefill', { text: 'first source' }],
  ]) {
    const ownership = new ElectronHostOwnership()
    ownership.replace({ revision: 1, sessionIds: [], requests: [{ requestId: 'intent-123', state: 'delivered' }] })
    ownership.connected()
    const command = parseNativeManagerCommand({ protocolVersion: 1, requestId: 'transport-456', type, payload: { requestId: 'intent-123', ...payload } })
    let executions = 0
    assert.equal(await ownership.execute(command.requestId, async () => ++executions), 1, type)
    const replay = parseNativeManagerCommand({ protocolVersion: 1, requestId: 'transport-retry-789', type, payload: { requestId: 'intent-123', ...payload } })
    assert.equal(await ownership.execute(replay.requestId, async () => ++executions), 1, type)
    assert.equal(executions, 1, type)
  }
})

test('summon requests carry no cached window or Feature identity', () => {
  const command = payload => ({ protocolVersion: 1, requestId: 'focus-1', type: 'focus-current-temporary-window', payload })
  assert.deepEqual(parseNativeManagerCommand(command({})), { kind: 'focus-current-temporary-window' })
  for (const payload of [{ ref: { pluginId: 'org.example.focus', featureId: 'home' } }, { windowId: 1 }, null, []])
    assert.throws(() => parseNativeManagerCommand(command(payload)))
})

test('Native plugin command preserves composite identity and rejects paths/extra fields/builtin spoofing', () => {
  const command = ref => ({ protocolVersion: 1, requestId: 'plugin-1', type: 'open-plugin', payload: { requestId: 'intent-1', ref } })
  for (const kind of ['builtin', 'declarative'])
    assert.deepEqual(parseNativeManagerCommand(command({ kind, id: 'webtools.translation' })), { kind: 'open-plugin', requestId: 'intent-1', ref: { kind, id: 'webtools.translation' } })
  for (const ref of [{ id: 'webtools.translation' }, { kind: 'builtin', id: 'org.example.notes' }, { kind: 'declarative', id: '../private' }, { kind: 'declarative', id: 'org.example.notes', path: 'C:/archive' }])
    assert.throws(() => parseNativeManagerCommand(command(ref)))
})

test('parses only fixed, typed Manager actions and preserves exact translation text', () => {
  assert.deepEqual(parseNativeManagerCommand({ protocolVersion: 1, requestId: 'home-1', type: 'open-page', payload: { requestId: 'intent-home', section: 'favorites' } }), {
    kind: 'open-page', requestId: 'intent-home', section: 'favorites',
  })
  assert.deepEqual(parseNativeManagerCommand({ protocolVersion: 1, requestId: 'page-1', type: 'open-page', payload: { requestId: 'intent-1', section: 'settings' } }), {
    kind: 'open-page', requestId: 'intent-1', section: 'settings',
  })
  assert.deepEqual(parseNativeManagerCommand({ protocolVersion: 1, requestId: 'translate-1', type: 'translation-prefill', payload: { requestId: 'intent-2', text: '  exact text  ' } }), {
    kind: 'translation-prefill', requestId: 'intent-2', handoffRequestId: 'intent-2', text: '  exact text  ',
  })
  assert.throws(() => parseNativeManagerCommand({ protocolVersion: 1, requestId: 'bad', type: 'execute', payload: { command: 'not allowed' } }), /unsupported/i)
  assert.throws(() => parseNativeManagerCommand({ protocolVersion: 1, requestId: 'bad', type: 'open-page', payload: { requestId: 'intent-3', section: 'search' } }), /page request/i)
  assert.throws(() => parseNativeManagerCommand({ protocolVersion: 1, requestId: 'bad', type: 'open-page', payload: { section: 'https://example.com' } }), /page request/i)
})

test('feature-invoke accepts exact bounded FeatureRef requests from supported invocation surfaces', async () => {
  const invoke = payload => ({ protocolVersion: 1, requestId: 'native-envelope-1', type: 'feature-invoke', payload })
  const ref = { pluginId: 'org.example.notes', featureId: 'legacy-manager-page' }
  const requestId = '6528d127-0182-4a60-9e4b-8c89070c50f0'
  const { parseNativeManagerCommand } = await import('./native-manager-commands.ts')
  assert.deepEqual(parseNativeManagerCommand(invoke({ requestId, ref, source: 'launcher' })), {
    kind: 'feature-invoke', request: { requestId, ref, source: 'launcher' },
  })
  assert.deepEqual(parseNativeManagerCommand(invoke({ requestId, ref, source: 'super-panel' })), {
    kind: 'feature-invoke', request: { requestId, ref, source: 'super-panel' },
  })
  for (const payload of [
    { requestId, ref, source: 'launcher', pageId: 'home' },
    { requestId: 'not-a-uuid', ref, source: 'launcher' },
    { requestId, ref, source: 'unsupported' },
    { requestId, ref: { ...ref, path: 'C:\\private' }, source: 'launcher' },
    { requestId, ref: { pluginId: 'x'.repeat(2048), featureId: 'legacy-manager-page' }, source: 'launcher' },
  ]) assert.throws(() => parseNativeManagerCommand(invoke(payload)))
})
