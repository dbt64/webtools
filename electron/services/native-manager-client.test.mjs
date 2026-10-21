import assert from 'node:assert/strict'
import net from 'node:net'
import test from 'node:test'
import { NativeManagerClient, nativeManagerReply } from './native-manager-client.ts'
import { encodeProtocolFrame, ProtocolFrameDecoder } from './native-manager-protocol.ts'

test('selected-text matcher support negotiates outside strict legacy hello without breaking old peers', { skip: process.platform !== 'win32' }, async () => {
  for (const supported of [false, true]) {
    const pipeName = `\\\\.\\pipe\\webtools-text-match-${process.pid}-${Date.now()}-${supported}`
    const requests = []
    const server = net.createServer(socket => {
      const decoder = new ProtocolFrameDecoder()
      socket.on('data', data => { for (const message of decoder.push(data)) {
        if (message.type === 'ack') continue
        requests.push(message)
        const unknown = message.type === 'feature-text-match-negotiate-v1' && !supported
        socket.write(encodeProtocolFrame({ protocolVersion: 1, requestId: 'ack', type: 'ack', payload: {
          replyToId: message.requestId, replyToType: message.type, ok: !unknown,
          ...(unknown ? { error: { code: 'UNKNOWN_MESSAGE', message: 'legacy peer' } } : { result: message.type === 'hello'
            ? { state: {}, supportedFeatures: ['super-panel-context-v1'] } : { capability: 'selected-text-match-http-url-v1' } }),
        } }))
      } })
    })
    await new Promise(resolve => server.listen(pipeName, resolve))
    const client = new NativeManagerClient(pipeName, undefined, false, true)
    try {
      await client.connect(2000)
      assert.equal(client.supportsSelectedTextMatching, supported)
      assert.equal(requests[0].payload.capabilities.includes('selected-text-match-http-url-v1'), false)
      assert.equal(requests[1].type, 'feature-text-match-negotiate-v1')
      assert.equal(client.isConnected, true)
    } finally { client.close(); await new Promise(resolve => server.close(resolve)) }
    assert.equal(client.supportsSelectedTextMatching, false)
  }
})

test('Quick Result negotiates after legacy hello and an old peer remains usable', { skip: process.platform !== 'win32' }, async () => {
  for (const supported of [false, true]) {
    const pipeName = `\\\\.\\pipe\\webtools-result-negotiation-${process.pid}-${Date.now()}-${supported}`
    const server = net.createServer(socket => {
      const decoder = new ProtocolFrameDecoder()
      socket.on('data', data => { for (const message of decoder.push(data)) {
        if (message.type === 'ack') continue
        if (message.type === 'hello') assert.equal(message.payload.capabilities.includes('super-panel-quick-result-v1'), false)
        const unknown = message.type === 'feature-quick-result-negotiate-v1' && !supported
        socket.write(encodeProtocolFrame({ protocolVersion: 1, requestId: 'ack', type: 'ack', payload: {
          replyToId: message.requestId, replyToType: message.type, ok: !unknown,
          ...(unknown ? { error: { code: 'UNKNOWN_MESSAGE', message: 'legacy peer' } } : { result: message.type === 'hello'
            ? { state: {}, supportedFeatures: ['super-panel-context-v1'] } : { capability: 'super-panel-quick-result-v1' } }),
        } }))
      } })
    })
    await new Promise(resolve => server.listen(pipeName, resolve))
    const client = new NativeManagerClient(pipeName, undefined, true)
    try { await client.connect(2000); assert.equal(client.supportsQuickResult, supported); assert.equal(client.isConnected, true) }
    finally { client.close(); await new Promise(resolve => server.close(resolve)) }
  }
})

test('source invalidation queries only accepted correlation metadata and clears only the matching plugin', { skip: process.platform !== 'win32' }, async () => {
  const binding = { requestId: '6528d127-0182-4a60-9e4b-8c89070c50f0', ref: { pluginId: 'org.example.notes', featureId: 'quick' } }
  const clears = []
  const pipeName = `\\\\.\\pipe\\webtools-result-source-${process.pid}-${Date.now()}`
  const server = net.createServer(socket => {
    const decoder = new ProtocolFrameDecoder()
    socket.on('data', data => { for (const message of decoder.push(data)) {
      if (message.type === 'ack') continue
      if (message.type === 'feature-result-clear-v1') clears.push(message.payload)
      socket.write(encodeProtocolFrame({ protocolVersion: 1, requestId: 'ack', type: 'ack', payload: {
        replyToId: message.requestId, replyToType: message.type, ok: true,
        result: message.type === 'hello' ? { state: {}, supportedFeatures: ['super-panel-context-v1'] }
          : { capability: 'super-panel-quick-result-v1', acceptedResult: binding },
      } }))
    } })
  })
  await new Promise(resolve => server.listen(pipeName, resolve))
  const client = new NativeManagerClient(pipeName, undefined, true)
  try {
    await client.connect(2000)
    await client.clearAcceptedQuickResultForSource('org.example.other')
    assert.equal(clears.length, 0)
    await client.clearAcceptedQuickResultForSource(binding.ref.pluginId)
    assert.deepEqual(clears, [binding])
  } finally { client.close(); await new Promise(resolve => server.close(resolve)) }
})

test('Native Manager client handshakes, sends requests, and acknowledges a typed host command', { skip: process.platform !== 'win32' }, async () => {
  const developmentAuthenticationToken = '26fa144ef1498c3bf8aa97d15a430fe50d66f2c84b134275aafcf930b9a1625c'
  const pipeName = `\\\\.\\pipe\\webtools-native-client-test-${process.pid}-${Date.now()}`
  const server = net.createServer()
  const serverDecoder = new ProtocolFrameDecoder()
  let afterAckRan = false
  let resolveAfterAck
  const afterAck = new Promise(resolve => { resolveAfterAck = resolve })
  let helloAuthenticationToken
  let resolveCommandAck
  const commandAck = new Promise((resolve) => { resolveCommandAck = resolve })

  server.on('connection', (socket) => {
    socket.on('data', (chunk) => {
      for (const message of serverDecoder.push(chunk)) {
        if (message.type === 'hello') helloAuthenticationToken = message.payload.developmentAuthenticationToken
        if (message.type === 'ack') {
          if (message.payload?.replyToType === 'open-page') {
            resolveCommandAck(message.payload)
          }
          continue
        }
        socket.write(encodeProtocolFrame({
          protocolVersion: 1,
          requestId: `ack-${message.requestId}`,
          type: 'ack',
          payload: {
            replyToId: message.requestId,
            replyToType: message.type,
            ok: true,
            result: message.type === 'hello' ? { state: { schemaVersion: 1 }, supportedFeatures: ['feature-projection-v2'] } : {},
          },
        }))
        if (message.type === 'manager-renderer-ready') {
          socket.write(encodeProtocolFrame({
            protocolVersion: 1,
            requestId: 'host-command-1',
            type: 'open-page',
            payload: { requestId: 'intent-1', section: 'settings' },
          }))
        }
      }
    })
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(pipeName, resolve)
  })

  const client = new NativeManagerClient(pipeName, developmentAuthenticationToken)
  client.onCommand((message) => {
    assert.equal(message.type, 'open-page')
    return () => { afterAckRan = true; resolveAfterAck() }
  })
  try {
    assert.deepEqual(await client.connect(2_000), { schemaVersion: 1 })
    assert.equal(helloAuthenticationToken, developmentAuthenticationToken, 'the development launch nonce is carried only in the Main hello handshake')
    assert.equal(client.supportsFeatureProjectionV2, true, 'only an explicit exact host capability enables Projection v2')
    await client.request('manager-renderer-ready', {}, 2_000)
    let timeout
    const ack = await Promise.race([commandAck, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('host command timed out')), 2_000) })])
    clearTimeout(timeout)
    assert.equal(ack.replyToId, 'host-command-1')
    assert.equal(ack.ok, true)
    await afterAck
    assert.equal(afterAckRan, true)
  } finally {
    client.close()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('Native Manager client fails closed when an old or malformed host omits exact Projection v2 negotiation', { skip: process.platform !== 'win32' }, async () => {
  for (const supportedFeatures of [undefined, ['feature-projection-v2', 'unknown']]) {
    const pipeName = `\\\\.\\pipe\\webtools-native-negotiation-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const server = net.createServer()
    const decoder = new ProtocolFrameDecoder()
    let helloPayload
    server.on('connection', (socket) => {
      socket.on('data', (chunk) => {
        for (const message of decoder.push(chunk)) {
          if (message.type === 'ack') continue
          if (message.type === 'hello') helloPayload = message.payload
          socket.write(encodeProtocolFrame({
            protocolVersion: 1,
            requestId: `ack-${message.requestId}`,
            type: 'ack',
            payload: {
              replyToId: message.requestId,
              replyToType: message.type,
              ok: true,
              result: {
                state: { schemaVersion: 1 },
                ...(supportedFeatures === undefined ? {} : { supportedFeatures }),
              },
            },
          }))
        }
      })
    })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(pipeName, resolve)
    })
    const client = new NativeManagerClient(pipeName)
    try {
      await client.connect(2_000)
      assert.deepEqual(helloPayload.capabilities, [
        'feature-projection-v2', 'electron-host-lifecycle-v1', 'launcher-feature-surfaces-v1', 'super-panel-context-v1', 'super-panel-settings-v2',
      ], 'new Manager advertises its supported protocol capabilities')
      assert.equal(Object.hasOwn(helloPayload, 'developmentAuthenticationToken'), false, 'packaged Manager does not send a development nonce')
      assert.equal(client.supportsFeatureProjectionV2, false, 'missing or malformed acknowledgement must never enable v2')
    } finally {
      client.close()
      await new Promise((resolve) => server.close(resolve))
    }
  }
})

test('Native Manager command response carries a typed Feature invocation result', { skip: process.platform !== 'win32' }, async () => {
  const pipeName = `\\\\.\\pipe\\webtools-native-feature-reply-${process.pid}-${Date.now()}`
  const server = net.createServer()
  const decoder = new ProtocolFrameDecoder()
  let resolveAck
  const ackPromise = new Promise(resolve => { resolveAck = resolve })
  server.on('connection', socket => socket.on('data', chunk => {
    for (const message of decoder.push(chunk)) {
      if (message.type === 'ack') {
        if (message.payload?.replyToType === 'feature-invoke') resolveAck(message.payload)
        continue
      }
      socket.write(encodeProtocolFrame({
        protocolVersion: 1,
        requestId: `ack-${message.requestId}`,
        type: 'ack',
        payload: { replyToId: message.requestId, replyToType: message.type, ok: true, result: message.type === 'hello' ? { state: {}, supportedFeatures: [] } : null },
      }))
      if (message.type === 'manager-renderer-ready') socket.write(encodeProtocolFrame({
        protocolVersion: 1,
        requestId: 'feature-command-1',
        type: 'feature-invoke',
        payload: { requestId: '6528d127-0182-4a60-9e4b-8c89070c50f0', ref: { pluginId: 'org.example.notes', featureId: 'legacy-manager-page' }, source: 'launcher' },
      }))
    }
  }))
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(pipeName, resolve) })
  const client = new NativeManagerClient(pipeName)
  client.onCommand(message => {
    assert.equal(message.type, 'feature-invoke')
    return nativeManagerReply({ requestId: message.payload.requestId, status: 'accepted', reasonCode: 'accepted' })
  })
  try {
    await client.connect(2_000)
    await client.request('manager-renderer-ready', {}, 2_000)
    const ack = await Promise.race([ackPromise, new Promise((_, reject) => setTimeout(() => reject(new Error('feature response timed out')), 2_000))])
    assert.equal(ack.ok, true)
    assert.deepEqual(ack.result, { requestId: '6528d127-0182-4a60-9e4b-8c89070c50f0', status: 'accepted', reasonCode: 'accepted' })
  } finally {
    client.close()
    await new Promise(resolve => server.close(resolve))
  }
})
