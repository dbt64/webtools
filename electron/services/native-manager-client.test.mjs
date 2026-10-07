import assert from 'node:assert/strict'
import net from 'node:net'
import test from 'node:test'
import { NativeManagerClient, nativeManagerReply } from './native-manager-client.ts'
import { encodeProtocolFrame, ProtocolFrameDecoder } from './native-manager-protocol.ts'

test('Native Manager client handshakes, sends requests, and acknowledges a typed host command', { skip: process.platform !== 'win32' }, async () => {
  const pipeName = `\\\\.\\pipe\\webtools-native-client-test-${process.pid}-${Date.now()}`
  const server = net.createServer()
  const serverDecoder = new ProtocolFrameDecoder()
  let afterAckRan = false
  let resolveCommandAck
  const commandAck = new Promise((resolve) => { resolveCommandAck = resolve })

  server.on('connection', (socket) => {
    socket.on('data', (chunk) => {
      for (const message of serverDecoder.push(chunk)) {
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

  const client = new NativeManagerClient(pipeName)
  client.onCommand((message) => {
    assert.equal(message.type, 'open-page')
    return () => { afterAckRan = true }
  })
  try {
    assert.deepEqual(await client.connect(2_000), { schemaVersion: 1 })
    assert.equal(client.supportsFeatureProjectionV2, true, 'only an explicit exact host capability enables Projection v2')
    await client.request('manager-renderer-ready', {}, 2_000)
    let timeout
    const ack = await Promise.race([commandAck, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('host command timed out')), 2_000) })])
    clearTimeout(timeout)
    assert.equal(ack.replyToId, 'host-command-1')
    assert.equal(ack.ok, true)
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
    let helloCapabilities
    server.on('connection', (socket) => {
      socket.on('data', (chunk) => {
        for (const message of decoder.push(chunk)) {
          if (message.type === 'ack') continue
          if (message.type === 'hello') helloCapabilities = message.payload.capabilities
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
      assert.deepEqual(helloCapabilities, ['feature-projection-v2'], 'new Manager advertises its v2 capability')
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
