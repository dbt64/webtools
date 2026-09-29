import assert from 'node:assert/strict'
import test from 'node:test'

const protocol = await import('./native-manager-protocol.ts').catch(() => null)

test('native manager protocol frames messages across partial reads and rejects oversized frames', () => {
  assert.ok(protocol, 'native manager protocol module is available')
  if (!protocol) return

  const message = { protocolVersion: 1, requestId: 'request-1', type: 'hello', payload: { processId: 42 } }
  const frame = protocol.encodeProtocolFrame(message)
  const decoder = new protocol.ProtocolFrameDecoder()

  assert.deepEqual(decoder.push(frame.subarray(0, 2)), [])
  assert.deepEqual(decoder.push(frame.subarray(2, 7)), [])
  assert.deepEqual(decoder.push(frame.subarray(7)), [message])

  const oversized = Buffer.alloc(4)
  oversized.writeUInt32LE(protocol.MAX_PROTOCOL_MESSAGE_BYTES + 1)
  assert.throws(() => new protocol.ProtocolFrameDecoder().push(oversized), /too large/i)
})
