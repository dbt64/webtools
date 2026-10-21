import { createHash, randomBytes } from 'node:crypto'
import type { ValidatedWebPackageSnapshot } from './validated-web-package-snapshot.ts'
import type { ValidatedPluginPackageSnapshotV3 } from './validated-plugin-package-snapshot.ts'
import { isValidatedPluginRuntimeSnapshot } from './package-validator.ts'

export const WEB_PLUGIN_SCHEME = 'webtools-plugin'
const RUNTIME_HOST = /^(?:[0-9a-f]{32}|p-[a-z2-7]{52})$/

function stableHost(pluginId: string): string {
  const digest = createHash('sha256').update(pluginId, 'utf8').digest()
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'
  let bits = 0; let value = 0; let encoded = ''
  for (const byte of digest) {
    value = (value << 8) | byte; bits += 8
    while (bits >= 5) { bits -= 5; encoded += alphabet[(value >>> bits) & 31] }
    value &= (1 << bits) - 1
  }
  if (bits) encoded += alphabet[(value << (5 - bits)) & 31]
  return `p-${encoded}`
}

export function createRuntimeOrigin(pluginId?: string): Readonly<{ host: string; origin: string }> {
  const host = pluginId === undefined ? randomBytes(16).toString('hex') : stableHost(pluginId)
  return Object.freeze({ host, origin: `${WEB_PLUGIN_SCHEME}://${host}` })
}

export function buildRuntimeCsp(wasm = false): string {
  return [
    "default-src 'none'", "base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'",
    "form-action 'none'", `script-src 'self'${wasm ? " 'wasm-unsafe-eval'" : ''}`,
    "style-src 'self'", "img-src 'self' data:", "font-src 'self'", "connect-src 'self'",
    "worker-src 'none'", "frame-src 'none'", "manifest-src 'self'",
  ].join('; ')
}

/** Standard Chromium networking, workers, storage and WASM for production Manifest v3 plugins. */
export function buildRuntimeCspV3(): string {
  return [
    "default-src 'self' data: blob:", "base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'",
    "form-action https: http:", "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https: http:", "font-src 'self' data: https: http:",
    "connect-src 'self' https: http: ws: wss:", "worker-src 'self' blob:", "frame-src 'none'",
    "manifest-src 'self' https: http:",
  ].join('; ')
}

/** Parse a protocol URL without allowing URL's dot-segment normalization to hide traversal. */
export function parseRuntimePackageUrl(rawUrl: string, expectedHost: string): string | null {
  if (!RUNTIME_HOST.test(expectedHost)) return null
  const match = /^webtools-plugin:\/\/([^/?#]+)(\/[^?#]*)(?:\?[^#]*)?(?:#.*)?$/i.exec(rawUrl)
  if (!match || match[1] !== expectedHost) return null
  const encodedPath = match[2]
  if (/%2f|%5c/i.test(encodedPath) || encodedPath.includes('\\')) return null
  let path: string
  try { path = decodeURIComponent(encodedPath.slice(1)) } catch { return null }
  if (!path || path !== path.normalize('NFC') || path.startsWith('/') || /[\\?#]/u.test(path)) return null
  const segments = path.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return null
  return path
}

export function buildRuntimeResourceUrl(host: string, canonicalPath: string): string {
  if (!RUNTIME_HOST.test(host) || !canonicalPath || canonicalPath !== canonicalPath.normalize('NFC')
    || canonicalPath.startsWith('/') || canonicalPath.includes('\\')
    || canonicalPath.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
    throw new TypeError('Invalid validated Web Plugin route')
  }
  const path = canonicalPath.split('/').map(segment => encodeURIComponent(segment)).join('/')
  return `${WEB_PLUGIN_SCHEME}://${host}/${path}`
}

export function resolveRuntimeResource(snapshot: ValidatedWebPackageSnapshot | ValidatedPluginPackageSnapshotV3, host: string, rawUrl: string) {
  if (!isValidatedPluginRuntimeSnapshot(snapshot)) return undefined
  const path = parseRuntimePackageUrl(rawUrl, host)
  if (!path) return undefined
  return snapshot.getResource(path)
}

export function selectValidatedWebFeature(snapshot: unknown, featureId: string) {
  if (!isValidatedPluginRuntimeSnapshot(snapshot)) throw new TypeError('Web Plugin execution requires a Host-validated package snapshot')
  if (snapshot.manifest.manifestVersion === 2 && snapshot.manifest.network.mode !== 'none') throw new Error('Legacy Web Plugin network mode is unavailable in this runtime')
  const feature = snapshot.manifest.features.find(candidate => candidate.id === featureId)
  if (!feature) throw new Error('Web Plugin Feature does not belong to the validated package')
  if (feature.entry.kind !== 'web-bundle') throw new Error('This Feature requires the Node command execution adapter.')
  const entryPath = feature.entry.document
  const resource = snapshot.inventory.find(item => item.canonicalPath === entryPath && item.mimeType === 'text/html')
  if (!resource) throw new Error('Web Plugin Feature entry is outside the validated package inventory')
  let csp: string
  if (snapshot.manifest.manifestVersion === 2) {
    const wasmFiles = snapshot.inventory.filter(item => item.mimeType === 'application/wasm')
    const legacyFeature = feature as ValidatedWebPackageSnapshot['manifest']['features'][number]
    if (legacyFeature.executionRequirements.wasm && wasmFiles.length === 0) throw new Error('Web Plugin WASM declaration does not match its validated inventory')
    csp = buildRuntimeCsp(legacyFeature.executionRequirements.wasm)
  } else csp = buildRuntimeCspV3()
  return Object.freeze({ feature, entryPath: resource.canonicalPath, runtimeKind: snapshot.manifest.manifestVersion === 3 ? snapshot.manifest.runtime.kind : 'web' as const,
    csp })
}
