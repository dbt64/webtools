import { createHash } from 'node:crypto'
import { extname, isAbsolute } from 'node:path'

const ARG_PREFIX = '--webtools-plugin-runtime='
const MAX_DESCRIPTOR_CHARS = 128 * 1024
const PLUGIN_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const HASH = /^[a-f0-9]{64}$/
export interface NodePluginRuntimeDescriptor { pluginId: string; packageHash: string; preloadPath: string; preloadHash: string; localDataPath: string; generation: number }
export interface NodePluginPreloadBootstrapDependencies {
  readFile(path: string): Buffer
  setPluginData(path: string): void
  requirePlugin(path: string): void
}

function exactObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return (prototype === Object.prototype || prototype === null)
    && Object.keys(value).sort().join(',') === 'generation,localDataPath,packageHash,pluginId,preloadHash,preloadPath'
}

export function parseNodePluginRuntimeDescriptor(encoded: string): NodePluginRuntimeDescriptor {
  if (!encoded || encoded.length > MAX_DESCRIPTOR_CHARS || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new TypeError('Invalid Node Plugin runtime descriptor encoding')
  const bytes = Buffer.from(encoded, 'base64url')
  if (bytes.toString('base64url') !== encoded) throw new TypeError('Non-canonical Node Plugin runtime descriptor')
  let value: unknown
  try { value = JSON.parse(bytes.toString('utf8')) } catch { throw new TypeError('Invalid Node Plugin runtime descriptor JSON') }
  if (!exactObject(value) || typeof value.pluginId !== 'string' || value.pluginId.length > 128 || !PLUGIN_ID.test(value.pluginId)
    || typeof value.packageHash !== 'string' || !HASH.test(value.packageHash)
    || typeof value.preloadHash !== 'string' || !HASH.test(value.preloadHash)
    || typeof value.preloadPath !== 'string' || !isAbsolute(value.preloadPath) || extname(value.preloadPath).toLowerCase() !== '.cjs'
    || typeof value.localDataPath !== 'string' || !isAbsolute(value.localDataPath)
    || !Number.isSafeInteger(value.generation) || (value.generation as number) < 1) throw new TypeError('Invalid Node Plugin runtime descriptor fields')
  return value as unknown as NodePluginRuntimeDescriptor
}

export function loadNodePluginPreload(argv: readonly string[], dependencies: NodePluginPreloadBootstrapDependencies): boolean {
  const args = argv.filter(value => value.startsWith(ARG_PREFIX))
  if (!args.length) return false
  if (args.length !== 1) throw new TypeError('Duplicate Node Plugin runtime descriptors')
  const descriptor = parseNodePluginRuntimeDescriptor(args[0].slice(ARG_PREFIX.length))
  const bytes = dependencies.readFile(descriptor.preloadPath)
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (hash !== descriptor.preloadHash) throw new TypeError('Node Plugin preload integrity check failed')
  dependencies.setPluginData(descriptor.localDataPath)
  dependencies.requirePlugin(descriptor.preloadPath)
  return true
}
