import { isFeatureRef, type FeatureRef } from './feature-contracts.ts'
import { isFeatureInvocationRequestId } from './feature-invocation-contracts.ts'

export const QUICK_RESULT_CAPABILITY = 'super-panel-quick-result-v1'
export const QUICK_RESULT_MAX_BYTES = 65536
export interface FeatureTextResult { readonly kind: 'text'; readonly text: string }
export interface FeatureQuickResultPayload { readonly resultVersion: 1; readonly requestId: string; readonly ref: FeatureRef; readonly text: string }
export interface FeatureResultControl { readonly requestId: string; readonly ref: FeatureRef }

export function hasExactResultFields(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  try {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false
    const keys = Reflect.ownKeys(value)
    return keys.length === fields.length && keys.every(key => typeof key === 'string' && fields.includes(key))
      && fields.every(key => { const d = Object.getOwnPropertyDescriptor(value, key); return Boolean(d?.enumerable && 'value' in d) })
  } catch { return false }
}

export function normalizeFeatureResultText(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > QUICK_RESULT_MAX_BYTES) return null
  const text = value.replace(/\r\n?/g, '\n')
  let count = 0
  for (const character of text) {
    const code = character.codePointAt(0)!
    if (++count > 8192 || code >= 0xd800 && code <= 0xdfff || code < 32 && code !== 9 && code !== 10) return null
  }
  return text.trim() && new TextEncoder().encode(text).byteLength <= 32768 ? text : null
}

export function parseFeatureTextResult(value: unknown): FeatureTextResult | null {
  if (!hasExactResultFields(value, ['kind', 'text']) || value.kind !== 'text') return null
  const text = normalizeFeatureResultText(value.text)
  return text === null ? null : { kind: 'text', text }
}

export function parseFeatureResultControl(value: unknown): FeatureResultControl | null {
  if (!hasExactResultFields(value, ['requestId', 'ref']) || !isFeatureInvocationRequestId(value.requestId) || !isFeatureRef(value.ref)) return null
  return { requestId: value.requestId, ref: { ...value.ref } }
}

export function parseFeatureQuickResultPayload(value: unknown): FeatureQuickResultPayload | null {
  if (!hasExactResultFields(value, ['resultVersion', 'requestId', 'ref', 'text']) || value.resultVersion !== 1) return null
  const binding = parseFeatureResultControl({ requestId: value.requestId, ref: value.ref })
  const text = normalizeFeatureResultText(value.text)
  if (!binding || text === null || new TextEncoder().encode(JSON.stringify(value)).byteLength > QUICK_RESULT_MAX_BYTES) return null
  return { resultVersion: 1, ...binding, text }
}

/** JSON.parse validates grammar; this bounded token pass preserves duplicate-key rejection. */
export function parseQuickResultJson(raw: string): unknown | null {
  if (new TextEncoder().encode(raw).byteLength > QUICK_RESULT_MAX_BYTES) return null
  try {
    const value: unknown = JSON.parse(raw)
    const tokens = raw.match(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]|[^\s{}\[\],:]+/g) ?? []
    const stack: (Set<string> | null)[] = []
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      if (token === '{' || token === '[') { if (stack.length >= 32) return null; stack.push(token === '{' ? new Set() : null) }
      else if (token === '}' || token === ']') stack.pop()
      else if (token.startsWith('"') && tokens[i + 1] === ':') {
        const keys = stack.at(-1)
        if (!keys) return null
        const key: string = JSON.parse(token)
        if (keys.has(key)) return null
        keys.add(key)
      }
    }
    return value
  } catch { return null }
}
