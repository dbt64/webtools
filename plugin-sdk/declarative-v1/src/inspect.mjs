import { open } from 'node:fs/promises'
import path from 'node:path'
import { LIMITS_V1, PluginValidationError, validatePluginArchiveV1 } from '../index.mjs'

function invalidPackage() { throw new PluginValidationError('INVALID_PACKAGE', 'package.wtplugin') }
function sourceIo() { throw new PluginValidationError('SOURCE_IO', 'package.wtplugin') }

async function readBoundedArchive(filePath) {
  if (typeof filePath !== 'string' || !filePath || path.extname(filePath).toLowerCase() !== '.wtplugin') invalidPackage()

  let handle
  try { handle = await open(filePath, 'r') }
  catch { sourceIo() }

  try {
    const info = await handle.stat()
    if (!info.isFile() || !Number.isSafeInteger(info.size) || info.size <= 0 || info.size > LIMITS_V1.archive) invalidPackage()

    const bytes = Buffer.alloc(info.size)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) invalidPackage()
      offset += bytesRead
    }

    const extra = Buffer.alloc(1)
    const { bytesRead } = await handle.read(extra, 0, 1, offset)
    if (bytesRead) invalidPackage()
    return bytes
  } finally {
    await handle.close()
  }
}

function pluginDetails(manifest) {
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    author: manifest.author,
    version: manifest.version,
    manifestVersion: manifest.manifestVersion,
    apiMajor: manifest.api.apiMajor,
    minHostVersion: manifest.api.minHostVersion,
    capabilities: manifest.requestedCapabilities,
  }
}

export async function inspectPluginArchiveFile(filePath, hostVersion) {
  const bytes = await readBoundedArchive(filePath)
  const checked = await validatePluginArchiveV1(bytes, hostVersion)
  return {
    valid: checked.valid,
    plugin: pluginDetails(checked.manifest),
    size: checked.size,
    sha256: checked.sha256,
  }
}

export function safeDisplayText(value, limit = 240) {
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit)
}
