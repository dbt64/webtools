import { NativeManagerRequestError, type NativeManagerEnvelope } from './native-manager-protocol.ts'
import { isLauncherPluginRef } from '../../src/shared/launcher-plugin-contracts.ts'
import type { PluginRef } from '../../src/shared/plugin-catalog-contracts.ts'
import { FEATURE_INVOCATION_MAX_BYTES, parseFeatureInvocationRequest, type FeatureInvocationRequest } from '../../src/shared/feature-invocation-contracts.ts'
import { parseFeatureResultControl, type FeatureResultControl } from '../../src/shared/feature-quick-result-contracts.ts'

export type NativeManagerCommand =
  | { kind: 'focus-current-temporary-window' }
  | { kind: 'open-page'; requestId: string; section: 'favorites' | 'entries' | 'settings' | 'translate'; settingsSection?: 'super-panel' }
  | { kind: 'translation-prefill'; requestId: string; handoffRequestId: string; text: string; source?: 'launcher' | 'super-panel' }
  | { kind: 'shutdown-manager' }
  | { kind: 'open-plugin'; requestId: string; ref: PluginRef }
  | { kind: 'feature-invoke'; request: FeatureInvocationRequest }
  | { kind: 'feature-result-cancel'; binding: FeatureResultControl }
  | { kind: 'feature-queue-ownership'; active: boolean }

export function parseNativeManagerCommand(message: NativeManagerEnvelope): NativeManagerCommand {
  const payload = isRecord(message.payload) ? message.payload : null
  if (!payload) throw new NativeManagerRequestError('INVALID_NATIVE_COMMAND', 'Native Host sent an invalid Manager command.')
  if (message.type === 'focus-current-temporary-window') {
    if (Object.keys(payload).length !== 0) throw new NativeManagerRequestError('INVALID_NATIVE_COMMAND', 'Window focus takes no identity or arguments.')
    return { kind: 'focus-current-temporary-window' }
  }
  if (message.type === 'feature-result-cancel-v1') {
    const binding = parseFeatureResultControl(payload)
    if (!binding) throw new NativeManagerRequestError('INVALID_NATIVE_COMMAND', 'Invalid result cancellation.')
    return { kind: 'feature-result-cancel', binding }
  }
  if (message.type === 'feature-queue-ownership') {
    if (Object.keys(payload).length !== 1 || typeof payload.active !== 'boolean') throw new NativeManagerRequestError('INVALID_NATIVE_COMMAND', 'Invalid Feature queue ownership.')
    return { kind: 'feature-queue-ownership', active: payload.active }
  }
  if (message.type === 'open-plugin') {
    if (Object.keys(payload).length !== 2 || typeof payload.requestId !== 'string' || !payload.requestId || payload.requestId.length > 128 || !isLauncherPluginRef(payload.ref))
      throw new NativeManagerRequestError('INVALID_NATIVE_COMMAND', 'Native Host sent an invalid plugin reference.')
    return { kind: 'open-plugin', requestId: payload.requestId, ref: payload.ref }
  }
  if (message.type === 'feature-invoke') {
    const request = parseFeatureInvocationRequest(payload)
    if (!request || Buffer.byteLength(JSON.stringify(payload), 'utf8') > FEATURE_INVOCATION_MAX_BYTES)
      throw new NativeManagerRequestError('INVALID_FEATURE_INVOCATION', 'Native Host sent an invalid Feature invocation.')
    return { kind: 'feature-invoke', request }
  }
  if (message.type === 'open-page') {
    if (typeof payload.requestId !== 'string' || payload.requestId.length === 0 || payload.requestId.length > 128
      || !['favorites', 'entries', 'settings', 'translate'].includes(String(payload.section))) {
      throw new NativeManagerRequestError('INVALID_NATIVE_COMMAND', 'Native Host sent an invalid page request.')
    }
    if (payload.settingsSection !== undefined && (payload.section !== 'settings' || payload.settingsSection !== 'super-panel')) {
      throw new NativeManagerRequestError('INVALID_NATIVE_COMMAND', 'Native Host sent an invalid settings target.')
    }
    return { kind: 'open-page', requestId: payload.requestId, section: payload.section as 'favorites' | 'entries' | 'settings' | 'translate',
      ...(payload.settingsSection === 'super-panel' ? { settingsSection: 'super-panel' as const } : {}) }
  }
  if (message.type === 'translation-prefill') {
    if (typeof payload.requestId !== 'string' || payload.requestId.length === 0 || payload.requestId.length > 128
      || typeof payload.text !== 'string' || payload.text.length === 0 || payload.text.length > 20_000) {
      throw new NativeManagerRequestError('INVALID_NATIVE_COMMAND', 'Native Host sent invalid translation input.')
    }
    if (payload.source !== undefined && payload.source !== 'launcher' && payload.source !== 'super-panel')
      throw new NativeManagerRequestError('INVALID_NATIVE_COMMAND', 'Invalid translation entry surface.')
    return { kind: 'translation-prefill', requestId: payload.requestId, handoffRequestId: payload.requestId, text: payload.text,
      ...(payload.source ? { source: payload.source as 'launcher' | 'super-panel' } : {}) }
  }
  if (message.type === 'shutdown-manager') return { kind: 'shutdown-manager' }
  throw new NativeManagerRequestError('UNSUPPORTED_NATIVE_COMMAND', 'Native Host sent an unsupported Manager command.')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
