import { randomBytes } from 'node:crypto'
import type { ValidatedWebPackageSnapshot } from './validated-web-package-snapshot.ts'
import { isValidatedWebPackageSnapshot } from './package-validator.ts'

export const WEB_PLUGIN_SCHEME = 'webtools-plugin'
const RUNTIME_HOST = /^[0-9a-f]{32}$/

export function createRuntimeOrigin(): Readonly<{ host: string; origin: string }> {
  const host = randomBytes(16).toString('hex')
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

/** Parse a protocol URL without allowing URL's dot-segment normalization to hide traversal. */
export function parseRuntimePackageUrl(rawUrl: string, expectedHost: string): string | null {
  if (!RUNTIME_HOST.test(expectedHost)) return null
  const match = /^webtools-plugin:\/\/([^/?#]+)(\/[^?#]*)(?:\?[^#]*)?(?:#.*)?$/i.exec(rawUrl)
  if (!match || match[1] !== expectedHost || rawUrl.includes('?') || rawUrl.includes('#')) return null
  const encodedPath = match[2]
  if (/%2f|%5c/i.test(encodedPath) || encodedPath.includes('\\')) return null
  let path: string
  try { path = decodeURIComponent(encodedPath.slice(1)) } catch { return null }
  if (!path || path !== path.normalize('NFC') || path.startsWith('/') || path.includes('\\')) return null
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

export function resolveRuntimeResource(snapshot: ValidatedWebPackageSnapshot, host: string, rawUrl: string) {
  if (!isValidatedWebPackageSnapshot(snapshot)) return undefined
  const path = parseRuntimePackageUrl(rawUrl, host)
  if (!path) return undefined
  return snapshot.getResource(path)
}

export function selectValidatedWebFeature(snapshot: unknown, featureId: string) {
  if (!isValidatedWebPackageSnapshot(snapshot)) throw new TypeError('Web Plugin execution requires a Host-validated package snapshot')
  if (snapshot.manifest.network.mode !== 'none') throw new Error('Web Plugin network mode is unavailable in this runtime')
  const feature = snapshot.manifest.features.find(candidate => candidate.id === featureId)
  if (!feature) throw new Error('Web Plugin Feature does not belong to the validated package')
  const resource = snapshot.inventory.find(item => item.canonicalPath === feature.entry.document && item.mimeType === 'text/html')
  if (!resource) throw new Error('Web Plugin Feature entry is outside the validated package inventory')
  const wasmFiles = snapshot.inventory.filter(item => item.mimeType === 'application/wasm')
  if (feature.executionRequirements.wasm && wasmFiles.length === 0) throw new Error('Web Plugin WASM declaration does not match its validated inventory')
  return Object.freeze({ feature, entryPath: resource.canonicalPath })
}
