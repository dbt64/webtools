import { BridgeWireError, measureUtf8, validateRequestInput } from './protocol.mjs'
import { matchesSelectedText } from '../runtime-v3/selected-text-match.mjs'
const reject = () => { throw new BridgeWireError('INVALID_REQUEST') }
const exact = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key))) reject()
}

/** Extends the existing context.current payload; no separate Super Panel API. */
export function validateInvocationContext(value) {
  if (value === null) return null
  validateRequestInput('context.current', value)
  if (value?.type === 'text') {
    exact(value, ['type', 'source', 'text'])
    if (!['launcher-input', 'clipboard', 'selected-text'].includes(value.source) || typeof value.text !== 'string'
      || measureUtf8(value.text, 32768) > 32768 || value.source === 'launcher-input' && value.text.length > 300) reject()
    return Object.freeze({ type: 'text', source: value.source, text: value.text })
  }
  exact(value, ['type', 'source', 'items'])
  if (!['files', 'directories'].includes(value.type) || value.source !== 'explorer-selection'
    || !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 64
    || measureUtf8(JSON.stringify(value), 16384) > 16384) reject()
  const seen = new Set()
  const items = value.items.map(item => {
    exact(item, ['kind', 'path'])
    if (!['file', 'directory'].includes(item.kind) || typeof item.path !== 'string' || item.path.length > 1024
      || !/^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/u.test(item.path)
      || /[\u0000-\u001f]/u.test(item.path) || /^\\\\[?.]\\/u.test(item.path)
      || item.path.slice(/^[A-Za-z]:/u.test(item.path) ? 2 : 0).includes(':')) reject()
    const identity = item.path.toLowerCase()
    if (seen.has(identity)) reject()
    seen.add(identity)
    return Object.freeze({ kind: item.kind, path: item.path })
  })
  if (value.type === 'directories' && items.some(item => item.kind !== 'directory')
    || value.type === 'files' && !items.some(item => item.kind === 'file')) reject()
  return Object.freeze({ type: value.type, source: 'explorer-selection', items: Object.freeze(items) })
}

/** Declarative metadata matching only; never executes a plugin matcher. */
export function acceptsInvocationContext(accepted, context) {
  if (!context) return accepted.length === 0 || accepted.some(item => item.type === 'none')
  if (context.type === 'text') return accepted.some(item => item.type === 'text' && item.sources.includes(context.source)
    && (item.textMatch === undefined || context.source === 'selected-text' && matchesSelectedText(context.text, item.textMatch)))
  const kinds = ['file', 'directory'].filter(kind => context.items.some(item => item.kind === kind))
  return kinds.every(kind => accepted.some(rule => rule.type === (kind === 'file' ? 'files' : 'directories')
    && rule.sources.includes(context.source) && (!rule.maxItems || context.items.length <= rule.maxItems)
    && (kind !== 'file' || !rule.extensions?.length || context.items.filter(item => item.kind === 'file').every(item => {
      const name = item.path.split(/[\\/]/u).pop()
      const dot = name.lastIndexOf('.')
      return dot >= 0 && rule.extensions.includes(name.slice(dot).toLowerCase())
    }))))
}
