export const NATIVE_MANAGER_PROTOCOL_VERSION = 1
export const MAX_PROTOCOL_MESSAGE_BYTES = 4 * 1024 * 1024

export class NativeManagerRequestError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'NativeManagerRequestError'
    this.code = code
  }
}

export interface NativeManagerEnvelope<TPayload = unknown> {
  protocolVersion: number
  requestId: string
  type: string
  payload: TPayload
}

export interface NativeManagerAck {
  replyToId: string
  replyToType: string
  ok: boolean
  result?: unknown
  error?: { code: string; message: string }
}

export function encodeProtocolFrame(message: NativeManagerEnvelope): Buffer {
  if (!Number.isSafeInteger(message.protocolVersion) || typeof message.requestId !== 'string' || !message.requestId || message.requestId.length > 128
    || typeof message.type !== 'string' || !message.type || message.type.length > 48) {
    throw new TypeError('Invalid Native Manager protocol envelope.')
  }
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  if (body.length === 0 || body.length > MAX_PROTOCOL_MESSAGE_BYTES) throw new RangeError('Native Manager protocol message is too large.')
  const frame = Buffer.allocUnsafe(body.length + 4)
  frame.writeUInt32LE(body.length, 0)
  body.copy(frame, 4)
  return frame
}

export class ProtocolFrameDecoder {
  private buffered = Buffer.alloc(0)

  push(chunk: Uint8Array): NativeManagerEnvelope[] {
    if (chunk.byteLength === 0) return []
    this.buffered = this.buffered.length ? Buffer.concat([this.buffered, Buffer.from(chunk)]) : Buffer.from(chunk)
    const messages: NativeManagerEnvelope[] = []
    let offset = 0
    while (this.buffered.length - offset >= 4) {
      const length = this.buffered.readUInt32LE(offset)
      if (length === 0 || length > MAX_PROTOCOL_MESSAGE_BYTES) throw new RangeError('Native Manager protocol message is too large.')
      if (this.buffered.length - offset - 4 < length) break
      const parsed: unknown = JSON.parse(this.buffered.toString('utf8', offset + 4, offset + 4 + length))
      if (!isNativeManagerEnvelope(parsed)) throw new TypeError('Native Manager protocol envelope is malformed.')
      messages.push(parsed)
      offset += 4 + length
    }
    if (offset > 0) this.buffered = this.buffered.subarray(offset)
    if (this.buffered.length > MAX_PROTOCOL_MESSAGE_BYTES + 4) throw new RangeError('Native Manager protocol buffer is too large.')
    return messages
  }
}

export function isNativeManagerEnvelope(value: unknown): value is NativeManagerEnvelope {
  if (!isRecord(value)) return false
  return Number.isSafeInteger(value.protocolVersion)
    && typeof value.requestId === 'string' && value.requestId.length > 0 && value.requestId.length <= 128
    && typeof value.type === 'string' && value.type.length > 0 && value.type.length <= 48
    && Object.hasOwn(value, 'payload')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
