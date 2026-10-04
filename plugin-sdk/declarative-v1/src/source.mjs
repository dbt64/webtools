import { lstat, open, realpath } from 'node:fs/promises'
import path from 'node:path'
import { parseManifestV1, validateArchivePathV1, LIMITS_V1, failValidation } from '../runtime/manifest-v1.mjs'
import { validatePngV1 } from '../runtime/png-v1.mjs'

function inside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function sameIdentity(a, b) { return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs }

async function safeRead(root, relative, maxBytes) {
  validateArchivePathV1(relative)
  const parts = relative.split('/')
  let cursor = root
  let previous = await lstat(root)
  if (previous.isSymbolicLink() || !previous.isDirectory()) failValidation('SOURCE_IO', relative)
  for (let index = 0; index < parts.length; index++) {
    cursor = path.join(cursor, parts[index])
    let current
    try { current = await lstat(cursor) } catch { failValidation('SOURCE_IO', relative) }
    if (current.isSymbolicLink() || (index < parts.length - 1 ? !current.isDirectory() : !current.isFile())) failValidation('SOURCE_IO', relative)
    previous = current
  }
  let resolved
  try { resolved = await realpath(cursor) } catch { failValidation('SOURCE_IO', relative) }
  if (!inside(root, resolved) || !previous.isFile() || previous.size > maxBytes) failValidation('SOURCE_IO', relative)
  let handle
  try { handle = await open(cursor, 'r') } catch { failValidation('SOURCE_IO', relative) }
  try {
    const opened = await handle.stat()
    const currentPath = await realpath(cursor)
    if (!opened.isFile() || !sameIdentity(previous, opened) || !inside(root, currentPath) || currentPath !== resolved) failValidation('SOURCE_IO', relative)
    const bytes = await handle.readFile()
    const after = await handle.stat()
    if (!sameIdentity(opened, after) || bytes.length > maxBytes) failValidation('SOURCE_IO', relative)
    return bytes
  } finally { await handle.close() }
}

export async function readPluginSource(sourceDirectory, hostVersion) {
  const requested = path.resolve(sourceDirectory)
  let requestedStat
  try { requestedStat = await lstat(requested) } catch { failValidation('SOURCE_IO', 'manifest.json') }
  if (requestedStat.isSymbolicLink() || !requestedStat.isDirectory()) failValidation('SOURCE_IO', 'manifest.json')
  let root
  try { root = await realpath(requested) } catch { failValidation('SOURCE_IO', 'manifest.json') }
  const manifestBytes = await safeRead(root, 'manifest.json', LIMITS_V1.manifest)
  const manifest = parseManifestV1(manifestBytes, hostVersion)
  if (manifest.assets.length + 1 > LIMITS_V1.entries) failValidation('INVALID_PACKAGE', 'manifest.json')
  let expanded = manifestBytes.length
  const assets = new Map()
  for (const asset of manifest.assets) {
    const bytes = await safeRead(root, asset.path, LIMITS_V1.png)
    expanded += bytes.length
    if (expanded > LIMITS_V1.expanded) failValidation('INVALID_PACKAGE', asset.path)
    validatePngV1(bytes)
    assets.set(asset.path, bytes)
  }
  return { root, manifest, manifestBytes, assets }
}
