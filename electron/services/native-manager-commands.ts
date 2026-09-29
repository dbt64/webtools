import { NativeManagerRequestError, type NativeManagerEnvelope } from './native-manager-protocol.ts'

export type NativeManagerCommand =
  | { kind: 'open-page'; requestId: string; section: 'search' | 'entries' | 'settings' | 'translate' }
  | { kind: 'translation-prefill'; requestId: string; text: string }
  | { kind: 'shutdown-manager' }

export function parseNativeManagerCommand(message: NativeManagerEnvelope): NativeManagerCommand {
  const payload = isRecord(message.payload) ? message.payload : null
  if (!payload) throw new NativeManagerRequestError('INVALID_NATIVE_COMMAND', 'Native Host sent an invalid Manager command.')
  if (message.type === 'open-page') {
    if (typeof payload.requestId !== 'string' || payload.requestId.length === 0 || payload.requestId.length > 128
      || !['search', 'entries', 'settings', 'translate'].includes(String(payload.section))) {
      throw new NativeManagerRequestError('INVALID_NATIVE_COMMAND', 'Native Host sent an invalid page request.')
    }
    return { kind: 'open-page', requestId: message.requestId, section: payload.section as 'search' | 'entries' | 'settings' | 'translate' }
  }
  if (message.type === 'translation-prefill') {
    if (typeof payload.requestId !== 'string' || payload.requestId.length === 0 || payload.requestId.length > 128
      || typeof payload.text !== 'string' || payload.text.length === 0 || payload.text.length > 20_000) {
      throw new NativeManagerRequestError('INVALID_NATIVE_COMMAND', 'Native Host sent invalid translation input.')
    }
    return { kind: 'translation-prefill', requestId: message.requestId, text: payload.text }
  }
  if (message.type === 'shutdown-manager') return { kind: 'shutdown-manager' }
  throw new NativeManagerRequestError('UNSUPPORTED_NATIVE_COMMAND', 'Native Host sent an unsupported Manager command.')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
