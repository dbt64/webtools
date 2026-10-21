// Private closed request/response schemas, not a package export or generic public API.
import { BridgeWireError, measureUtf8, validateRequestInput } from './protocol.mjs'
import { validateInvocationContext } from './invocation-context.mjs'
export const CAPABILITY_METHODS = Object.freeze(['context.current', 'config.get', 'config.set', 'storage.get', 'storage.set', 'storage.delete', 'ai.complete', 'clipboard.write', 'external.open'])
const invalid = () => { throw new BridgeWireError('INVALID_REQUEST') }
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) invalid()
}
function text(value, bytes) {
  if (typeof value !== 'string') invalid()
  if (measureUtf8(value, bytes) > bytes) throw new BridgeWireError('LIMIT_EXCEEDED')
}
function key(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value) || ['__proto__', 'prototype', 'constructor'].includes(value)) invalid()
}
function jsonValue(value) {
  if (measureUtf8(JSON.stringify(value), 524288) > 524288) throw new BridgeWireError('LIMIT_EXCEEDED')
}
export function validateCapabilityRequest(method, payload) {
  if (!CAPABILITY_METHODS.includes(method)) throw new BridgeWireError('NOT_AVAILABLE')
  validateRequestInput(method, payload)
  if (method === 'context.current' || method === 'config.get') { if (payload !== null) invalid() }
  else if (method === 'config.set') { exact(payload, ['key', 'value']); key(payload.key); if (!['string', 'boolean', 'number'].includes(typeof payload.value) || typeof payload.value === 'number' && !Number.isFinite(payload.value)) invalid() }
  else if (method.startsWith('storage.')) {
    exact(payload, method === 'storage.set' ? ['key', 'value'] : ['key']); key(payload.key)
    if (method === 'storage.set') jsonValue(payload.value)
  } else if (method === 'external.open') {
    exact(payload, ['url']); text(payload.url, 32768)
    if (!/^https?:\/\//iu.test(payload.url) || /[\s\u0000-\u001f\u007f-\u009f\\]/u.test(payload.url)) invalid()
    let url
    try { url = new URL(payload.url) } catch { invalid() }
    if (!url.hostname || url.username || url.password) invalid()
  } else if (method === 'ai.complete') { exact(payload, ['prompt']); text(payload.prompt, 32768); if (!payload.prompt.trim()) invalid() }
  else { exact(payload, ['text']); text(payload.text, 65536) }
  return { method, payload }
}
export function validateCapabilityResult(method, result) {
  validateRequestInput(method, result)
  if (method === 'context.current') {
    validateInvocationContext(result)
  } else if (method === 'config.get') {
    if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).length > 64) invalid()
    for (const [name, value] of Object.entries(result)) { key(name); if (!['string', 'boolean', 'number'].includes(typeof value)) invalid() }
    jsonValue(result)
  } else if (method === 'ai.complete') { exact(result, ['text']); text(result.text, 32768) }
  else if (method === 'storage.get') jsonValue(result)
  else if (result !== null) invalid()
}
