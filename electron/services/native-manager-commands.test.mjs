import assert from 'node:assert/strict'
import test from 'node:test'
import { parseNativeManagerCommand } from './native-manager-commands.ts'

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
