import { readFile } from 'node:fs/promises'
import { validatePackageV1 } from './runtime/package-v1.mjs'
import { failValidation } from './runtime/manifest-v1.mjs'
import { readPluginSource } from './src/source.mjs'
import { packPlugin } from './src/pack.mjs'
import { rejectCredentialLike } from './src/sensitive-content.mjs'

export { PluginValidationError } from './runtime/manifest-v1.mjs'

export const MANIFEST_VERSION_V1 = 1
export const API_MAJOR_V1 = 1
export const CAPABILITIES_V1 = Object.freeze([
  'manager.page', 'plugin.config.read', 'plugin.config.write', 'plugin.storage.read',
  'plugin.storage.write', 'external.open', 'clipboard.write', 'sharedAI.complete',
])
export const BLOCK_TYPES_V1 = Object.freeze(['heading', 'paragraph', 'text-input', 'select', 'checkbox', 'divider', 'button'])
export const ACTION_TYPES_V1 = Object.freeze([
  'plugin.config.read', 'plugin.config.write', 'plugin.storage.read', 'plugin.storage.write',
  'external.open', 'clipboard.write', 'sharedAI.complete',
])
export const LIMITS_V1 = Object.freeze({
  archive: 20 * 1024 * 1024,
  entries: 256,
  expanded: 50 * 1024 * 1024,
  png: 256 * 1024,
  manifest: 64 * 1024,
  ratio: 100,
  depth: 16,
  pages: 8,
  blocks: 64,
  actions: 32,
  settings: 64,
  value: 512 * 1024,
  keys: 200,
  data: 5 * 1024 * 1024,
})

export async function validatePluginSourceV1(sourceDirectory, hostVersion) {
  if (typeof sourceDirectory !== 'string' || !sourceDirectory || typeof hostVersion !== 'string' || !hostVersion) {
    failValidation('INVALID_INPUT', 'manifest.json')
  }

  const source = await readPluginSource(sourceDirectory, hostVersion)
  rejectCredentialLike(source.manifestBytes, 'manifest.json')
  for (const [relative, bytes] of source.assets) rejectCredentialLike(bytes, relative)

  const warnings = source.manifest.entry.icon ? [] : [{
    code: 'GENERIC_ICON',
    path: 'manifest.json',
    field: 'entry.icon',
    message: 'No entry icon is declared; WebTools will use its generic plugin icon.',
    suggestion: 'Add a small declared PNG icon if the plugin should have a custom icon.',
  }]

  return { valid: true, manifest: source.manifest, warnings }
}

export async function validatePluginArchiveV1(bytes, hostVersion) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength <= 0 || bytes.byteLength > LIMITS_V1.archive || typeof hostVersion !== 'string' || !hostVersion) {
    failValidation('INVALID_PACKAGE', 'package.wtplugin')
  }

  const result = await validatePackageV1(bytes, hostVersion)
  rejectCredentialLike(Buffer.from(JSON.stringify(result.manifest)), 'manifest.json')
  for (const [relative, asset] of result.assets) rejectCredentialLike(asset, relative)

  return {
    valid: true,
    manifest: result.manifest,
    size: result.bytes.byteLength,
    sha256: result.hash,
  }
}

export async function packPluginV1(sourceDirectory, outputFile, hostVersion) {
  const packed = await packPlugin(sourceDirectory, outputFile, hostVersion)
  let bytes
  try { bytes = await readFile(packed.output) }
  catch { failValidation('OUTPUT_IO', 'package.wtplugin') }
  const checked = await validatePluginArchiveV1(bytes, hostVersion)
  return {
    valid: checked.valid,
    manifest: checked.manifest,
    size: checked.size,
    sha256: checked.sha256,
  }
}
