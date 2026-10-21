import assert from 'node:assert/strict'
import test from 'node:test'
import { FeatureQuickResultConsent } from './feature-quick-result-consent.ts'

const requestId = '6528d127-0182-4a60-9e4b-8c89070c50f0'
const ref = { pluginId: 'org.example.quick', featureId: 'quick-text' }
const consent = { kind: 'ai', pluginId: ref.pluginId, name: 'Synthetic', version: '1.0.0', preview: 'synthetic prompt' }
const until = async read => { for (let i = 0; i < 100; i++) { if (read()) return; await new Promise(resolve => setImmediate(resolve)) } assert.fail('confirmation not registered') }

test('same-window consent requires one exact decision and rechecks provider before send', async () => {
  let provider = 'first'; let sent; let calls = 0
  const adapter = new FeatureQuickResultConsent({ provider: async () => ({ identity: provider, label: 'Synthetic provider' }), send: async value => { sent = value } })
  const signal = new AbortController().signal
  const pending = adapter.confirm(requestId, ref, consent, signal)
  await until(() => sent)
  assert.equal(calls, 0)
  assert.equal(adapter.decide({ requestId, ref, consentId: sent.consentId, approved: true }), true)
  assert.equal(adapter.decide({ requestId, ref, consentId: sent.consentId, approved: true }), false)
  assert.equal(await pending, true)
  provider = 'changed'
  await assert.rejects(adapter.runApproved({ requestId, ref }, signal, async () => { calls++; return 'forbidden' }))
  assert.equal(calls, 0)
})

test('cancel, mismatch and provider switch discard waiting approval without blocking the reader', async () => {
  for (const action of ['cancel', 'provider-change']) {
    let sent; let provider = 'first'; const controller = new AbortController()
    const adapter = new FeatureQuickResultConsent({ provider: async () => ({ identity: provider, label: 'Synthetic' }), send: async value => { sent = value } })
    const pending = adapter.confirm(requestId, ref, consent, controller.signal)
    await until(() => sent)
    assert.equal(adapter.decide({ requestId, ref: { ...ref, featureId: 'forged' }, consentId: sent.consentId, approved: true }), false)
    if (action === 'cancel') controller.abort()
    else { provider = 'changed'; adapter.decide({ requestId, ref, consentId: sent.consentId, approved: true }) }
    assert.equal(await pending, false)
    assert.equal(adapter.pending.size, 0)
  }
})

test('approved provider runs once and command cancellation releases retained consent state', async () => {
  let sent; const controller = new AbortController()
  const adapter = new FeatureQuickResultConsent({ provider: async () => ({ identity: 'same', label: 'Synthetic' }), send: async value => { sent = value } })
  const pending = adapter.confirm(requestId, ref, consent, controller.signal)
  await until(() => sent); adapter.decide({ requestId, ref, consentId: sent.consentId, approved: true })
  assert.equal(await pending, true)
  assert.equal(await adapter.runApproved({ requestId, ref }, controller.signal, async () => 'answer'), 'answer')
  await assert.rejects(adapter.runApproved({ requestId, ref }, controller.signal, async () => 'duplicate'))
  controller.abort(); adapter.close(); assert.equal(adapter.approved.size, 0)
})
