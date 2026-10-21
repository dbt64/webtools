import assert from 'node:assert/strict'
import test from 'node:test'
import { FeatureInvocationService } from './feature-invocation-service.ts'

const id = '6528d127-0182-4a60-9e4b-8c89070c50f0'
const quickRef = { pluginId: 'org.example.quick', featureId: 'quick-text' }
const quickRequest = () => ({ requestId: id, ref: quickRef, source: 'super-panel', quickResult: { version: 1 },
  context: { type: 'text', source: 'selected-text', text: 'synthetic input', capturedAtUnixMs: 100000 } })

test('Host-owned Translation preview publishes inline once while the explicit Translation action still opens Manager', async () => {
  const sent = []; let previews = 0
  const ref = { pluginId: 'webtools.translation', featureId: 'translate-text' }
  const env = setup({ now: () => 100000, supportsQuickResult: () => true,
    publishQuickResult: async value => sent.push(value),
    translatePreview: async (_id, text, signal) => { previews++; assert.equal(text, 'synthetic input'); assert.equal(signal.aborted, false); return { text: '译文', isCurrent: () => true } } })
  const input = { ...quickRequest(), ref }
  assert.equal((await env.service.invoke(input)).status, 'completed')
  assert.equal((await env.service.invoke(input)).status, 'completed')
  assert.equal(previews, 1); assert.equal(sent.length, 1); assert.equal(env.calls.length, 0)
  assert.equal((await env.service.invoke({ requestId: 'eec8790c-1b26-428e-b41f-33acdb9d3fb5', ref, source: 'launcher' })).status, 'accepted')
  assert.equal(env.calls[0][0], 'translation')
})

test('cancelled or disabled built-in previews never publish stale output or open Manager', async () => {
  const ref = { pluginId: 'webtools.translation', featureId: 'translate-text' }; let release; const sent = []
  const env = setup({ now: () => 100000, supportsQuickResult: () => true, publishQuickResult: async value => sent.push(value),
    translatePreview: async () => { await new Promise(done => { release = done }); return { text: 'late', isCurrent: () => true } } })
  const input = { ...quickRequest(), ref }; const pending = env.service.invoke(input)
  for (let i = 0; i < 10 && !release; i++) await new Promise(done => setImmediate(done))
  assert.ok(release, 'Host-owned preview was dispatched')
  env.service.cancel(id, ref); release()
  assert.equal((await pending).status, 'cancelled'); assert.equal(sent.length, 0); assert.equal(env.calls.length, 0)
  env.setTranslationEnabled(false)
  assert.equal((await env.service.invoke({ ...input, requestId: 'eec8790c-1b26-428e-b41f-33acdb9d3fb5' })).reasonCode, 'plugin-disabled')
})

test('provider configuration revocation clears the exact accepted built-in preview binding', async () => {
  let current = true; const cleared = []
  const ref = { pluginId: 'webtools.translation', featureId: 'translate-text' }
  const env = setup({ now: () => 100000, supportsQuickResult: () => true, publishQuickResult: async () => {},
    clearQuickResult: async value => cleared.push(value),
    translatePreview: async () => ({ text: '译文', isCurrent: () => current }) })
  assert.equal((await env.service.invoke({ ...quickRequest(), ref })).status, 'completed')
  current = false; await env.service.revalidateDisplayedResult()
  assert.deepEqual(cleared, [{ requestId: id, ref }])
})

test('successful external-only panel commands request dismissal; Quick Result, void, failure and other surfaces do not', async () => {
  const completed = { requestId: id, status: 'completed', reasonCode: 'completed' }
  for (const [outcome, input, expected] of [
    [{ status: 'completed', externalOpened: true }, quickRequest(), { ...completed, dismissPanel: true }],
    [{ status: 'completed', externalOpened: true }, { requestId: id, ref: quickRef, source: 'super-panel' }, { ...completed, dismissPanel: true }],
    [{ status: 'completed', externalOpened: true }, { requestId: id, ref: quickRef, source: 'launcher' }, completed],
    [{ status: 'completed' }, quickRequest(), completed],
    [{ status: 'cancelled', externalOpened: true }, quickRequest(), { requestId: id, status: 'cancelled', reasonCode: 'cancelled' }],
    [{ status: 'completed', externalOpened: true, result: { kind: 'text', text: 'Keep inline' }, isSourceCurrent: () => true }, quickRequest(), completed],
  ]) {
    const env = setup({ now: () => 100000, supportsQuickResult: () => true, isWebFeature: () => true,
      publishQuickResult: async () => {}, activateWebFeature: async () => outcome })
    assert.deepEqual(await env.service.invoke(input), expected)
    assert.deepEqual(await env.service.invoke(input), expected, 'replay preserves disposition without re-executing')
  }
  const failure = setup({ now: () => 100000, supportsQuickResult: () => true, isWebFeature: () => true,
    publishQuickResult: async () => {}, activateWebFeature: async () => { throw Object.assign(new Error('Controlled failure'), { code: 'COMMAND_FAILED' }) } })
  assert.deepEqual(await failure.service.invoke(quickRequest()), { requestId: id, status: 'failed', reasonCode: 'command-failed' })
})

test('authenticated cancellation arriving before invocation reserves a bounded cancelled request', async () => {
  const env = setup({ now: () => 100000, supportsQuickResult: () => true, activateWebFeature: async () => { assert.fail('cancelled request executed') } })
  assert.equal(env.service.cancel(id, quickRef), true)
  assert.equal((await env.service.invoke(quickRequest())).status, 'cancelled')
})

test('Quick Result publishes once before status completion and never retains plaintext in replay', async () => {
  const sent = []; let calls = 0
  const env = setup({ now: () => 100000, supportsQuickResult: () => true, isWebFeature: () => true,
    activateWebFeature: async () => { calls++; return { status: 'completed', result: { kind: 'text', text: 'SYNTHETIC-RESULT-NO-REPLAY' }, isSourceCurrent: () => true } },
    publishQuickResult: async value => { sent.push(value) } })
  assert.equal((await env.service.invoke(quickRequest())).status, 'completed')
  assert.equal(sent.length, 1); assert.equal(sent[0].text, 'SYNTHETIC-RESULT-NO-REPLAY')
  assert.equal(JSON.stringify([...env.service.replay.values()]).includes(sent[0].text), false)
  await env.service.invoke(quickRequest()); assert.equal(calls, 1); assert.equal(sent.length, 1)
})

test('Quick Result cancellation and session disposal discard pending output without deadlocking', async () => {
  for (const disconnect of [false, true]) {
    let release; let options; const sent = []
    const env = setup({ now: () => 100000, supportsQuickResult: () => true, isWebFeature: () => true,
      activateWebFeature: async (_ref, _context, _surface, input) => { options = input; await new Promise(resolve => { release = resolve }); return { status: 'completed', result: { kind: 'text', text: 'late' }, isSourceCurrent: () => true } },
      publishQuickResult: async value => { sent.push(value) } })
    const pending = env.service.invoke(quickRequest())
    while (!release) await new Promise(resolve => setImmediate(resolve))
    assert.equal(env.service.cancel(id, { ...quickRef, featureId: 'other' }), false)
    if (disconnect) env.service.clearSession(); else assert.equal(env.service.cancel(id, quickRef), true)
    assert.equal(options.signal.aborted, true); release()
    assert.equal((await pending).status, 'cancelled'); assert.equal(sent.length, 0)
  }
})

test('Quick Result requires negotiation and live source after cleanup; source revoke clears exact displayed slot', async () => {
  let current = true; let sent = 0; const cleared = []
  const env = setup({ now: () => 100000, supportsQuickResult: () => true, isWebFeature: () => true,
    activateWebFeature: async () => ({ status: 'completed', result: { kind: 'text', text: 'safe' }, isSourceCurrent: () => current }),
    publishQuickResult: async () => { sent++ }, clearQuickResult: async value => { cleared.push(value) } })
  await env.service.invoke(quickRequest()); current = false; await env.service.revalidateDisplayedResult()
  assert.deepEqual(cleared, [{ requestId: id, ref: quickRef }]); assert.equal(sent, 1)
  const rejected = setup({ now: () => 100000, supportsQuickResult: () => false, activateWebFeature: async () => { throw new Error('must not execute') } })
  assert.equal((await rejected.service.invoke(quickRequest())).reasonCode, 'unsupported-feature-kind')
})
const request = (ref, requestId = id) => ({ requestId, ref, source: 'launcher' })
test('Web Feature invocation goes through live authority and typed context expiry without widening Native projection', async () => {
  let captured; let calls = 0; let now = 100000
  const env = setup({ now: () => now, authorizeWeb: async (ref, dispatch) => { calls++; return { completion: dispatch({ featureId: ref.featureId }) } },
    openWeb: async (_id, _authority, context) => { captured = context } })
  const value = { ...request({ pluginId: 'org.example.web', featureId: 'hello' }),
    context: { type: 'text', source: 'launcher-input', text: 'exact 中文', capturedAtUnixMs: now } }
  assert.equal((await env.service.invoke(value)).status, 'accepted')
  assert.deepEqual(captured, { type: 'text', source: 'launcher-input', text: 'exact 中文', ageMs: 0 })
  now += 30000
  assert.equal((await env.service.invoke({ ...value, requestId: 'eec8790c-1b26-428e-b41f-33acdb9d3fb5' })).reasonCode, 'stale-request')
  assert.equal(calls, 1)
})
test('completed invocation replay retains no plaintext context while preserving exact at-most-once discrimination', async () => {
  let calls = 0
  const env = setup({ now: () => 100000, authorizeWeb: async (ref, dispatch) => { calls++; return { completion: dispatch({ featureId: ref.featureId }) } }, openWeb: async () => {} })
  const value = { ...request({ pluginId: 'org.example.web', featureId: 'hello' }), context: {
    type: 'text', source: 'launcher-input', text: 'SYNTHETIC-CONTEXT-MUST-NOT-STAY-IN-REPLAY', capturedAtUnixMs: 100000 } }
  assert.equal((await env.service.invoke(value)).status, 'accepted')
  assert.equal(JSON.stringify([...env.service.replay.values()]).includes(value.context.text), false)
  assert.equal((await env.service.invoke(value)).status, 'accepted'); assert.equal(calls, 1)
  assert.equal((await env.service.invoke({ ...value, context: { ...value.context, text: 'changed' } })).reasonCode, 'stale-request')
})
const pluginFeature = {
  ref: { pluginId: 'org.example.notes', featureId: 'legacy-manager-page' },
  sourceKind: 'declarative',
  title: 'Notes',
  commands: ['Notes'],
  icon: 'plugin',
  requiredCapabilities: ['manager.page'],
  acceptedContexts: [],
  resolvedEntry: { kind: 'declarative-compatibility', pageId: 'home' },
}

function setup(overrides = {}) {
  const calls = []
  let connected = true
  let translationEnabled = true
  const service = new FeatureInvocationService({
    isConnected: () => connected,
    isTranslationEnabled: () => translationEnabled,
    authorizeDeclarative: async (ref, dispatch) => {
      calls.push(['authorize', ref])
      return { completion: dispatch(structuredClone(pluginFeature)) }
    },
    openDeclarative: async (requestId, feature) => { calls.push(['declarative', requestId, feature.resolvedEntry.pageId]) },
    openTranslation: async requestId => { calls.push(['translation', requestId]) },
    ...overrides,
  })
  return { service, calls, setConnected(value) { connected = value }, setTranslationEnabled(value) { translationEnabled = value } }
}

test('valid declarative and built-in invocations dispatch only resolved routes', async () => {
  const env = setup()
  assert.deepEqual(await env.service.invoke(request(pluginFeature.ref)), { requestId: id, status: 'accepted', reasonCode: 'accepted' })
  const translationId = 'eec8790c-1b26-428e-b41f-33acdb9d3fb5'
  assert.deepEqual(await env.service.invoke(request({ pluginId: 'webtools.translation', featureId: 'translate-text' }, translationId)), {
    requestId: translationId, status: 'accepted', reasonCode: 'accepted',
  })
  assert.deepEqual(env.calls.map(call => call[0]), ['authorize', 'declarative', 'translation'])
  assert.deepEqual(env.calls.at(-1), ['translation', translationId], 'the discovery query is never passed as translation context')
})

test('live authority rejection, disabled Translation and stale Manager session fail closed', async () => {
  const disabled = setup({ authorizeDeclarative: async () => { throw Object.assign(new Error('hidden detail'), { code: 'PLUGIN_DISABLED' }) } })
  assert.deepEqual(await disabled.service.invoke(request(pluginFeature.ref)), { requestId: id, status: 'rejected', reasonCode: 'plugin-disabled' })

  const builtin = setup()
  builtin.setTranslationEnabled(false)
  assert.deepEqual(await builtin.service.invoke(request({ pluginId: 'webtools.translation', featureId: 'translate-text' })), { requestId: id, status: 'rejected', reasonCode: 'plugin-disabled' })

  const disconnected = setup()
  disconnected.setConnected(false)
  assert.deepEqual(await disconnected.service.invoke(request(pluginFeature.ref)), { requestId: id, status: 'failed', reasonCode: 'manager-disconnected' })

  const unknownFeature = setup()
  assert.deepEqual(await unknownFeature.service.invoke(request({ pluginId: 'org.example.notes', featureId: 'other-page' })), { requestId: id, status: 'rejected', reasonCode: 'feature-not-found' })
})

test('same request ID is at-most-once and conflicting replay is rejected deterministically', async () => {
  let release
  let invocations = 0
  const env = setup({
    openDeclarative: async () => { invocations++; await new Promise(resolve => { release = resolve }) },
  })
  const first = env.service.invoke(request(pluginFeature.ref))
  const duplicate = env.service.invoke(request(pluginFeature.ref))
  const conflict = await env.service.invoke(request({ pluginId: 'org.example.other', featureId: 'legacy-manager-page' }))
  assert.deepEqual(conflict, { requestId: id, status: 'rejected', reasonCode: 'stale-request' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(invocations, 1)
  release()
  assert.deepEqual(await first, await duplicate)
})

test('a synchronously reentrant duplicate cannot race replay registration', async () => {
  let service
  let reentrant
  let authorizeCount = 0
  let dispatchCount = 0
  service = new FeatureInvocationService({
    isConnected: () => true,
    isTranslationEnabled: () => true,
    authorizeDeclarative: async (_ref, dispatch) => {
      authorizeCount++
      if (authorizeCount === 1) reentrant = service.invoke(request(pluginFeature.ref))
      return { completion: dispatch(structuredClone(pluginFeature)) }
    },
    openDeclarative: async () => { dispatchCount++ },
    openTranslation: async () => {},
  })

  const first = service.invoke(request(pluginFeature.ref))
  const firstResult = await first
  assert.deepEqual(await reentrant, firstResult)
  assert.equal(authorizeCount, 1)
  assert.equal(dispatchCount, 1)
})

test('connection loss during package revalidation prevents a delayed dispatch', async () => {
  let finishAuthorization
  let dispatches = 0
  const env = setup({
    authorizeDeclarative: async (ref, dispatch) => {
      await new Promise(resolve => { finishAuthorization = resolve })
      return { completion: dispatch(structuredClone(pluginFeature)) }
    },
    openDeclarative: async () => { dispatches++ },
  })
  const invocation = env.service.invoke(request(pluginFeature.ref))
  await new Promise(resolve => setImmediate(resolve))
  env.setConnected(false)
  finishAuthorization()
  assert.deepEqual(await invocation, { requestId: id, status: 'failed', reasonCode: 'manager-disconnected' })
  assert.equal(dispatches, 0)
})

test('new authenticated session has a fresh bounded replay namespace', async () => {
  const env = setup()
  await env.service.invoke(request(pluginFeature.ref))
  env.service.clearSession()
  await env.service.invoke(request(pluginFeature.ref))
  assert.equal(env.calls.filter(call => call[0] === 'authorize').length, 2)
})

test('unexpected dependency failures return and cache a bounded failure response', async () => {
  let checks = 0
  const env = setup({ isConnected: () => { checks++; throw new Error('private detail') } })
  const first = await env.service.invoke(request(pluginFeature.ref))
  const replay = await env.service.invoke(request(pluginFeature.ref))
  assert.deepEqual(first, { requestId: id, status: 'failed', reasonCode: 'dispatch-failed' })
  assert.deepEqual(replay, first)
  assert.equal(checks, 1, 'the failed request is not retried by an identical replay')
})

test('completed request IDs remain replay-protected beyond the former cache window', async () => {
  const env = setup()
  const ids = Array.from({ length: 129 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`)
  for (const requestId of ids) await env.service.invoke(request(pluginFeature.ref, requestId))
  assert.equal(env.calls.filter(call => call[0] === 'authorize').length, ids.length)
  assert.deepEqual(await env.service.invoke(request(pluginFeature.ref, ids[0])), {
    requestId: ids[0], status: 'accepted', reasonCode: 'accepted',
  })
  assert.equal(env.calls.filter(call => call[0] === 'authorize').length, ids.length, 'a retained completed ID must not dispatch again')
})

test('in-flight replay state is bounded and rejects overflow without dispatch', async () => {
  const releases = []
  let dispatched = 0
  const env = setup({
    authorizeDeclarative: () => new Promise(resolve => releases.push(() => resolve({ completion: Promise.resolve() }))),
    openDeclarative: async () => { dispatched++ },
  })
  const ids = Array.from({ length: 2048 }, (_, index) => `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`)
  const pending = ids.map(requestId => env.service.invoke(request(pluginFeature.ref, requestId)))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(releases.length, ids.length)
  assert.deepEqual(await env.service.invoke(request(pluginFeature.ref, '20000000-0000-4000-8000-000000000001')), {
    requestId: '20000000-0000-4000-8000-000000000001', status: 'rejected', reasonCode: 'queue-full',
  })
  assert.equal(dispatched, 0, 'overflow is rejected before the authority/dispatch path')
  for (const release of releases) release()
  assert.equal((await Promise.all(pending)).every(result => result.status === 'accepted'), true)
})
