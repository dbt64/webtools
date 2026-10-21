import { createHash } from 'node:crypto'
import yauzl from 'yauzl'
import { crc32V1, parseStrictJsonV1 } from './manifest-v1.mjs'
import { ManifestV2ValidationError, LIMITS_V2, parseManifestV2 } from './manifest-v2.mjs'
import { validatePngV1 } from './png-v1.mjs'

const MANIFEST_NAME = 'manifest.json'
const DOS_EOCD_SIZE = 22
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50
const ZIP64_EXTRA_FIELD = 0x0001
const NATIVE_SIGNATURES = Object.freeze([
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]), // ELF
  Buffer.from([0xfe, 0xed, 0xfa, 0xce]), Buffer.from([0xce, 0xfa, 0xed, 0xfe]), // Mach-O 32-bit
  Buffer.from([0xfe, 0xed, 0xfa, 0xcf]), Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), // Mach-O 64-bit
  Buffer.from([0xca, 0xfe, 0xba, 0xbe]), Buffer.from([0xbe, 0xba, 0xfe, 0xca]), // universal Mach-O
  Buffer.from([0xca, 0xfe, 0xba, 0xbf]), Buffer.from([0xbf, 0xba, 0xfe, 0xca]), // universal Mach-O 64-bit
])

function reject(code) { throw new ManifestV2ValidationError(code) }

function snapshot(source) {
  if (!(source instanceof Uint8Array) || source.byteLength === 0) reject('UNSAFE_ARCHIVE')
  if (source.byteLength > LIMITS_V2.archive) reject('PACKAGE_LIMIT_EXCEEDED')
  return Buffer.from(source)
}

function checkEndRecord(bytes) {
  if (bytes.length < DOS_EOCD_SIZE) reject('UNSAFE_ARCHIVE')
  const offset = bytes.length - DOS_EOCD_SIZE
  if (bytes.readUInt32LE(offset) !== 0x06054b50 || bytes.readUInt16LE(offset + 20) !== 0) reject('UNSAFE_ARCHIVE')
  if (offset >= 20 && bytes.readUInt32LE(offset - 20) === ZIP64_LOCATOR_SIGNATURE) reject('UNSAFE_ARCHIVE')
  const disk = bytes.readUInt16LE(offset + 4)
  const centralDisk = bytes.readUInt16LE(offset + 6)
  const diskCount = bytes.readUInt16LE(offset + 8)
  const count = bytes.readUInt16LE(offset + 10)
  const centralSize = bytes.readUInt32LE(offset + 12)
  const centralOffset = bytes.readUInt32LE(offset + 16)
  if (disk !== 0 || centralDisk !== 0 || diskCount !== count || count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff || centralOffset + centralSize !== offset) reject('UNSAFE_ARCHIVE')
  if (count > LIMITS_V2.entries) reject('PACKAGE_LIMIT_EXCEEDED')
}

async function openZip(bytes, strictEndRecord) {
  if (strictEndRecord) checkEndRecord(bytes)
  try {
    return await yauzl.fromBufferPromise(bytes, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true })
  } catch {
    reject('UNSAFE_ARCHIVE')
  }
}

function checkEntryName(entry) {
  const utf8 = Boolean(entry.generalPurposeBitFlag & 0x800)
  let name
  try {
    if (utf8) name = new TextDecoder('utf-8', { fatal: true }).decode(entry.fileNameRaw)
    else {
      if (entry.fileNameRaw.some(byte => byte > 0x7f)) reject('UNSAFE_ARCHIVE')
      name = entry.fileNameRaw.toString('ascii')
    }
  } catch (error) {
    if (error instanceof ManifestV2ValidationError) throw error
    reject('UNSAFE_ARCHIVE')
  }
  if (!name || name !== entry.fileName || name.endsWith('/') || name !== name.normalize('NFC')) reject('INVALID_PATH')
  return name
}

function checkEntryMetadata(entry, name) {
  // Data descriptors are deliberately unsupported: the v2 archive profile
  // requires local-header sizes and CRC to agree with the central directory.
  const allowedFlags = 0x800 | (entry.compressionMethod === 8 ? 0x6 : 0)
  if ((entry.generalPurposeBitFlag & ~allowedFlags) !== 0 || entry.isEncrypted() || ![0, 8].includes(entry.compressionMethod)) reject('UNSAFE_ARCHIVE')
  if (entry.versionNeededToExtract > 20 || entry.extraFields.length || entry.fileComment) reject('UNSAFE_ARCHIVE')
  const mode = (entry.externalFileAttributes >>> 16) & 0xf000
  if ((mode !== 0 && mode !== 0x8000) || (entry.externalFileAttributes & 0x400) || (entry.externalFileAttributes & 0x58)) reject('UNSAFE_ARCHIVE')
  if (!Number.isSafeInteger(entry.uncompressedSize) || !Number.isSafeInteger(entry.compressedSize) || entry.uncompressedSize < 0 || entry.compressedSize < 0) reject('UNSAFE_ARCHIVE')
  if (entry.uncompressedSize > Math.max(1, entry.compressedSize) * LIMITS_V2.ratio) reject('PACKAGE_LIMIT_EXCEEDED')
  for (const field of entry.extraFields) if (field.id === ZIP64_EXTRA_FIELD) reject('UNSAFE_ARCHIVE')
  return name
}

async function readEntry(zip, entry, maximum, strict = true) {
  let header
  try { header = await zip.readLocalFileHeaderPromise(entry) } catch { reject('UNSAFE_ARCHIVE') }
  if (!header.fileName.equals(entry.fileNameRaw) || header.compressionMethod !== entry.compressionMethod || header.generalPurposeBitFlag !== entry.generalPurposeBitFlag || (strict && (header.versionNeededToExtract !== entry.versionNeededToExtract || header.crc32 !== entry.crc32 || header.compressedSize !== entry.compressedSize || header.uncompressedSize !== entry.uncompressedSize || header.extraField.length !== 0))) reject('UNSAFE_ARCHIVE')
  let stream
  try { stream = await zip.openReadStreamPromise(entry) } catch { reject('UNSAFE_ARCHIVE') }
  const chunks = []
  let length = 0
  let crc = 0
  try {
    for await (const value of stream) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      length += chunk.length
      if (length > maximum) { stream.destroy(); reject('PACKAGE_LIMIT_EXCEEDED') }
      chunks.push(chunk)
      crc = crc32V1(chunk, crc)
    }
  } catch (error) {
    if (error instanceof ManifestV2ValidationError) throw error
    reject('UNSAFE_ARCHIVE')
  }
  if (length !== entry.uncompressedSize || crc !== entry.crc32) reject('UNSAFE_ARCHIVE')
  if (length > Math.max(1, entry.compressedSize) * LIMITS_V2.ratio) reject('PACKAGE_LIMIT_EXCEEDED')
  return Buffer.concat(chunks, length)
}

async function readManifest(source, strict = true) {
  const bytes = snapshot(source)
  const zip = await openZip(bytes, strict)
  try {
    if (!Number.isSafeInteger(zip.entryCount) || zip.entryCount < 1 || zip.entryCount > LIMITS_V2.entries) reject(zip.entryCount > LIMITS_V2.entries ? 'PACKAGE_LIMIT_EXCEEDED' : 'UNSAFE_ARCHIVE')
    if (strict && zip.comment) reject('UNSAFE_ARCHIVE')
    let found
    let count = 0
    for await (const entry of zip.eachEntry()) {
      count++
      if (entry.fileName === MANIFEST_NAME) {
        if (found || entry.uncompressedSize > LIMITS_V2.manifest) reject(found ? 'UNSAFE_ARCHIVE' : 'PACKAGE_LIMIT_EXCEEDED')
        if (strict) {
          checkEntryName(entry)
          if (entry.isEncrypted() || ![0, 8].includes(entry.compressionMethod) || entry.extraFields.some(field => field.id === ZIP64_EXTRA_FIELD)) reject('UNSAFE_ARCHIVE')
        }
        found = await readEntry(zip, entry, LIMITS_V2.manifest, strict)
      }
    }
    if (count !== zip.entryCount || !found) reject('UNSAFE_ARCHIVE')
    let parsed
    try { parsed = parseStrictJsonV1(new TextDecoder('utf-8', { fatal: true }).decode(found), LIMITS_V2.depth) } catch { reject('INVALID_MANIFEST') }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Number.isInteger(parsed.manifestVersion)) reject('INVALID_MANIFEST')
    if (parsed.manifestVersion !== 1 && parsed.manifestVersion !== 2) reject('UNSUPPORTED_MANIFEST_VERSION')
    return { version: parsed.manifestVersion, bytes: found, archive: bytes }
  } catch (error) {
    if (error instanceof ManifestV2ValidationError) throw error
    reject('UNSAFE_ARCHIVE')
  } finally {
    zip.close()
  }
}

function fileLimit(path, manifest, iconPaths) {
  if (path === MANIFEST_NAME) return LIMITS_V2.manifest
  if (manifest.assets.some(asset => asset.path === path)) {
    const asset = manifest.assets.find(value => value.path === path)
    if (iconPaths.has(path)) return LIMITS_V2.icon
    return asset.mediaType === 'font/woff2' ? LIMITS_V2.font : LIMITS_V2.image
  }
  const item = manifest.webBundle.files.find(value => value.path === path)
  if (!item) reject('INVENTORY_MISMATCH')
  return item.mediaType === 'text/html' ? LIMITS_V2.html : LIMITS_V2.bundleFile
}

function startsWithObviousHtmlDocument(data) {
  let prefix = data.toString('latin1', 0, Math.min(data.length, 512))
  if (prefix.startsWith('\u00ef\u00bb\u00bf')) prefix = prefix.slice(3)
  prefix = prefix.replace(/^[\t\n\r ]+/, '').toLowerCase()
  return /^(?:<!doctype\s+html\b|<html(?=[\s/>])|<script(?=[\s/>])|<head(?=[\s/>])|<body(?=[\s/>]))/.test(prefix)
}

function validateMagic(path, data, manifest, iconPaths) {
  const item = [...manifest.webBundle.files, ...manifest.assets].find(value => value.path === path)
  if (!item) return
  if (item.mediaType !== 'text/html' && startsWithObviousHtmlDocument(data)) reject('UNSUPPORTED_FILE_TYPE')
  if (data.length >= 2 && data[0] === 0x4d && data[1] === 0x5a) reject('UNSUPPORTED_FILE_TYPE')
  if (NATIVE_SIGNATURES.some(signature => data.length >= signature.length && data.subarray(0, signature.length).equals(signature))) reject('UNSUPPORTED_FILE_TYPE')
  if (item.mediaType === 'application/wasm' && (data.length < 8 || !data.subarray(0, 8).equals(Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])))) reject('UNSUPPORTED_FILE_TYPE')
  if (item.mediaType === 'image/png') {
    if (data.length < 8 || !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) reject('UNSUPPORTED_FILE_TYPE')
    if (iconPaths.has(path)) {
      try { validatePngV1(data) } catch { reject('UNSUPPORTED_FILE_TYPE') }
    }
  }
  if (item.mediaType === 'image/jpeg' && (data.length < 3 || data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff)) reject('UNSUPPORTED_FILE_TYPE')
  if (item.mediaType === 'image/webp' && (data.length < 12 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WEBP')) reject('UNSUPPORTED_FILE_TYPE')
  if (item.mediaType === 'font/woff2' && (data.length < 4 || data.toString('ascii', 0, 4) !== 'wOF2')) reject('UNSUPPORTED_FILE_TYPE')
}

async function validateArchive(bytes, manifest, iconPaths, collectResources = false) {
  const zip = await openZip(bytes, true)
  try {
    if (zip.comment || !Number.isSafeInteger(zip.entryCount) || zip.entryCount > LIMITS_V2.entries) reject(zip.entryCount > LIMITS_V2.entries ? 'PACKAGE_LIMIT_EXCEEDED' : 'UNSAFE_ARCHIVE')
    const declared = new Set([MANIFEST_NAME, ...manifest.webBundle.files.map(item => item.path), ...manifest.assets.map(item => item.path)])
    const seenNames = new Set()
    const seenFolded = new Set()
    let count = 0
    let expanded = 0
    const resources = []
    for await (const entry of zip.eachEntry()) {
      count++
      const name = checkEntryMetadata(entry, checkEntryName(entry))
      const folded = name.normalize('NFC').toLowerCase()
      if (seenNames.has(name) || seenFolded.has(folded)) reject('INVALID_PATH')
      seenNames.add(name); seenFolded.add(folded)
      if (!declared.has(name)) reject('INVENTORY_MISMATCH')
      const cap = fileLimit(name, manifest, iconPaths)
      if (entry.uncompressedSize > cap) reject('PACKAGE_LIMIT_EXCEEDED')
      if (expanded + entry.uncompressedSize > LIMITS_V2.expanded) reject('PACKAGE_LIMIT_EXCEEDED')
      const content = await readEntry(zip, entry, cap)
      expanded += content.length
      if (expanded > LIMITS_V2.expanded) reject('PACKAGE_LIMIT_EXCEEDED')
      validateMagic(name, content, manifest, iconPaths)
      if (collectResources && name !== MANIFEST_NAME) {
        const item = [...manifest.webBundle.files, ...manifest.assets].find(value => value.path === name)
        if (!item) reject('INVENTORY_MISMATCH')
        resources.push({ canonicalPath: name, mimeType: item.mediaType, size: content.length, bytes: content })
      }
    }
    if (count !== zip.entryCount || seenNames.size !== declared.size || [...declared].some(name => !seenNames.has(name))) reject('INVENTORY_MISMATCH')
    for (const path of seenNames) {
      const parts = path.split('/')
      for (let index = 1; index < parts.length; index++) if (seenNames.has(parts.slice(0, index).join('/'))) reject('INVALID_PATH')
    }
    return collectResources ? { expandedSize: expanded, resources } : undefined
  } catch (error) {
    if (error instanceof ManifestV2ValidationError) throw error
    reject('UNSAFE_ARCHIVE')
  } finally {
    zip.close()
  }
}

export async function readManifestVersion(source) {
  return (await readManifest(source, false)).version
}

async function validatePackageV2Core(source, hostVersion, reservedFeatureIdentities, collectResources) {
  const parsedArchive = await readManifest(source, true)
  if (parsedArchive.version !== 2) reject('UNSUPPORTED_MANIFEST_VERSION')
  const normalized = parseManifestV2(parsedArchive.bytes, hostVersion, reservedFeatureIdentities)
  const iconPaths = new Set(normalized.manifest.features.filter(feature => feature.icon?.kind === 'asset').map(feature => feature.icon.path))
  const archiveResult = await validateArchive(parsedArchive.archive, normalized.manifest, iconPaths, collectResources)
  const result = {
    manifest: normalized.manifest,
    hash: createHash('sha256').update(parsedArchive.archive).digest('hex'),
    size: parsedArchive.archive.byteLength,
    runtimeSupport: 'not-implemented',
    networkRuntimeSupport: normalized.networkRuntimeSupport,
  }
  return collectResources
    ? Object.freeze({ ...result, expandedSize: archiveResult.expandedSize, resources: Object.freeze(archiveResult.resources.map(resource => Object.freeze(resource))) })
    : Object.freeze(result)
}

export async function validatePackageV2(source, hostVersion, reservedFeatureIdentities = ['webtools.translation\0translate-text']) {
  return validatePackageV2Core(source, hostVersion, reservedFeatureIdentities, false)
}

/** Host-internal result. Not re-exported from the public SDK package entry. */
export async function validatePackageV2ForRuntime(source, hostVersion, reservedFeatureIdentities = ['webtools.translation\0translate-text']) {
  return validatePackageV2Core(source, hostVersion, reservedFeatureIdentities, true)
}
