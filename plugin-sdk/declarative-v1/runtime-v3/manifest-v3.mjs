import { compareVersions, parseStrictJson, validPluginId, versionParts } from '../runtime/manifest-v1.mjs'
import { validateConfiguration } from './configuration.mjs'

export const MANIFEST_VERSION_V3 = 3
export const LIMITS_V3 = Object.freeze({
  archive: 512 * 1024 * 1024,
  entries: 50_000,
  expanded: 2 * 1024 * 1024 * 1024,
  manifest: 256 * 1024,
  ratio: 200,
  depth: 24,
  // Keep the per-entry path compatible with Windows MAX_PATH-era host APIs and ManagedFs.
  pathScalars: 240,
  runtimeFiles: 49_999,
  dependencies: 2_000,
  features: 64,
  capabilities: 8,
  nodePreload: 16 * 1024 * 1024,
})

const CAPABILITIES = Object.freeze([
  'manager.page', 'plugin.config.read', 'plugin.config.write', 'plugin.storage.read',
  'plugin.storage.write', 'external.open', 'clipboard.write', 'clipboard.read', 'sharedAI.complete',
])
const ROLES = new Set(['web', 'node-preload', 'node-command', 'dependency', 'native-addon', 'helper', 'library', 'resource'])
const MEDIA = new Set([
  'text/html', 'text/javascript', 'text/css', 'application/json', 'application/wasm',
  'image/png', 'image/jpeg', 'image/webp', 'font/woff2', 'application/octet-stream',
])
const PLATFORMS = new Set(['win32', 'darwin', 'linux'])
const ARCHITECTURES = new Set(['x64', 'arm64', 'ia32'])
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

export class ManifestV3ValidationError extends Error {
  constructor(code) {
    super(`Manifest v3 validation failed (${code}).`)
    this.name = 'ManifestV3ValidationError'
    this.code = code
  }
}
function reject(code) { throw new ManifestV3ValidationError(code) }

function object(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) reject('INVALID_FIELD')
  const keys = Object.keys(value)
  if (required.some(key => !Object.hasOwn(value, key))) reject('INVALID_FIELD')
  if (keys.some(key => FORBIDDEN_KEYS.has(key) || (!required.includes(key) && !optional.includes(key)))) reject('UNKNOWN_FIELD')
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
  if (typeof value !== 'string' || !value || value.length > LIMITS_V3.pathScalars || value !== value.normalize('NFC')
    || value.startsWith('/') || /[\\\u0000-\u001f\u007f?#:]/u.test(value) || value.includes('%')) reject('INVALID_PATH')
  const segments = value.split('/')
  if (segments.some(part => !part || part === '.' || part === '..' || part.endsWith('.') || part.endsWith(' ')
    || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part))) reject('INVALID_PATH')
  if (segments.some(part => /[<>"|*]/u.test(part))) reject('INVALID_PATH')
  return value
}
function extension(path) {
  const slash = path.lastIndexOf('/')
  const dot = path.lastIndexOf('.')
  return dot > slash ? path.slice(dot).toLowerCase() : ''
}
function validPackageName(value) {
  return typeof value === 'string' && value.length <= 214
    && /^(?:@[a-z0-9][a-z0-9._~-]{0,99}\/)?[a-z0-9][a-z0-9._~-]{0,99}$/u.test(value)
}
function dependencyPathMatches(path, name) {
  return path === `node_modules/${name}/package.json`
    || path.endsWith(`/node_modules/${name}/package.json`)
    || path.startsWith(`node_modules/${name}/`)
    || path.includes(`/node_modules/${name}/`)
}
function dependencyRoot(path, name) {
  if (path === `node_modules/${name}/package.json`) return `node_modules/${name}`
  const suffix = `/node_modules/${name}/package.json`
  return path.endsWith(suffix) ? path.slice(0, -'/package.json'.length) : undefined
}
function hostContext(value) {
  const result = value ?? {}
  object(result, [], ['platform', 'architecture', 'nodeAbi', 'hostVersion'])
  if (result.platform !== undefined && typeof result.platform !== 'string') reject('INVALID_FIELD')
  if (result.architecture !== undefined && typeof result.architecture !== 'string') reject('INVALID_FIELD')
  if (result.nodeAbi !== undefined && (typeof result.nodeAbi !== 'string' || !/^[1-9][0-9]{0,5}$/u.test(result.nodeAbi))) reject('INVALID_FIELD')
  return result
}

function validateCapabilities(value) {
  const capabilities = array(value, LIMITS_V3.capabilities).map(capability => {
    if (typeof capability !== 'string' || !CAPABILITIES.includes(capability)) reject('INVALID_CAPABILITY')
    return capability
  })
  return unique(capabilities, item => item, 'INVALID_CAPABILITY').slice()
}

function validateCompatibility(value, runtimeKind, hasNative, host) {
  object(value, ['platforms', 'architectures'], ['nodeAbi'])
  const platforms = unique(array(value.platforms, PLATFORMS.size, 1).map(platform => {
    if (!PLATFORMS.has(platform)) reject('INVALID_FIELD')
    return platform
  }), item => item)
  const architectures = unique(array(value.architectures, ARCHITECTURES.size, 1).map(architecture => {
    if (!ARCHITECTURES.has(architecture)) reject('INVALID_FIELD')
    return architecture
  }), item => item)
  let nodeAbi
  if (value.nodeAbi !== undefined) {
    if (typeof value.nodeAbi !== 'string' || !/^[1-9][0-9]{0,5}$/u.test(value.nodeAbi)) reject('INVALID_FIELD')
    nodeAbi = value.nodeAbi
  }
  if ((runtimeKind === 'node' && hasNative) && nodeAbi === undefined) reject('INCOMPATIBLE_PLUGIN')
  if (host.platform && !platforms.includes(host.platform)) reject('INCOMPATIBLE_PLUGIN')
  if (host.architecture && !architectures.includes(host.architecture)) reject('INCOMPATIBLE_PLUGIN')
  if (nodeAbi && host.nodeAbi && nodeAbi !== host.nodeAbi) reject('INCOMPATIBLE_PLUGIN')
  return Object.freeze({ platforms: Object.freeze(platforms.slice().sort()), architectures: Object.freeze(architectures.slice().sort()), ...(nodeAbi ? { nodeAbi } : {}) })
}

function validateRuntime(value, filesByPath) {
  object(value, ['kind'], ['preload'])
  if (value.kind !== 'web' && value.kind !== 'node') reject('INVALID_FIELD')
  if (value.preload !== undefined) {
    const preload = canonicalPath(value.preload)
    const item = filesByPath.get(preload)
    if (value.kind !== 'node' || !item || item.role !== 'node-preload' || extension(preload) !== '.cjs') reject('INVALID_FIELD')
    return Object.freeze({ kind: value.kind, preload })
  }
  if (value.kind === 'web' && [...filesByPath.values()].some(item => item.role === 'node-preload')) reject('INVALID_FIELD')
  return Object.freeze({ kind: value.kind })
}

function validateRuntimeFile(value) {
  object(value, ['path', 'role', 'mediaType'], ['dependency'])
  const path = canonicalPath(value.path)
  if (!ROLES.has(value.role) || !MEDIA.has(value.mediaType)) reject('UNSUPPORTED_FILE_TYPE')
  const ext = extension(path)
  const role = value.role
  if (role === 'web') {
    const mediaByExtension = new Map([
      ['.html', 'text/html'], ['.htm', 'text/html'], ['.js', 'text/javascript'], ['.mjs', 'text/javascript'], ['.cjs', 'text/javascript'],
      ['.css', 'text/css'], ['.json', 'application/json'], ['.wasm', 'application/wasm'],
      ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'], ['.woff2', 'font/woff2'],
    ])
    if (mediaByExtension.get(ext) !== value.mediaType) reject('UNSUPPORTED_FILE_TYPE')
  } else if (role === 'node-preload' || role === 'node-command') {
    if (ext !== '.cjs' || value.mediaType !== 'text/javascript') reject('UNSUPPORTED_FILE_TYPE')
  } else if (role === 'native-addon') {
    if (ext !== '.node' || value.mediaType !== 'application/octet-stream' || !validPackageName(value.dependency)) reject('UNSUPPORTED_FILE_TYPE')
  } else if (role === 'helper') {
    if (!['.exe', '.com'].includes(ext) || value.mediaType !== 'application/octet-stream' || value.dependency !== undefined) reject('UNSUPPORTED_FILE_TYPE')
  } else if (role === 'library') {
    if (!['.dll'].includes(ext) || value.mediaType !== 'application/octet-stream' || value.dependency !== undefined) reject('UNSUPPORTED_FILE_TYPE')
  } else if (role === 'dependency') {
    if (!validPackageName(value.dependency) || !dependencyPathMatches(path, value.dependency)) reject('INVALID_FIELD')
    if (!['.js', '.cjs', '.mjs', '.json', '.node', '.dll', '.exe', '.wasm', '.dat', '.bin'].includes(ext)
      && value.mediaType !== 'application/octet-stream') reject('UNSUPPORTED_FILE_TYPE')
  } else if (value.dependency !== undefined) reject('INVALID_FIELD')
  if (['dependency', 'native-addon'].includes(role) && value.dependency === undefined) reject('INVALID_FIELD')
  return Object.freeze({ path, role, mediaType: value.mediaType, ...(value.dependency ? { dependency: value.dependency } : {}) })
}

function validateDependencies(value, filesByPath) {
  const roots = new Set()
  const dependencies = array(value, LIMITS_V3.dependencies).map(entry => {
    object(entry, ['name', 'version', 'files'])
    if (!validPackageName(entry.name)) reject('INVALID_FIELD')
    try { versionParts(entry.version) } catch { reject('INVALID_FIELD') }
    const files = unique(array(entry.files, LIMITS_V3.runtimeFiles, 1).map(canonicalPath), item => item, 'INVALID_FIELD')
    const manifestFiles = files.filter(path => dependencyRoot(path, entry.name) !== undefined
      && filesByPath.get(path)?.mediaType === 'application/json')
    if (manifestFiles.length !== 1) reject('INVENTORY_MISMATCH')
    const root = dependencyRoot(manifestFiles[0], entry.name)
    if (!root) reject('INVENTORY_MISMATCH')
    if (roots.has(root)) reject('INVALID_FIELD')
    roots.add(root)
    if (files.some(path => {
      const file = filesByPath.get(path)
      return !file || !['dependency', 'native-addon'].includes(file.role) || file.dependency !== entry.name
        || (path !== manifestFiles[0] && !path.startsWith(`${root}/`))
    })) reject('INVENTORY_MISMATCH')
    return Object.freeze({ name: entry.name, version: entry.version, files: Object.freeze(files.slice().sort()) })
  })
  const ownedFiles = new Set(dependencies.flatMap(item => item.files))
  if (ownedFiles.size !== dependencies.reduce((total, item) => total + item.files.length, 0)) reject('INVENTORY_MISMATCH')
  for (const file of filesByPath.values()) {
    if (['dependency', 'native-addon'].includes(file.role) && !ownedFiles.has(file.path)) reject('INVENTORY_MISMATCH')
  }
  return Object.freeze(dependencies)
}

function validatePresentation(value = { type: 'window' }) {
  object(value, ['type'], ['defaultWidth', 'defaultHeight', 'minWidth', 'minHeight', 'resizable', 'blurBehavior'])
  if (value.type !== 'command' && value.type !== 'window') reject('INVALID_FIELD')
  if (value.type === 'command') object(value, ['type'])
  const result = { type: value.type }
  if (value.type === 'window') {
    if (value.blurBehavior !== undefined && !['temporary-hide', 'background'].includes(value.blurBehavior)) reject('INVALID_FIELD')
    result.blurBehavior = value.blurBehavior ?? 'temporary-hide'
  }
  for (const key of ['defaultWidth', 'defaultHeight', 'minWidth', 'minHeight']) {
    if (value[key] !== undefined) {
      if (!Number.isInteger(value[key]) || value[key] < 1 || value[key] > 32768) reject('INVALID_FIELD')
      result[key] = value[key]
    }
  }
  if (value.resizable !== undefined) {
    if (typeof value.resizable !== 'boolean') reject('INVALID_FIELD')
    result.resizable = value.resizable
  }
  return Object.freeze(result)
}

function validateFeature(value, id, filesByPath, requestedCapabilities, runtimeKind) {
  object(value, ['id', 'title', 'entry'], ['description', 'commands', 'icon', 'acceptedContexts', 'requiredCapabilities', 'presentation'])
  if (typeof value.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value.id) || value.id.length > 64) reject('INVALID_FIELD')
  const title = string(value.title, 1, 80)
  const feature = { id: value.id, title }
  feature.presentation = validatePresentation(value.presentation)
  if (value.description !== undefined) feature.description = string(value.description, 0, 240)
  const commands = array(value.commands === undefined ? [] : value.commands, 8).map(command => string(command, 1, 48))
  unique(commands, command => command.normalize('NFC'), 'INVALID_FIELD')
  feature.commands = Object.freeze(commands)
  const entry = object(value.entry, ['kind'], ['document', 'module'])
  if (entry.kind === 'node-command') {
    object(entry, ['kind', 'module'])
    const module = canonicalPath(entry.module)
    const file = filesByPath.get(module)
    if (runtimeKind !== 'node' || feature.presentation.type !== 'command' || file?.role !== 'node-command'
      || file.mediaType !== 'text/javascript' || extension(module) !== '.cjs') reject('INVALID_FIELD')
    feature.entry = Object.freeze({ kind: 'node-command', module })
  } else {
    object(entry, ['kind', 'document'])
    const document = canonicalPath(entry.document)
    if (entry.kind !== 'web-bundle' || filesByPath.get(document)?.role !== 'web' || filesByPath.get(document)?.mediaType !== 'text/html') reject('INVALID_FIELD')
    feature.entry = Object.freeze({ kind: 'web-bundle', document })
  }
  const required = validateCapabilities(value.requiredCapabilities ?? [])
  if (required.some(capability => !requestedCapabilities.includes(capability))) reject('INVALID_CAPABILITY')
  feature.requiredCapabilities = Object.freeze(required)
  if (value.acceptedContexts !== undefined) {
    const contexts = array(value.acceptedContexts, 4).map(context => {
      object(context, ['type', 'sources'], ['extensions', 'maxItems', 'textMatch'])
      if (!['text', 'files', 'directories', 'none'].includes(context.type)) reject('INVALID_FIELD')
      const allowed = context.type === 'text' ? ['launcher-input', 'clipboard', 'selected-text']
        : context.type === 'none' ? [] : ['explorer-selection']
      const sources = unique(array(context.sources, allowed.length, context.type === 'none' ? 0 : 1).map(source => {
        if (!allowed.includes(source)) reject('INVALID_FIELD')
        return source
      }), item => item)
      if (context.textMatch !== undefined && (context.textMatch !== 'http-url' || context.type !== 'text'
        || sources.length !== 1 || sources[0] !== 'selected-text')) reject('INVALID_FIELD')
      if (Object.hasOwn(context, 'textMatch') && context.textMatch === undefined) reject('INVALID_FIELD')
      if (context.maxItems !== undefined && (!['files', 'directories'].includes(context.type)
        || !Number.isInteger(context.maxItems) || context.maxItems < 1 || context.maxItems > 64)) reject('INVALID_FIELD')
      let extensions
      if (context.extensions !== undefined) {
        if (context.type !== 'files') reject('INVALID_FIELD')
        extensions = unique(array(context.extensions, 16).map(value => {
          if (typeof value !== 'string' || !/^\.[a-zA-Z0-9]{1,16}$/u.test(value)) reject('INVALID_FIELD')
          return value.toLowerCase()
        }), item => item).sort()
      }
      return Object.freeze({ type: context.type, sources: Object.freeze(sources.slice().sort()),
        ...(context.textMatch !== undefined ? { textMatch: context.textMatch } : {}),
        ...(extensions ? { extensions: Object.freeze(extensions) } : {}),
        ...(context.maxItems !== undefined ? { maxItems: context.maxItems } : {}) })
    })
    feature.acceptedContexts = Object.freeze(contexts)
  } else feature.acceptedContexts = Object.freeze([])
  if (value.icon !== undefined) {
    object(value.icon, ['kind', value.icon.kind === 'host' ? 'key' : 'path'])
    if (value.icon.kind === 'host') {
      if (!['sparkles', 'document', 'globe', 'translate'].includes(value.icon.key)) reject('INVALID_FIELD')
      feature.icon = Object.freeze({ kind: 'host', key: value.icon.key })
    } else if (value.icon.kind === 'asset') {
      const path = canonicalPath(value.icon.path)
      const file = filesByPath.get(path)
      if (!file || file.role !== 'resource' || !['image/png', 'image/jpeg', 'image/webp'].includes(file.mediaType)) reject('INVALID_FIELD')
      feature.icon = Object.freeze({ kind: 'asset', path })
    } else reject('INVALID_FIELD')
  }
  return Object.freeze(feature)
}

function validateAuthor(value) {
  object(value, ['name'], ['url'])
  const result = { name: string(value.name, 1, 128) }
  if (value.url !== undefined) {
    const url = string(value.url, 1, 2048)
    let parsed
    try { parsed = new URL(url) } catch { reject('INVALID_FIELD') }
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.href !== url) reject('INVALID_FIELD')
    result.url = url
  }
  return Object.freeze(result)
}

export function parseManifestV3(source, hostVersion, hostInput) {
  if (!(source instanceof Uint8Array) || source.byteLength > LIMITS_V3.manifest) reject('PACKAGE_LIMIT_EXCEEDED')
  let json
  try { json = parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(source), LIMITS_V3.depth) }
  catch { reject('INVALID_MANIFEST') }
  object(json, ['manifestVersion', 'id', 'name', 'description', 'author', 'version', 'api', 'type', 'requestedCapabilities', 'runtime', 'compatibility', 'features', 'runtimeFiles', 'dependencies', 'package'], ['configuration'])
  if (json.manifestVersion !== MANIFEST_VERSION_V3 || !Number.isInteger(json.manifestVersion)) reject('UNSUPPORTED_MANIFEST_VERSION')
  if (json.type !== 'plugin') reject('INVALID_MANIFEST')
  if (!validPluginId(json.id) || json.id === 'webtools' || json.id.startsWith('webtools.')) reject('INVALID_PLUGIN_ID')
  const name = string(json.name, 1, 80)
  const description = string(json.description, 0, 512)
  const author = validateAuthor(json.author)
  const version = string(json.version, 1, 128)
  try { versionParts(version) } catch { reject('INVALID_FIELD') }
  const api = object(json.api, ['apiMajor', 'minHostVersion'])
  if (api.apiMajor !== 1) reject('INCOMPATIBLE_HOST')
  const minHostVersion = string(api.minHostVersion, 1, 128)
  try { if (compareVersions(hostVersion, minHostVersion) < 0) reject('INCOMPATIBLE_HOST') }
  catch (error) { if (error instanceof ManifestV3ValidationError) throw error; reject('INVALID_FIELD') }
  const requestedCapabilities = validateCapabilities(json.requestedCapabilities)
  let configuration
  if (json.configuration !== undefined) {
    try { configuration = validateConfiguration(json.configuration) } catch { reject('INVALID_FIELD') }
  }
  const files = array(json.runtimeFiles, LIMITS_V3.runtimeFiles, 1).map(validateRuntimeFile)
  unique(files, item => item.path, 'INVALID_PATH')
  const folded = new Set()
  for (const file of files) {
    const key = file.path.normalize('NFC').toLowerCase()
    if (folded.has(key)) reject('INVALID_PATH')
    folded.add(key)
  }
  const filesByPath = new Map(files.map(file => [file.path, file]))
  const pathSet = new Set(files.map(file => file.path))
  for (const path of pathSet) {
    const segments = path.split('/')
    for (let index = 1; index < segments.length; index++) if (pathSet.has(segments.slice(0, index).join('/'))) reject('INVALID_PATH')
  }
  const runtime = validateRuntime(json.runtime, filesByPath)
  const dependencies = validateDependencies(json.dependencies, filesByPath)
  const hasNative = files.some(file => file.role === 'native-addon')
  const host = hostContext(hostInput)
  const compatibility = validateCompatibility(json.compatibility, runtime.kind, hasNative, host)
  if (runtime.kind === 'web' && files.some(file => ['node-preload', 'node-command', 'dependency', 'native-addon', 'helper', 'library'].includes(file.role))) reject('INVALID_FIELD')
  if (runtime.kind === 'node' && files.some(file => file.role === 'node-preload') && !runtime.preload) reject('INVALID_FIELD')
  const featuresInput = array(json.features, LIMITS_V3.features, 1)
  const features = featuresInput.map(feature => validateFeature(feature, json.id, filesByPath, requestedCapabilities, runtime.kind))
  if (runtime.kind === 'node' && features.some(feature => feature.entry.kind === 'web-bundle') && !runtime.preload) reject('INVALID_FIELD')
  unique(features, item => item.id, 'DUPLICATE_FEATURE')
  const packageInput = object(json.package, ['format', 'packageVersion'], ['metadata'])
  if (packageInput.format !== 'wtplugin' || packageInput.packageVersion !== 1) reject('INVALID_FIELD')
  const metadata = packageInput.metadata === undefined ? undefined : object(packageInput.metadata, [], [])
  if (metadata && Buffer.byteLength(JSON.stringify(metadata), 'utf8') > 16 * 1024) reject('PACKAGE_LIMIT_EXCEEDED')
  const manifest = Object.freeze({
    manifestVersion: MANIFEST_VERSION_V3, id: json.id, name, description, author, version,
    api: Object.freeze({ apiMajor: 1, minHostVersion }), type: 'plugin',
    requestedCapabilities: Object.freeze(requestedCapabilities), runtime, compatibility,
    ...(configuration ? { configuration } : {}),
    features: Object.freeze(features), runtimeFiles: Object.freeze(files), dependencies,
    package: Object.freeze({ format: 'wtplugin', packageVersion: 1, ...(metadata ? { metadata: Object.freeze({ ...metadata }) } : {}) }),
  })
  return Object.freeze({ manifest })
}
