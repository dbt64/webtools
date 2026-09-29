import assert from 'node:assert/strict'
import net from 'node:net'
import test from 'node:test'
import { NativeManagerClient } from './native-manager-client.ts'
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
            result: message.type === 'hello' ? { state: { schemaVersion: 1 } } : {},
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
