import { domainToASCII } from 'node:url'
import { isIP } from 'node:net'
import { compareVersions, parseStrictJsonV1, validPluginIdV1, versionParts } from './manifest-v1.mjs'

export const MANIFEST_VERSION_V2 = 2
export const LIMITS_V2 = Object.freeze({
  archive: 20 * 1024 * 1024, entries: 256, expanded: 50 * 1024 * 1024,
  manifest: 64 * 1024, ratio: 100, depth: 16, html: 1024 * 1024,
  bundleFile: 8 * 1024 * 1024, image: 2 * 1024 * 1024, font: 1024 * 1024,
  icon: 256 * 1024, assets: 128, features: 16, commands: 8, contexts: 4,
  capabilities: 12, networkDomains: 16,
})

const CAPABILITIES = Object.freeze([
  'plugin.config.read', 'plugin.config.write', 'plugin.storage.read', 'plugin.storage.write',
  'external.open', 'clipboard.write', 'clipboard.read', 'sharedAI.complete', 'network.domains',
])
const CONTEXT_SOURCES = new Set(['launcher-input', 'clipboard'])
const HOST_ICON_KEYS = new Set(['sparkles', 'document', 'globe', 'translate'])
const WEB_MEDIA = new Map([
  ['.html', 'text/html'], ['.js', 'text/javascript'], ['.mjs', 'text/javascript'],
  ['.css', 'text/css'], ['.json', 'application/json'], ['.wasm', 'application/wasm'],
])
const ASSET_MEDIA = new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'], ['.woff2', 'font/woff2'],
])
const FORBIDDEN_EXTENSIONS = new Set(['.map', '.exe', '.dll', '.node', '.com', '.scr', '.msi', '.sys', '.ocx', '.cpl', '.bat', '.cmd', '.ps1', '.sh'])

export class ManifestV2ValidationError extends Error {
  constructor(code) {
    super(`Manifest v2 validation failed (${code}).`)
    this.name = 'ManifestV2ValidationError'
    this.code = code
  }
}
function reject(code) { throw new ManifestV2ValidationError(code) }

function object(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) reject('INVALID_FIELD')
  const keys = Object.keys(value)
  if (required.some(key => !Object.hasOwn(value, key))) reject('INVALID_FIELD')
  if (keys.some(key => !required.includes(key) && !optional.includes(key))) reject('UNKNOWN_FIELD')
  return value
}

function array(value, max, min = 0) {
  if (!Array.isArray(value) || value.length < min || value.length > max) reject('INVALID_FIELD')
  return value
}

function string(value, min, max) {
  if (typeof value !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) reject('INVALID_FIELD')
  let count = 0
  for (const scalar of value) {
    const point = scalar.codePointAt(0)
    if (point >= 0xd800 && point <= 0xdfff) reject('INVALID_FIELD')
    count++
  }
  if (count < min || count > max) reject('INVALID_FIELD')
  return value
}

function unique(values, identity = value => value, code = 'INVALID_FIELD') {
  const seen = new Set()
  for (const value of values) {
    const key = identity(value)
    if (seen.has(key)) reject(code)
    seen.add(key)
  }
  return values
}

function canonicalPath(value) {
  if (typeof value !== 'string' || !value || value !== value.normalize('NFC') || value.startsWith('/') || /[\\\u0000-\u001f\u007f?#]/u.test(value) || /^[A-Za-z]:/u.test(value)) reject('INVALID_PATH')
  if (value.split('/').some(part => !part || part === '.' || part === '..')) reject('INVALID_PATH')
  if (value.includes('%')) {
    if (/%(?![0-9a-fA-F]{2})/u.test(value)) reject('INVALID_PATH')
    let decoded = value
    for (let index = 0; index < 3; index++) {
      try {
        const next = decodeURIComponent(decoded)
        if (next === decoded) break
        if (/[\\\u0000?#]/u.test(next) || next.startsWith('/') || /^[A-Za-z]:/u.test(next) || next.split('/').some(part => !part || part === '.' || part === '..')) reject('INVALID_PATH')
        decoded = next
      } catch (error) {
        if (error instanceof ManifestV2ValidationError) throw error
        reject('INVALID_PATH')
      }
    }
    if (/%(?:2e|2f|5c|25)/iu.test(value)) reject('INVALID_PATH')
  }
  return value
}

function extension(path) {
  const slash = path.lastIndexOf('/')
  const dot = path.lastIndexOf('.')
  return dot > slash ? path.slice(dot) : ''
}

function inventoryItem(value, allowed) {
  const item = object(value, ['path', 'mediaType'])
  const path = canonicalPath(item.path)
  const ext = extension(path)
  if (FORBIDDEN_EXTENSIONS.has(ext)) reject('UNSUPPORTED_FILE_TYPE')
  const expected = allowed.get(ext)
  if (!expected) reject('UNSUPPORTED_FILE_TYPE')
  if (item.mediaType !== expected) reject('UNSUPPORTED_FILE_TYPE')
  return Object.freeze({ path, mediaType: expected })
}

function validateHost(host) {
  if (typeof host !== 'string' || !host || host !== host.toLowerCase() || host.endsWith('.') || host.includes('*') || /[^a-z0-9.-]/u.test(host) || isIP(host)) reject('INVALID_NETWORK_DECLARATION')
  const ascii = domainToASCII(host)
  if (!ascii || ascii !== host || host.length > 253 || host === 'localhost' || host.endsWith('.localhost')) reject('INVALID_NETWORK_DECLARATION')
  const labels = host.split('.')
  if (labels.some(label => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label))) reject('INVALID_NETWORK_DECLARATION')
  return host
}

function validateCapabilities(value) {
  const values = array(value, LIMITS_V2.capabilities)
  if (values.some(item => typeof item !== 'string' || !CAPABILITIES.includes(item))) reject('INVALID_CAPABILITY')
  return unique(values, item => item, 'INVALID_CAPABILITY').slice()
}

function validateNetwork(value, requestedCapabilities) {
  object(value, ['mode', 'domains'])
  if (value.mode === 'none') {
    if (!Array.isArray(value.domains) || value.domains.length !== 0 || requestedCapabilities.includes('network.domains')) reject('INVALID_NETWORK_DECLARATION')
    return { value: Object.freeze({ mode: 'none', domains: Object.freeze([]) }), runtimeSupport: 'not-requested' }
  }
  if (value.mode !== 'domains' || !requestedCapabilities.includes('network.domains')) reject('INVALID_NETWORK_DECLARATION')
  const domains = array(value.domains, LIMITS_V2.networkDomains, 1).map(item => {
    object(item, ['host', 'protocol'])
    const host = validateHost(item.host)
    if (item.protocol !== 'https' && item.protocol !== 'wss') reject('INVALID_NETWORK_DECLARATION')
    return Object.freeze({ host, protocol: item.protocol })
  })
  unique(domains, item => `${item.protocol}\0${item.host}`, 'INVALID_NETWORK_DECLARATION')
  return { value: Object.freeze({ mode: 'domains', domains: Object.freeze(domains) }), runtimeSupport: 'unavailable' }
}

function validateIcon(value, assetsByPath) {
  if (value === undefined) return undefined
  object(value, ['kind', value.kind === 'host' ? 'key' : 'path'])
  if (value.kind === 'host') {
    if (!HOST_ICON_KEYS.has(value.key)) reject('INVALID_FIELD')
    return Object.freeze({ kind: 'host', key: value.key })
  }
  if (value.kind === 'asset') {
    const path = canonicalPath(value.path)
    const item = assetsByPath.get(path)
    if (!item || !['image/png', 'image/jpeg', 'image/webp'].includes(item.mediaType)) reject('INVALID_FIELD')
    return Object.freeze({ kind: 'asset', path })
  }
  reject('INVALID_FIELD')
}

export function parseManifestV2(source, hostVersion, reservedFeatureIdentities = ['webtools.translation\0translate-text']) {
  if (!(source instanceof Uint8Array) || source.byteLength > LIMITS_V2.manifest) reject('PACKAGE_LIMIT_EXCEEDED')
  let json
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(source)
    json = parseStrictJsonV1(text, LIMITS_V2.depth)
  } catch (error) {
    if (error instanceof ManifestV2ValidationError) throw error
    reject('INVALID_MANIFEST')
  }

  object(json, ['manifestVersion', 'id', 'name', 'description', 'author', 'version', 'api', 'type', 'requestedCapabilities', 'features', 'webBundle', 'network'], ['assets'])
  if (json.manifestVersion !== 2 || !Number.isInteger(json.manifestVersion)) reject('UNSUPPORTED_MANIFEST_VERSION')
  if (json.type !== 'feature-bundle') reject('INVALID_MANIFEST')
  if (!validPluginIdV1(json.id)) reject('INVALID_PLUGIN_ID')
  if (json.id === 'webtools' || json.id.startsWith('webtools.')) reject('RESERVED_IDENTITY')
  string(json.name, 1, 80)
  string(json.description, 0, 512)
  const authorInput = object(json.author, ['name'], ['url'])
  const author = { name: string(authorInput.name, 1, 128) }
  if (authorInput.url !== undefined) {
    const url = string(authorInput.url, 1, 2048)
    let parsed
    try { parsed = new URL(url) } catch { reject('INVALID_FIELD') }
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.href !== url || Buffer.byteLength(url, 'utf8') > 2048) reject('INVALID_FIELD')
    author.url = url
  }
  const versionInput = string(json.version, 1, 128)
  try { versionParts(versionInput) } catch { reject('INVALID_FIELD') }
  const apiInput = object(json.api, ['apiMajor', 'minHostVersion'])
  if (apiInput.apiMajor !== 1) reject('INCOMPATIBLE_HOST')
  const minHostVersion = string(apiInput.minHostVersion, 1, 128)
  try {
    if (compareVersions(hostVersion, minHostVersion) < 0) reject('INCOMPATIBLE_HOST')
  } catch (error) {
    if (error instanceof ManifestV2ValidationError) throw error
    reject('INVALID_FIELD')
  }
  const requestedCapabilities = validateCapabilities(json.requestedCapabilities)
  const webFiles = array(object(json.webBundle, ['files']).files, LIMITS_V2.entries).map(item => inventoryItem(item, WEB_MEDIA))
  if (webFiles.some(file => file.path.toLowerCase() === 'manifest.json')) reject('INVALID_PATH')
  unique(webFiles, item => item.path, 'INVALID_PATH')
  const assets = array(json.assets === undefined ? [] : json.assets, LIMITS_V2.assets).map(item => inventoryItem(item, ASSET_MEDIA))
  unique(assets, item => item.path, 'INVALID_PATH')
  const webPaths = new Set(webFiles.map(item => item.path))
  if (assets.some(item => webPaths.has(item.path))) reject('INVALID_PATH')
  const assetsByPath = new Map(assets.map(item => [item.path, item]))
  const entries = []
  const featuresInput = array(json.features, LIMITS_V2.features, 1)
  const featureIds = new Set()
  for (const value of featuresInput) {
    const item = object(value, ['id', 'title', 'entry'], ['description', 'commands', 'icon', 'acceptedContexts', 'requiredCapabilities', 'executionRequirements'])
    if (typeof item.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(item.id) || item.id.length > 64) reject('INVALID_FIELD')
    if (featureIds.has(item.id)) reject('DUPLICATE_FEATURE')
    featureIds.add(item.id)
    const identity = `${json.id}\0${item.id}`
    if (reservedFeatureIdentities.includes(identity)) reject('RESERVED_IDENTITY')
    const title = string(item.title, 1, 80)
    const feature = { id: item.id, title }
    if (item.description !== undefined) feature.description = string(item.description, 0, 240)
    const commands = array(item.commands === undefined ? [] : item.commands, LIMITS_V2.commands).map(command => string(command, 1, 48))
    unique(commands, command => command.normalize('NFC'), 'INVALID_FIELD')
    feature.commands = Object.freeze(commands)
    if (item.icon !== undefined) feature.icon = validateIcon(item.icon, assetsByPath)
    const contexts = array(item.acceptedContexts === undefined ? [] : item.acceptedContexts, LIMITS_V2.contexts).map(context => {
      object(context, ['type', 'sources'])
      if (context.type !== 'text') reject('INVALID_FIELD')
      const sources = array(context.sources, 2, 1)
      if (sources.some(source => !CONTEXT_SOURCES.has(source))) reject('INVALID_FIELD')
      unique(sources, source => source, 'INVALID_FIELD')
      return Object.freeze({ type: 'text', sources: Object.freeze(sources.slice().sort()) })
    })
    unique(contexts, context => `${context.type}\0${context.sources.join('\0')}`, 'INVALID_FIELD')
    feature.acceptedContexts = Object.freeze(contexts)
    const entry = object(item.entry, ['kind', 'document'])
    const document = canonicalPath(entry.document)
    if (entry.kind !== 'web-bundle' || !webFiles.some(file => file.path === document && file.mediaType === 'text/html')) reject('INVALID_FIELD')
    feature.entry = Object.freeze({ kind: 'web-bundle', document })
    const requiredCapabilities = validateCapabilities(item.requiredCapabilities === undefined ? [] : item.requiredCapabilities)
    if (requiredCapabilities.some(capability => !requestedCapabilities.includes(capability))) reject('INVALID_CAPABILITY')
    feature.requiredCapabilities = Object.freeze(requiredCapabilities)
    const executionRequirements = object(item.executionRequirements === undefined ? { wasm: false } : item.executionRequirements, ['wasm'])
    if (typeof executionRequirements.wasm !== 'boolean') reject('INVALID_FIELD')
    feature.executionRequirements = Object.freeze({ wasm: executionRequirements.wasm })
    if (executionRequirements.wasm && !webFiles.some(file => file.mediaType === 'application/wasm')) reject('INVALID_FIELD')
    entries.push(Object.freeze(feature))
  }

  const inventoryPaths = [...webFiles, ...assets].map(item => item.path)
  const folded = new Set()
  for (const path of inventoryPaths) {
    const key = path.normalize('NFC').toLowerCase()
    if (folded.has(key)) reject('INVALID_PATH')
    folded.add(key)
  }
  const pathSet = new Set(inventoryPaths)
  for (const path of inventoryPaths) {
    const segments = path.split('/')
    for (let index = 1; index < segments.length; index++) {
      if (pathSet.has(segments.slice(0, index).join('/'))) reject('INVALID_PATH')
    }
  }
  const network = validateNetwork(json.network, requestedCapabilities)
  if (network.value.mode === 'domains' && !requestedCapabilities.includes('network.domains')) reject('INVALID_NETWORK_DECLARATION')
  if (requestedCapabilities.includes('network.domains') && network.value.mode !== 'domains') reject('INVALID_NETWORK_DECLARATION')

  const manifest = {
    manifestVersion: 2,
    id: json.id,
    name: json.name,
    description: json.description,
    author: Object.freeze(author),
    version: versionInput,
    api: Object.freeze({ apiMajor: 1, minHostVersion }),
    type: 'feature-bundle',
    requestedCapabilities: Object.freeze(requestedCapabilities),
    features: Object.freeze(entries),
    webBundle: Object.freeze({ files: Object.freeze(webFiles) }),
    assets: Object.freeze(assets),
    network: network.value,
  }
  return Object.freeze({ manifest: Object.freeze(manifest), networkRuntimeSupport: network.runtimeSupport })
}
