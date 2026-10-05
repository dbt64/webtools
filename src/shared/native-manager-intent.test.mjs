import test from 'node:test'
import assert from 'node:assert/strict'
import { parseNativeManagerIntent } from './native-manager-intent.ts'

test('preload intent parser forwards exact tagged plugin identities and existing fixed intents', () => {
  for (const value of [
    { requestId: 'request-1', kind: 'open-plugin', ref: { kind: 'declarative', id: 'webtools.translation' } },
    { requestId: 'request-2', kind: 'open-plugin', ref: { kind: 'builtin', id: 'webtools.translation' } },
    { requestId: 'request-3', kind: 'open-page', section: 'settings' },
    { requestId: 'request-4', kind: 'translation-handoff' },
  ]) assert.deepEqual(parseNativeManagerIntent(value), value)
})
test('preload intent parser denies missing/bare refs, forged builtins, paths and raw text', () => {
  for (const value of [null, {requestId:'',kind:'translation-handoff'}, {requestId:'x',kind:'translation-handoff',text:'raw'},
    {requestId:'x',kind:'open-page',section:'https://example.com'},
    ...['org.example.notes', {id:'org.example.notes'}, {kind:'builtin',id:'org.example.notes'}, {kind:'declarative',id:'../private'}, {kind:'declarative',id:'org.example.notes',path:'C:/file'}].map(ref => ({requestId:'x',kind:'open-plugin',ref}))])
    assert.equal(parseNativeManagerIntent(value), null)
})
