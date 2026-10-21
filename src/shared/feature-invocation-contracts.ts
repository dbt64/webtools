import { isFeatureRef, type FeatureRef } from './feature-contracts.ts'
import { validateInvocationContext, type InvocationContext } from '../../plugin-sdk/declarative-v1/web/invocation-context.mjs'

export const FEATURE_INVOCATION_MAX_BYTES = 16 * 1024
export const FEATURE_INVOCATION_RESULT_MAX_BYTES = 256

export type FeatureInvocationReasonCode =
  | 'accepted'
  | 'completed'
  | 'cancelled'
  | 'invalid-request'
  | 'feature-not-found'
  | 'plugin-disabled'
  | 'permission-denied'
  | 'feature-unavailable'
  | 'stale-request'
  | 'unsupported-feature-kind'
  | 'queue-full'
  | 'manager-not-ready'
  | 'manager-timeout'
  | 'manager-disconnected'
  | 'dispatch-failed'
  | 'command-failed'
  | 'command-timeout'

export interface FeatureInvocationRequest {
  readonly requestId: string
  readonly ref: FeatureRef
  readonly source: 'launcher' | 'super-panel'
  readonly context?: InvocationContext & { readonly capturedAtUnixMs: number }
  readonly quickResult?: { readonly version: 1 }
}

export type FeatureInvocationResult =
  | { readonly requestId: string; readonly status: 'accepted'; readonly reasonCode: 'accepted' }
  | { readonly requestId: string; readonly status: 'completed'; readonly reasonCode: 'completed'; readonly dismissPanel?: true }
  | { readonly requestId: string; readonly status: 'cancelled'; readonly reasonCode: 'cancelled' }
  | { readonly requestId: string; readonly status: 'rejected'; readonly reasonCode: Exclude<FeatureInvocationReasonCode, 'accepted' | 'completed' | 'cancelled' | 'manager-timeout' | 'manager-disconnected' | 'dispatch-failed' | 'command-failed' | 'command-timeout'> }
  | { readonly requestId: string; readonly status: 'failed'; readonly reasonCode: 'manager-timeout' | 'manager-disconnected' | 'dispatch-failed' | 'command-failed' | 'command-timeout' }

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const rejectedReasons = new Set<FeatureInvocationReasonCode>([
  'invalid-request', 'feature-not-found', 'plugin-disabled', 'permission-denied', 'feature-unavailable',
  'stale-request', 'unsupported-feature-kind', 'queue-full', 'manager-not-ready',
])
const failedReasons = new Set<FeatureInvocationReasonCode>(['manager-timeout', 'manager-disconnected', 'dispatch-failed', 'command-failed', 'command-timeout'])

function hasExactOwnFields(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    const keys = Reflect.ownKeys(value)
    if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key))) return false
    return fields.every(field => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field)
      return Boolean(descriptor?.enumerable && 'value' in descriptor)
    })
  } catch {
    return false
  }
}

function withinJsonByteLimit(value: unknown, limit: number): boolean {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength <= limit }
  catch { return false }
}

export function isFeatureInvocationRequestId(value: unknown): value is string {
  return typeof value === 'string' && requestIdPattern.test(value)
}

/** Closed, bounded Native request; optional text is captured for this exact Feature click. */
export function parseFeatureInvocationRequest(value: unknown): FeatureInvocationRequest | null {
  const optional = value && typeof value === 'object' ? ['context', 'quickResult'].filter(key => Object.hasOwn(value, key)) : []
  if (!hasExactOwnFields(value, ['requestId', 'ref', 'source', ...optional])
    || !isFeatureInvocationRequestId(value.requestId)
    || !isFeatureRef(value.ref)
    || value.source !== 'launcher' && value.source !== 'super-panel') return null
  if (optional.includes('quickResult') && (!hasExactOwnFields(value.quickResult, ['version']) || value.quickResult.version !== 1
    || value.source !== 'super-panel' || !optional.includes('context')
    || Object.getOwnPropertyDescriptor(value.context ?? {}, 'type')?.value !== 'text'
    || Object.getOwnPropertyDescriptor(value.context ?? {}, 'source')?.value !== 'selected-text')) return null
  const request: FeatureInvocationRequest = {
    requestId: value.requestId,
    ref: { pluginId: value.ref.pluginId, featureId: value.ref.featureId },
    source: value.source,
    ...(optional.includes('quickResult') ? { quickResult: { version: 1 as const } } : {}),
  }
  if (Object.hasOwn(value, 'context')) {
    const context = value.context
    if (!context || typeof context !== 'object' || Array.isArray(context)) return null
    const contextType = Object.getOwnPropertyDescriptor(context, 'type')?.value
    const fields = contextType === 'text' ? ['type', 'source', 'text', 'capturedAtUnixMs'] : ['type', 'source', 'items', 'capturedAtUnixMs']
    if (!hasExactOwnFields(context, fields) || !Number.isSafeInteger(context.capturedAtUnixMs) || (context.capturedAtUnixMs as number) < 0) return null
    try {
      const { capturedAtUnixMs, ...payload } = context
      const parsed = validateInvocationContext(payload)
      if (!parsed || request.source === 'launcher' && (parsed.type !== 'text' || parsed.source !== 'launcher-input')
        || request.source === 'super-panel' && parsed.source !== 'selected-text' && parsed.source !== 'explorer-selection') return null
      const normalized = { ...parsed, capturedAtUnixMs: capturedAtUnixMs as number }
      return withinJsonByteLimit({ ...request, context: normalized }, FEATURE_INVOCATION_MAX_BYTES) ? { ...request, context: normalized } : null
    } catch { return null }
  }
  return withinJsonByteLimit(request, 1024) ? request : null
}

/** Closed response parser so Native can reject malformed or mismatched acknowledgements. */
export function parseFeatureInvocationResult(value: unknown): FeatureInvocationResult | null {
  const dismiss = value && typeof value === 'object' && Object.hasOwn(value, 'dismissPanel')
  if (!hasExactOwnFields(value, ['requestId', 'status', 'reasonCode', ...(dismiss ? ['dismissPanel'] : [])])
    || !isFeatureInvocationRequestId(value.requestId)
    || typeof value.reasonCode !== 'string'
    || dismiss && (value.status !== 'completed' || value.dismissPanel !== true)) return null

  let result: FeatureInvocationResult | null = null
  if (value.status === 'accepted' && value.reasonCode === 'accepted') {
    result = { requestId: value.requestId, status: 'accepted', reasonCode: 'accepted' }
  } else if (value.status === 'completed' && value.reasonCode === 'completed') {
    result = { requestId: value.requestId, status: 'completed', reasonCode: 'completed', ...(dismiss ? { dismissPanel: true } : {}) }
  } else if (value.status === 'cancelled' && value.reasonCode === 'cancelled') {
    result = { requestId: value.requestId, status: 'cancelled', reasonCode: 'cancelled' }
  } else if (value.status === 'rejected' && rejectedReasons.has(value.reasonCode as FeatureInvocationReasonCode)) {
    result = { requestId: value.requestId, status: 'rejected', reasonCode: value.reasonCode as Exclude<FeatureInvocationReasonCode, 'accepted' | 'completed' | 'cancelled' | 'manager-timeout' | 'manager-disconnected' | 'dispatch-failed' | 'command-failed' | 'command-timeout'> }
  } else if (value.status === 'failed' && failedReasons.has(value.reasonCode as FeatureInvocationReasonCode)) {
    result = { requestId: value.requestId, status: 'failed', reasonCode: value.reasonCode as 'manager-timeout' | 'manager-disconnected' | 'dispatch-failed' | 'command-failed' | 'command-timeout' }
  }
  return result && withinJsonByteLimit(result, FEATURE_INVOCATION_RESULT_MAX_BYTES) ? result : null
}
