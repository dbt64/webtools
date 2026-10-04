import { PLUGIN_CAPABILITIES, type PluginManifest, type PluginSetting, type PluginCapability, type PluginJson } from '../../src/shared/plugin-contracts.ts'
import { fail } from './errors.ts'

declare const validated: unique symbol
export type ValidatedManifest = PluginManifest & { readonly [validated]: true }
export const LIMITS = Object.freeze({ archive: 20 * 1024 * 1024, entries: 256, expanded: 50 * 1024 * 1024, png: 256 * 1024, manifest: 64 * 1024, ratio: 100, depth: 16, pages: 8, blocks: 64, actions: 32, settings: 64, value: 512 * 1024, keys: 200, data: 5 * 1024 * 1024 })
export const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const keyPattern = /^[a-zA-Z0-9_-]{1,64}$/
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor'])
export function validPluginId(value: unknown): value is string { return typeof value === 'string' && value.length >= 3 && value.length <= 128 && pluginIdPattern.test(value) && !forbiddenKeys.has(value) }

/** A small JSON grammar parser preserves duplicate-key information JSON.parse discards. */
export function parseStrictJson(source: string, maxDepth = LIMITS.depth): PluginJson {
  let at = 0
  const ws = () => { while (/\s/.test(source[at] ?? '') && at < source.length) { if (!/[\x20\t\r\n]/.test(source[at])) fail('INVALID_MANIFEST'); at++ } }
  const string = (): string => {
    const start = at++
    while (at < source.length) {
      if (source[at] === '\\') { at += 2; continue }
      if (source[at++] === '"') { try { return JSON.parse(source.slice(start, at)) as string } catch { fail('INVALID_MANIFEST') } }
    }
    fail('INVALID_MANIFEST')
  }
  const value = (depth: number): PluginJson => {
    ws()
    if (source[at] === '"') return string()
    if (source[at] === '{' || source[at] === '[') {
      if (depth >= maxDepth) fail('INVALID_MANIFEST')
      const object = source[at++] === '{'; const end = object ? '}' : ']'
      const result: Record<string, PluginJson> = {}; const array: PluginJson[] = []; const seen = new Set<string>()
      ws(); if (source[at] === end) { at++; return object ? result : array }
      for (;;) {
        ws()
        if (object) {
          if (source[at] !== '"') fail('INVALID_MANIFEST')
          const key = string(); if (seen.has(key) || forbiddenKeys.has(key)) fail('INVALID_MANIFEST'); seen.add(key)
          ws(); if (source[at++] !== ':') fail('INVALID_MANIFEST'); result[key] = value(depth + 1)
        } else array.push(value(depth + 1))
        ws(); if (source[at] === end) { at++; return object ? result : array }
        if (source[at++] !== ',') fail('INVALID_MANIFEST')
      }
    }
    const rest = source.slice(at)
    for (const [word, parsed] of [['true', true], ['false', false], ['null', null]] as const) if (rest.startsWith(word)) { at += word.length; return parsed }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest)
    if (number) { at += number[0].length; const n = Number(number[0]); if (!Number.isFinite(n)) fail('INVALID_MANIFEST'); return n }
    fail('INVALID_MANIFEST')
  }
  const result = value(0); ws(); if (at !== source.length) fail('INVALID_MANIFEST'); return result
}

export function record(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INVALID_INPUT')
  const result = value as Record<string, unknown>
  if (required.some(key => !Object.hasOwn(result, key)) || Object.keys(result).some(key => !required.includes(key) && !optional.includes(key))) fail('INVALID_INPUT')
  return result
}
export function boundedString(value: unknown, max: number, min = 1): string {
  if (typeof value !== 'string' || value.length < min || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail('INVALID_INPUT')
  return value
}
function array(value: unknown, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) fail('INVALID_MANIFEST'); return value }
export function opaqueKey(value: unknown): string { const key = boundedString(value, 64); if (!keyPattern.test(key) || forbiddenKeys.has(key)) fail('INVALID_INPUT'); return key }
export function httpsLiteral(value: unknown): string {
  const text = boundedString(value, 2048)
  let url: URL; try { url = new URL(text) } catch { fail('INVALID_INPUT') }
  if (!text.startsWith('https://') || url.protocol !== 'https:' || !url.hostname || url.username || url.password || /[\s\\]/.test(text)) fail('INVALID_INPUT')
  return text
}
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
export function versionParts(version: unknown): RegExpExecArray {
  const match = semverPattern.exec(boundedString(version, 128))
  if (!match || match[4]?.split('.').some(part => /^\d+$/.test(part) && part.length > 1 && part[0] === '0')) fail('INVALID_INPUT')
  return match
}
export function compareVersions(a: string, b: string): number {
  const left = versionParts(a); const right = versionParts(b)
  for (let i = 1; i <= 3; i++) { const x = BigInt(left[i]); const y = BigInt(right[i]); if (x !== y) return x < y ? -1 : 1 }
  if (!left[4] || !right[4]) return left[4] === right[4] ? 0 : left[4] ? -1 : 1
  const x = left[4].split('.'); const y = right[4].split('.')
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === y[i]) continue
    if (x[i] === undefined || y[i] === undefined) return x[i] === undefined ? -1 : 1
    const xn = /^\d+$/.test(x[i]); const yn = /^\d+$/.test(y[i])
    if (xn && yn) return BigInt(x[i]) < BigInt(y[i]) ? -1 : 1
    if (xn !== yn) return xn ? -1 : 1
    return x[i] < y[i] ? -1 : 1
  }
  return 0
}
export function safeAssetPath(value: unknown): string {
  const path = boundedString(value, 240)
  if (!/^assets\/(?:[^/]+\/)*[^/]+\.png$/.test(path)) fail('INVALID_INPUT')
  validateArchivePath(path); return path
}
export function validateArchivePath(path: string): void {
  if (!path || path.length > 240 || /[\\:\x00-\x1f\x7f<>"|?*]/.test(path) || path.startsWith('/')) fail('INVALID_PACKAGE')
  const parts = path.replace(/\/$/, '').split('/')
  if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) fail('INVALID_PACKAGE')
}
export function validateSettingValue(setting: PluginSetting, value: unknown): string | boolean | number {
  switch (setting.type) {
    case 'text': return boundedString(value, setting.maxLength, setting.minLength)
    case 'enum': if (typeof value === 'string' && setting.options.includes(value)) return value; break
    case 'boolean': if (typeof value === 'boolean') return value; break
    case 'number': if (typeof value === 'number' && Number.isFinite(value) && value >= setting.min && value <= setting.max) return value; break
  }
  fail('INVALID_INPUT')
}
function unique<T>(items: T[], get: (item: T) => string): void { const keys = items.map(get); if (new Set(keys).size !== keys.length) fail('INVALID_MANIFEST') }

export function parseManifest(bytes: Uint8Array, hostVersion: string): ValidatedManifest {
  if (bytes.byteLength > LIMITS.manifest) fail('INVALID_MANIFEST')
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const m = record(parseStrictJson(text), ['manifestVersion', 'id', 'name', 'description', 'author', 'version', 'api', 'type', 'entry', 'requestedCapabilities', 'settings', 'pages', 'actions', 'assets'])
    if (m.manifestVersion !== 1 || m.type !== 'declarative-manager' || !validPluginId(m.id)) fail('INVALID_MANIFEST')
    boundedString(m.name, 80); boundedString(m.description, 512, 0); versionParts(m.version)
    const author = record(m.author, ['name'], ['url']); boundedString(author.name, 128); if (author.url !== undefined) httpsLiteral(author.url)
    const api = record(m.api, ['apiMajor', 'minHostVersion']); versionParts(api.minHostVersion)
    if (api.apiMajor !== 1 || compareVersions(hostVersion, api.minHostVersion as string) < 0) fail('INCOMPATIBLE_PLUGIN')
    const caps = array(m.requestedCapabilities, 128)
    if (caps.some(cap => !PLUGIN_CAPABILITIES.includes(cap as PluginCapability)) || new Set(caps).size !== caps.length || !caps.includes('manager.page')) fail('INVALID_MANIFEST')
    const settings = array(m.settings, LIMITS.settings).map(value => {
      const type = (value as Record<string, unknown>)?.type
      const extra = type === 'text' ? ['minLength', 'maxLength'] : type === 'enum' ? ['options'] : type === 'number' ? ['min', 'max'] : type === 'boolean' ? [] : fail('INVALID_MANIFEST')
      const item = record(value, ['key', 'label', 'type', 'default', ...extra]); opaqueKey(item.key); boundedString(item.label, 128)
      if (type === 'text' && (!Number.isInteger(item.minLength) || !Number.isInteger(item.maxLength) || Number(item.minLength) < 0 || Number(item.maxLength) > 50_000 || Number(item.minLength) > Number(item.maxLength))) fail('INVALID_MANIFEST')
      if (type === 'enum') { const options = array(item.options, 64); if (!options.length) fail('INVALID_MANIFEST'); for (const option of options) boundedString(option, 128); unique(options, option => option as string) }
      if (type === 'number' && (typeof item.min !== 'number' || typeof item.max !== 'number' || !Number.isFinite(item.min) || !Number.isFinite(item.max) || item.min > item.max)) fail('INVALID_MANIFEST')
      validateSettingValue(item as unknown as PluginSetting, item.default); return item
    })
    unique(settings, item => item.key as string)
    const assets = array(m.assets, LIMITS.entries - 1).map(value => { const item = record(value, ['path', 'type']); safeAssetPath(item.path); if (item.type !== 'image/png') fail('INVALID_MANIFEST'); return item })
    unique(assets, item => (item.path as string).toLowerCase())
    const entry = record(m.entry, ['pageId', 'label'], ['icon']); opaqueKey(entry.pageId); boundedString(entry.label, 80)
    if (entry.icon !== undefined && !assets.some(asset => asset.path === entry.icon)) fail('INVALID_MANIFEST')
    const actions = array(m.actions, LIMITS.actions).map(value => {
      const type = (value as Record<string, unknown>)?.type
      if (typeof type !== 'string' || !caps.includes(type) || type === 'manager.page') fail('INVALID_MANIFEST')
      const keys = type.startsWith('plugin.') ? ['key'] : type === 'external.open' ? ['url'] : []
      const item = record(value, ['id', 'type', ...keys]); opaqueKey(item.id)
      if (keys.includes('key')) opaqueKey(item.key)
      if (type.startsWith('plugin.config.') && !settings.some(setting => setting.key === item.key)) fail('INVALID_MANIFEST')
      if (type === 'external.open') httpsLiteral(item.url)
      return item
    })
    unique(actions, item => item.id as string)
    const pages = array(m.pages, LIMITS.pages).map(value => {
      const page = record(value, ['id', 'title', 'blocks']); opaqueKey(page.id); boundedString(page.title, 128)
      for (const value of array(page.blocks, LIMITS.blocks)) {
        const type = (value as Record<string, unknown>)?.type
        switch (type) {
          case 'heading': case 'paragraph': boundedString(record(value, ['type', 'text']).text, 4096, 0); break
          case 'divider': record(value, ['type']); break
          case 'button': { const block = record(value, ['type', 'label', 'actionId']); boundedString(block.label, 128); if (!actions.some(action => action.id === block.actionId)) fail('INVALID_MANIFEST'); break }
          case 'text-input': case 'select': case 'checkbox': {
            const block = record(value, ['type', 'settingKey']); const setting = settings.find(setting => setting.key === block.settingKey)
            if (!caps.includes('plugin.config.read') || !caps.includes('plugin.config.write') || !setting || setting.type !== ({ 'text-input': 'text', select: 'enum', checkbox: 'boolean' }[type])) fail('INVALID_MANIFEST')
            break
          }
          default: fail('INVALID_MANIFEST')
        }
      }
      return page
    })
    unique(pages, page => page.id as string)
    if (!pages.some(page => page.id === entry.pageId)) fail('INVALID_MANIFEST')
    return m as unknown as ValidatedManifest
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'INCOMPATIBLE_PLUGIN') throw error
    fail('INVALID_MANIFEST')
  }
}
