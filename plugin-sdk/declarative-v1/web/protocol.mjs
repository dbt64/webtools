// Browser-neutral private wire helpers. Not a supported developer subpath.
export const BRIDGE_MAJOR = 1
export const ENVELOPE_BYTES = 532480
export const ERROR_CODES = Object.freeze(['INVALID_REQUEST', 'UNAUTHORIZED', 'PERMISSION_DENIED', 'STALE_RUNTIME', 'CONTEXT_EXPIRED', 'NOT_AVAILABLE', 'LIMIT_EXCEEDED', 'TIMEOUT', 'CANCELLED', 'USER_CANCELLED', 'RUNTIME_CLOSED', 'INTERNAL_ERROR', 'CONFIGURATION_NOT_DECLARED', 'CONFIGURATION_KEY_NOT_FOUND', 'CONFIG_INCOMPATIBLE'])

export class BridgeWireError extends Error {
  constructor(code = 'INVALID_REQUEST') { super('Invalid Bridge message'); this.code = code }
}
function invalid() { throw new BridgeWireError() }
function limit() { throw new BridgeWireError('LIMIT_EXCEEDED') }

/** Stop at the first byte beyond the bound; never create a UTF-8 buffer. */
export function measureUtf8(text, bound = ENVELOPE_BYTES) {
  if (typeof text !== 'string') invalid()
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x80) bytes++
    else if (c < 0x800) bytes += 2
    else if (c >= 0xd800 && c <= 0xdbff && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++ }
    else bytes += 3
    if (bytes > bound) return bound + 1
  }
  return bytes
}
function scalar(text) {
  if (measureUtf8(text) > ENVELOPE_BYTES) limit()
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(++i)
      if (!(next >= 0xdc00 && next <= 0xdfff)) invalid()
    } else if (c >= 0xdc00 && c <= 0xdfff) invalid()
  }
  return text
}
function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) invalid()
  if (Object.getOwnPropertySymbols(value).length) invalid()
  const descriptors = Object.getOwnPropertyDescriptors(value)
  for (const item of Object.values(descriptors)) if (!item.enumerable || !('value' in item)) invalid()
  return descriptors
}
function exact(value, keys) {
  const descriptors = plain(value)
  const actual = Object.keys(descriptors)
  if (actual.length !== keys.length || keys.some(key => !Object.hasOwn(descriptors, key))) invalid()
}
function valueJson(value, depth = 0, seen = new Set()) {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number') { if (!Number.isFinite(value)) invalid(); return JSON.stringify(value === 0 ? 0 : value) }
  if (typeof value === 'string') return JSON.stringify(scalar(value))
  if (typeof value !== 'object' || depth >= 16 || seen.has(value)) invalid()
  seen.add(value)
  let encoded
  if (Array.isArray(value)) {
    if (value.length > ENVELOPE_BYTES / 2) limit()
    if (Object.getOwnPropertySymbols(value).length || Object.keys(value).length !== value.length) invalid()
    const parts = []; let bytes = 2
    for (let i = 0; i < value.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i))
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) invalid()
      const part = valueJson(descriptor.value, depth + 1, seen)
      bytes += (i ? 1 : 0) + measureUtf8(part)
      if (bytes > ENVELOPE_BYTES) limit()
      parts.push(part)
    }
    encoded = '[' + parts.join(',') + ']'
  } else {
    const descriptors = plain(value)
    const parts = []; let bytes = 2
    for (const key of Object.keys(descriptors).sort()) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) invalid()
      const part = JSON.stringify(scalar(key)) + ':' + valueJson(descriptors[key].value, depth + 1, seen)
      bytes += (parts.length ? 1 : 0) + measureUtf8(part)
      if (bytes > ENVELOPE_BYTES) limit()
      parts.push(part)
    }
    encoded = '{' + parts.join(',') + '}'
  }
  seen.delete(value)
  if (measureUtf8(encoded) > ENVELOPE_BYTES) limit()
  return encoded
}
export function validRequestId(id) {
  return typeof id === 'string' && /^[1-9][0-9]{0,15}$/.test(id) && Number(id) <= Number.MAX_SAFE_INTEGER
}
export function validateRequestInput(method, payload) {
  if (typeof method !== 'string' || method.length > 64 || !/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){0,3}$/.test(method)) invalid()
  valueJson(payload)
}
export function decodeRaw(raw) {
  if (typeof raw !== 'string') invalid()
  if (measureUtf8(raw) > ENVELOPE_BYTES) limit()
  try { return JSON.parse(raw) } catch { invalid() }
}
export function encodeMessage(message, direction) {
  plain(message) // Reject top-level getters before reading fields.
  if (!Number.isSafeInteger(message.protocolMajor) || message.protocolMajor < 1) invalid()
  let keys
  if (direction === 'client') {
    if (message.type === 'hello') keys = ['type', 'protocolMajor']
    else if (message.type === 'cancel') keys = ['type', 'protocolMajor', 'requestId']
    else if (message.type === 'request') keys = ['type', 'protocolMajor', 'requestId', 'method', 'payload']
    else invalid()
  } else if (direction === 'host') {
    if (message.type === 'runtime-closed') keys = ['type', 'protocolMajor']
    else if (message.type === 'ready' && typeof message.accepted === 'boolean') keys = ['type', 'protocolMajor', 'accepted', ...(message.accepted ? [] : ['error'])]
    else if (message.type === 'response' && typeof message.ok === 'boolean') keys = ['type', 'protocolMajor', 'requestId', 'ok', message.ok ? 'result' : 'error']
    else invalid()
  } else invalid()
  exact(message, keys)
  if (keys.includes('requestId') && !validRequestId(message.requestId)) invalid()
  if (keys.includes('method') && (typeof message.method !== 'string' || message.method.length > 64 || !/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){0,3}$/.test(message.method))) invalid()
  if (keys.includes('error')) {
    exact(message.error, ['code', 'retryable'])
    if (!ERROR_CODES.includes(message.error.code) || message.error.retryable !== false) invalid()
    if (message.type === 'ready' && !['INVALID_REQUEST', 'NOT_AVAILABLE'].includes(message.error.code)) invalid()
  }
  // Envelope order is fixed; only payload/result object keys are sorted.
  const parts = keys.map(key => JSON.stringify(key) + ':' + (key === 'error'
    ? '{"code":' + JSON.stringify(message.error.code) + ',"retryable":false}'
    : valueJson(message[key])))
  const raw = '{' + parts.join(',') + '}'
  if (measureUtf8(raw) > ENVELOPE_BYTES) limit()
  return raw
}
export function validateParsed(raw, message, direction) {
  if (encodeMessage(message, direction) !== raw) invalid()
  return message
}
export function parseMessage(raw, direction) { return validateParsed(raw, decodeRaw(raw), direction) }
