import test from 'node:test'
import assert from 'node:assert/strict'
const module = await import('./web-plugin-bridge.ts').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null
  throw error
})
function harness(dispatchPing, options = {}) {
  assert.ok(module, 'Main Plugin Bridge is missing')
  const event = {}; const sent = []; let ready = 0; let fatal = 0
  const bridge = new module.WebPluginBridge({ authenticate: e => e === event ? 'current' : 'unrelated', now: () => 0, send: raw => sent.push(JSON.parse(raw)), onReady: () => ready++, onFatal: () => fatal++, ...(dispatchPing ? { dispatchPing } : {}), ...options })
  const receive = raw => bridge.receive(event, raw)
  const handshake = async () => { receive('{"type":"hello","protocolMajor":1}'); bridge.documentLoaded(); await bridge.ready }
  return { bridge, event, sent, receive, handshake, ready: () => ready, fatal: () => fatal }
}
const request = id => `{"type":"request","protocolMajor":1,"requestId":"${id}","method":"bridge.ping","payload":null}`
const flush = () => new Promise(resolve => setImmediate(resolve))
test('Bridge admits only closed capability methods and returns sanitized typed results without identity fields', async () => {
  let calls = 0
  const h = harness(undefined, { dispatchCapability: async (request, signal) => {
    assert.equal(request.method, 'ai.complete'); assert.equal(signal.aborted, false); calls++; return { text: 'safe' }
  } })
  await h.handshake()
  h.receive(request('1').replace('bridge.ping', 'ai.complete').replace('"payload":null', '"payload":{"prompt":"hello"}'))
  await flush(); assert.deepEqual(h.sent.at(-1).result, { text: 'safe' }); assert.equal(calls, 1)
  h.receive(request('2').replace('bridge.ping', 'ai.complete').replace('"payload":null', '"payload":{"pluginId":"forged","prompt":"hello"}'))
  await flush(); assert.equal(h.sent.at(-1).error.code, 'INVALID_REQUEST'); assert.equal(calls, 1)
  await h.bridge.revoke()
})
test('capability failures stay bounded; AI uses its 60-second deadline while ordinary calls keep 30 seconds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); let now = 0; let signal
  const h = harness(undefined, { now: () => now, dispatchCapability: (_request, s) => { signal = s; return new Promise(() => {}) } })
  await h.handshake()
  h.receive(request('1').replace('bridge.ping', 'ai.complete').replace('"payload":null', '"payload":{"prompt":"hello"}'))
  await flush(); now = 30000; t.mock.timers.tick(30000); assert.equal(signal.aborted, false)
  now = 60000; t.mock.timers.tick(30000); assert.equal(signal.aborted, true); assert.equal(h.sent.at(-1).error.code, 'TIMEOUT')
  await h.bridge.revoke()
})
function held() {
  let resolve; let reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
test('Main requires hello plus load, then returns correlated ping and safe unavailable errors', async () => {
  const h = harness()
  h.bridge.documentLoaded()
  assert.equal(h.ready(), 0)
  h.receive('{"type":"hello","protocolMajor":1}')
  await h.bridge.ready
  assert.equal(h.ready(), 1)
  h.receive(request('1'))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(h.sent.at(-1), { type: 'response', protocolMajor: 1, requestId: '1', ok: true, result: null })
  h.receive('{"type":"request","protocolMajor":1,"requestId":"2","method":"unknown.call","payload":null}')
  assert.deepEqual(h.sent.at(-1).error, { code: 'NOT_AVAILABLE', retryable: false })
  await h.bridge.revoke()
})
test('cancel before admission is stateless and cannot cancel a later same-ID request', async () => {
  const h = harness(); await h.handshake()
  h.receive('{"type":"cancel","protocolMajor":1,"requestId":"5"}')
  h.receive(request('5'))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(h.sent.at(-1), { type: 'response', protocolMajor: 1, requestId: '5', ok: true, result: null })
  await h.bridge.revoke()
})
test('revoke is synchronous, aborts pending work and ignores late results and unrelated senders', async () => {
  let release; let signal
  const h = harness(s => { signal = s; return new Promise(resolve => { release = resolve }) }); await h.handshake()
  h.bridge.receive({}, request('9'))
  h.receive(request('1')); await new Promise(resolve => setImmediate(resolve))
  const closing = h.bridge.revoke()
  assert.equal(signal.aborted, true)
  h.receive(request('2'))
  release(null); await closing
  assert.equal(h.sent.filter(message => message.type === 'response' && message.ok).length, 0)
  assert.equal(h.sent.at(-1).type, 'runtime-closed')
})
test('malformed fake cancel is charged while unknown valid cancel remains token-free', async () => {
  const h = harness(); await h.handshake()
  h.receive('{"type":"cancel","protocolMajor":1,"requestId":"1","fake":true}')
  for (let i = 1; i <= 20; i++) h.receive('{"type":"cancel","protocolMajor":1,"requestId":"99"}')
  for (let i = 1; i <= 19; i++) { h.receive(request(String(i))); await new Promise(resolve => setImmediate(resolve)) }
  h.receive(request('20'))
  assert.deepEqual(h.sent.at(-1).error, { code: 'LIMIT_EXCEEDED', retryable: false })
  h.receive('{"type":"request","protocolMajor":1,"requestId":"21","method":"bad-method","payload":null}')
  assert.ok(h.sent.every(message => !JSON.stringify(message).includes('stack')))
  await h.bridge.revoke()
})

test('duplicate JSON requestId keys cannot correlate errors or revoke an older pending call', async () => {
  const work = held()
  const h = harness(() => work.promise); await h.handshake()
  try {
    h.receive(request('2')); await flush()
    const before = h.sent.length
    h.receive('{"type":"request","protocolMajor":1,"requestId":"1","requestId":"2","method":"bridge.ping","payload":null}')
    assert.equal(h.sent.length, before, 'ambiguous ID must not produce any correlated or terminal message')
    assert.equal(h.fatal(), 0)
    work.resolve(null); await flush()
    assert.equal(h.sent.at(-1).requestId, '2')
    assert.equal(h.sent.at(-1).ok, true)
  } finally { work.resolve(null); await h.bridge.revoke() }
})

test('malformed hello major is INVALID_REQUEST while a valid unsupported major is NOT_AVAILABLE', async () => {
  for (const [raw, code] of [
    ['{"type":"hello","protocolMajor":"1"}', 'INVALID_REQUEST'],
    ['{"type":"hello","protocolMajor":2}', 'NOT_AVAILABLE'],
  ]) {
    const h = harness()
    h.receive(raw)
    assert.deepEqual(h.sent[0], { type: 'ready', protocolMajor: 1, accepted: false, error: { code, retryable: false } })
    assert.equal(h.fatal(), 1)
    await h.bridge.revoke()
  }
})

test('late handler rejection obeys the monotonic deadline even before its timeout callback runs', async () => {
  let now = 0
  const work = held()
  const h = harness(() => work.promise, { now: () => now }); await h.handshake()
  try {
    h.receive(request('1')); await flush()
    now = 30001
    work.reject(new Error('private path and secret must not be serialized')); await flush()
    assert.deepEqual(h.sent.at(-1), { type: 'response', protocolMajor: 1, requestId: '1', ok: false, error: { code: 'TIMEOUT', retryable: false } })
  } finally { work.resolve(null); await h.bridge.revoke() }
})

test('unexpected authentication failure revokes synchronously without escaping the IPC handler', async () => {
  let broken = false
  let h
  h = harness(undefined, { authenticate: e => { if (broken) throw new Error('internal frame failure'); return e === h.event ? 'current' : 'unrelated' } })
  await h.handshake()
  broken = true
  assert.doesNotThrow(() => h.receive(request('1')))
  assert.equal(h.fatal(), 1)
  assert.deepEqual(h.sent.at(-1), { type: 'runtime-closed', protocolMajor: 1 })
  await h.bridge.revoke()
})

test('four calls acquire slots, fifth has no queue, and cancellation frees exactly one slot', async () => {
  const work = []; const signals = []
  const h = harness(signal => { const item = held(); work.push(item); signals.push(signal); return item.promise })
  await h.handshake()
  try {
    for (let i = 1; i <= 4; i++) h.receive(request(String(i)))
    await flush(); assert.equal(work.length, 4)
    h.receive(request('5')); await flush()
    assert.equal(work.length, 4)
    assert.deepEqual(h.sent.at(-1).error, { code: 'LIMIT_EXCEEDED', retryable: false })
    h.receive('{"type":"cancel","protocolMajor":1,"requestId":"1"}')
    h.receive('{"type":"cancel","protocolMajor":1,"requestId":"1"}')
    assert.equal(signals[0].aborted, true)
    assert.equal(h.sent.filter(x => x.requestId === '1').length, 1)
    assert.equal(h.sent.at(-1).error.code, 'CANCELLED')
    h.receive(request('6')); await flush(); assert.equal(work.length, 5)
    h.receive(request('7')); assert.equal(h.sent.at(-1).error.code, 'LIMIT_EXCEEDED')
    work[0].resolve(null); await flush()
    assert.equal(h.sent.filter(x => x.requestId === '1').length, 1)
    // Seven charged attempts including both concurrency rejections; cancel is free.
    for (let i = 8; i <= 20; i++) h.receive(request(String(i)).replace('bridge.ping', 'unknown.call'))
    assert.equal(h.sent.at(-1).error.code, 'NOT_AVAILABLE')
    h.receive(request('21').replace('bridge.ping', 'unknown.call'))
    assert.equal(h.sent.at(-1).error.code, 'LIMIT_EXCEEDED')
  } finally { for (const item of work) item.resolve(null); await flush(); await h.bridge.revoke() }
})

test('twenty requests pass the rate gate, the twenty-first fails, and 100 ms refills one token', async () => {
  let now = 0
  const h = harness(undefined, { now: () => now }); await h.handshake()
  try {
    for (let i = 1; i <= 20; i++) { h.receive(request(String(i))); await flush(); assert.equal(h.sent.at(-1).ok, true) }
    h.receive(request('21')); assert.equal(h.sent.at(-1).error.code, 'LIMIT_EXCEEDED')
    now = 100; h.receive(request('22')); await flush(); assert.equal(h.sent.at(-1).ok, true)
    h.receive(request('23')); assert.equal(h.sent.at(-1).error.code, 'LIMIT_EXCEEDED')
  } finally { await h.bridge.revoke() }
})

test('unknown, invalid JSON and oversized authenticated attempts share ordinary token accounting', async () => {
  for (const raw of [request('99').replace('bridge.ping', 'unknown.call'), '{', 'x'.repeat(532481)]) {
    const h = harness(); await h.handshake()
    try {
      h.receive(raw)
      for (let i = 1; i <= 19; i++) { h.receive(request(String(i))); await flush(); assert.equal(h.sent.at(-1).ok, true) }
      h.receive(request('20')); assert.equal(h.sent.at(-1).error.code, 'LIMIT_EXCEEDED')
    } finally { await h.bridge.revoke() }
  }
})

test('closed request schema denies caller authority fields and retains a uniquely correlated safe error', async () => {
  let dispatched = 0
  const h = harness(() => { dispatched++; return null }); await h.handshake()
  try {
    h.receive(request('1').replace('"payload":null}', '"payload":null,"pluginId":"forged"}'))
    assert.deepEqual(h.sent.at(-1), { type: 'response', protocolMajor: 1, requestId: '1', ok: false, error: { code: 'INVALID_REQUEST', retryable: false } })
    assert.equal(dispatched, 0)
    h.receive(request('2')); await flush(); assert.equal(dispatched, 1)
  } finally { await h.bridge.revoke() }
})

test('ready requires both signals and expires ten seconds after load; post-ready hello cannot reset it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let now = 0
  let dispatched = 0
  const h = harness(() => { dispatched++; return null }, { now: () => now })
  h.receive(request('1')); await flush()
  assert.equal(dispatched, 0); assert.equal(h.sent.at(-1).error.code, 'NOT_AVAILABLE')
  h.receive('{"type":"hello","protocolMajor":1}')
  assert.equal(h.ready(), 0)
  now = 20000; t.mock.timers.tick(20000)
  assert.equal(h.fatal(), 0, 'ready deadline does not start before document load')
  h.bridge.documentLoaded(); await h.bridge.ready
  assert.equal(h.ready(), 1)
  h.receive('{"type":"hello","protocolMajor":1}')
  assert.equal(h.fatal(), 1)
  const absent = harness(undefined, { now: () => now })
  absent.bridge.documentLoaded()
  now += 9999; t.mock.timers.tick(9999); assert.equal(absent.fatal(), 0)
  now++; t.mock.timers.tick(1); assert.equal(absent.fatal(), 1)
  absent.receive(request('1')); assert.equal(absent.sent.filter(x => x.type === 'response').length, 0)
  await h.bridge.revoke(); await absent.bridge.revoke()
})

test('Host completion at the deadline can succeed, but late completion and timeout settle once', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let now = 0
  const work = []; const signals = []
  const h = harness(signal => { const item = held(); work.push(item); signals.push(signal); return item.promise }, { now: () => now })
  await h.handshake()
  try {
    h.receive(request('1')); await flush()
    now = 30000; work[0].resolve(null); await flush()
    assert.equal(h.sent.at(-1).ok, true)
    h.receive(request('2')); await flush()
    now = 60001; work[1].resolve(null); await flush()
    assert.equal(h.sent.at(-1).error.code, 'TIMEOUT')
    h.receive(request('3')); await flush()
    now += 30000; t.mock.timers.tick(30000)
    assert.equal(signals[2].aborted, true)
    assert.equal(h.sent.at(-1).error.code, 'TIMEOUT')
    work[2].resolve(null); await flush()
    assert.equal(h.sent.filter(x => x.requestId === '3').length, 1)
    h.receive(request('4')); await flush(); assert.equal(work.length, 4)
    work[3].resolve(null); await flush(); assert.equal(h.sent.at(-1).ok, true)
    assert.equal(h.fatal(), 0, 'ordinary timeout must leave runtime ready')
  } finally { for (const item of work) item.resolve(null); await flush(); await h.bridge.revoke() }
})

test('handler failure and send failure never disclose internal exception data', async () => {
  const h = harness(() => { throw new Error('C:\\private\\secret-token') }); await h.handshake()
  try {
    h.receive(request('1')); await flush()
    assert.deepEqual(h.sent.at(-1).error, { code: 'INTERNAL_ERROR', retryable: false })
    assert.equal(JSON.stringify(h.sent).includes('secret-token'), false)
  } finally { await h.bridge.revoke() }
  const failedSend = harness(undefined, { send: () => { throw new Error('private IPC route') } })
  failedSend.receive('{"type":"hello","protocolMajor":1}')
  assert.doesNotThrow(() => failedSend.bridge.documentLoaded())
  await assert.rejects(failedSend.bridge.ready, /closed/)
  assert.equal(failedSend.fatal(), 1)
})

test('revocation releases authority immediately and bounds non-cooperative work to two seconds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const work = held(); let signal
  const h = harness(s => { signal = s; return work.promise }); await h.handshake()
  h.receive(request('1')); await flush()
  let done = false
  const closing = h.bridge.revoke().then(() => { done = true })
  assert.equal(signal.aborted, true)
  h.receive(request('2')); assert.equal(h.sent.filter(x => x.type === 'response').length, 0)
  t.mock.timers.tick(1999); await flush(); assert.equal(done, false)
  t.mock.timers.tick(1); await closing; assert.equal(done, true)
  work.resolve(null); await flush()
  assert.equal(h.sent.filter(x => x.type === 'runtime-closed').length, 1)
  assert.equal(h.sent.filter(x => x.type === 'response').length, 0)
})

test('revoked generation A cannot request, cancel or settle generation B with the same ID', async () => {
  const oldWork = held(); const newWork = held()
  const a = harness(() => oldWork.promise); await a.handshake()
  a.receive(request('1')); await flush()
  const closing = a.bridge.revoke()
  const b = harness(() => newWork.promise); await b.handshake()
  try {
    b.receive(request('1')); await flush()
    a.receive(request('2'))
    b.bridge.receive(a.event, '{"type":"cancel","protocolMajor":1,"requestId":"1"}')
    oldWork.resolve(null); await closing; await flush()
    assert.equal(a.sent.filter(x => x.type === 'response').length, 0)
    assert.equal(b.sent.filter(x => x.type === 'response').length, 0)
    newWork.resolve(null); await flush(); assert.equal(b.sent.at(-1).ok, true)
    // Replacement has a fresh twenty-token bucket and no inherited pending slots.
    for (let i = 2; i <= 20; i++) { b.receive(request(String(i))); await flush(); assert.equal(b.sent.at(-1).ok, true) }
    b.receive(request('21')); assert.equal(b.sent.at(-1).error.code, 'LIMIT_EXCEEDED')
  } finally { oldWork.resolve(null); newWork.resolve(null); await closing; await b.bridge.revoke() }
})

test('canonical duplicate pending ID revokes without dispatching or ambiguously settling either call', async () => {
  const work = held(); let dispatched = 0; let signal
  const h = harness(s => { dispatched++; signal = s; return work.promise }); await h.handshake()
  try {
    h.receive(request('1')); await flush()
    h.receive(request('1'))
    assert.equal(h.fatal(), 1); assert.equal(signal.aborted, true)
    assert.equal(dispatched, 1)
    work.resolve(null); await flush()
    assert.equal(h.sent.filter(x => x.type === 'response').length, 0)
    assert.equal(h.sent.filter(x => x.type === 'runtime-closed').length, 1)
  } finally { work.resolve(null); await h.bridge.revoke() }
})

test('completion revalidates current identity after held dispatch and never returns a stale result', async () => {
  const work = held(); let current = true; let h
  h = harness(() => work.promise, { authenticate: e => e !== h.event ? 'unrelated' : current ? 'current' : 'invalid' })
  await h.handshake()
  try {
    h.receive(request('1')); await flush()
    current = false; work.resolve(null); await flush()
    assert.equal(h.fatal(), 1)
    assert.equal(h.sent.filter(x => x.type === 'response').length, 0)
  } finally { work.resolve(null); await h.bridge.revoke() }
})
