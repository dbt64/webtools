import { isFeatureRef, type FeatureRef } from './feature-contracts.ts'

export const FEATURE_INVOCATION_MAX_BYTES = 16 * 1024
export const FEATURE_INVOCATION_RESULT_MAX_BYTES = 256

export type FeatureInvocationReasonCode =
  | 'accepted'
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

export interface FeatureInvocationRequest {
  readonly requestId: string
  readonly ref: FeatureRef
  readonly source: 'launcher'
  readonly context?: { readonly type: 'text'; readonly source: 'launcher-input'; readonly text: string; readonly capturedAtUnixMs: number }
}

export type FeatureInvocationResult =
  | { readonly requestId: string; readonly status: 'accepted'; readonly reasonCode: 'accepted' }
  | { readonly requestId: string; readonly status: 'rejected'; readonly reasonCode: Exclude<FeatureInvocationReasonCode, 'accepted' | 'manager-timeout' | 'manager-disconnected' | 'dispatch-failed'> }
  | { readonly requestId: string; readonly status: 'failed'; readonly reasonCode: 'manager-timeout' | 'manager-disconnected' | 'dispatch-failed' }

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const rejectedReasons = new Set<FeatureInvocationReasonCode>([
  'invalid-request', 'feature-not-found', 'plugin-disabled', 'permission-denied', 'feature-unavailable',
  'stale-request', 'unsupported-feature-kind', 'queue-full', 'manager-not-ready',
])
const failedReasons = new Set<FeatureInvocationReasonCode>(['manager-timeout', 'manager-disconnected', 'dispatch-failed'])

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
function wellFormedText(text: string): boolean {
  for (const character of text) { const scalar = character.codePointAt(0)!; if (scalar >= 0xd800 && scalar <= 0xdfff) return false }
  return true
}

/** Closed, bounded Native request; optional text is captured for this exact Feature click. */
export function parseFeatureInvocationRequest(value: unknown): FeatureInvocationRequest | null {
  if ((!hasExactOwnFields(value, ['requestId', 'ref', 'source']) && !hasExactOwnFields(value, ['requestId', 'ref', 'source', 'context']))
    || !isFeatureInvocationRequestId(value.requestId)
    || !isFeatureRef(value.ref)
    || value.source !== 'launcher') return null
  const request: FeatureInvocationRequest = {
    requestId: value.requestId,
    ref: { pluginId: value.ref.pluginId, featureId: value.ref.featureId },
    source: 'launcher',
  }
  if (Object.hasOwn(value, 'context')) {
    const context = value.context
    if (!hasExactOwnFields(context, ['type', 'source', 'text', 'capturedAtUnixMs']) || context.type !== 'text' || context.source !== 'launcher-input'
      || typeof context.text !== 'string' || context.text.length > 300 || !wellFormedText(context.text)
      || !Number.isSafeInteger(context.capturedAtUnixMs) || (context.capturedAtUnixMs as number) < 0) return null
    return withinJsonByteLimit({ ...request, context }, FEATURE_INVOCATION_MAX_BYTES)
      ? { ...request, context: { type: 'text', source: 'launcher-input', text: context.text, capturedAtUnixMs: context.capturedAtUnixMs as number } } : null
  }
  return withinJsonByteLimit(request, 1024) ? request : null
}

/** Closed response parser so Native can reject malformed or mismatched acknowledgements. */
export function parseFeatureInvocationResult(value: unknown): FeatureInvocationResult | null {
  if (!hasExactOwnFields(value, ['requestId', 'status', 'reasonCode'])
    || !isFeatureInvocationRequestId(value.requestId)
    || typeof value.reasonCode !== 'string') return null

  let result: FeatureInvocationResult | null = null
  if (value.status === 'accepted' && value.reasonCode === 'accepted') {
    result = { requestId: value.requestId, status: 'accepted', reasonCode: 'accepted' }
  } else if (value.status === 'rejected' && rejectedReasons.has(value.reasonCode as FeatureInvocationReasonCode)) {
    result = { requestId: value.requestId, status: 'rejected', reasonCode: value.reasonCode as Exclude<FeatureInvocationReasonCode, 'accepted' | 'manager-timeout' | 'manager-disconnected' | 'dispatch-failed'> }
  } else if (value.status === 'failed' && failedReasons.has(value.reasonCode as FeatureInvocationReasonCode)) {
    result = { requestId: value.requestId, status: 'failed', reasonCode: value.reasonCode as 'manager-timeout' | 'manager-disconnected' | 'dispatch-failed' }
  }
  return result && withinJsonByteLimit(result, FEATURE_INVOCATION_RESULT_MAX_BYTES) ? result : null
}
