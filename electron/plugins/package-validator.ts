import { createHash } from 'node:crypto'
import { crc32 } from 'node:zlib'
import yauzl from 'yauzl'
import { LIMITS, parseManifest, validateArchivePath, type ValidatedManifest } from './manifest.ts'
import { PluginError, fail } from './errors.ts'
import { validatePng } from './png.ts'

export interface ValidatedPackage { manifest: ValidatedManifest; hash: string; bytes: Buffer; assets: Map<string, Buffer> }
export async function validatePackage(source: Uint8Array, hostVersion: string, pngDecoder?: (bytes: Buffer) => boolean): Promise<ValidatedPackage> {
  if (!source.byteLength || source.byteLength > LIMITS.archive) fail('INVALID_PACKAGE')
  // Snapshot ties digest and validation to the exact bytes later committed to disk.
  const bytes = Buffer.from(source)
  let zip: yauzl.ZipFile | undefined
  try {
    zip = await new Promise<yauzl.ZipFile>((resolve, reject) => yauzl.fromBuffer(bytes, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, file) => error ? reject(error) : resolve(file)))
    if (!Number.isSafeInteger(zip.entryCount) || zip.entryCount > LIMITS.entries) fail('INVALID_PACKAGE')
    const files = new Map<string, Buffer>(); const names = new Set<string>(); const directories: string[] = []
    let count = 0; let expanded = 0
    for await (const entry of zip.eachEntry()) {
      if (++count > LIMITS.entries) fail('INVALID_PACKAGE')
      const name = entry.fileName; validateArchivePath(name)
      const identity = name.replace(/\/$/, '').toLowerCase()
      if (names.has(identity)) fail('INVALID_PACKAGE'); names.add(identity)
      const mode = (entry.externalFileAttributes >>> 16) & 0xf000
      const directory = name.endsWith('/')
      if ((mode !== 0 && mode !== (directory ? 0x4000 : 0x8000)) || (entry.externalFileAttributes & 0x400) || Boolean(entry.externalFileAttributes & 0x10) !== directory && (entry.externalFileAttributes & 0x10) !== 0) fail('INVALID_PACKAGE')
      if (entry.isEncrypted() || ![0, 8].includes(entry.compressionMethod)) fail('INVALID_PACKAGE')
      const cap = name === 'manifest.json' ? LIMITS.manifest : LIMITS.png
      if (!Number.isSafeInteger(entry.uncompressedSize) || !Number.isSafeInteger(entry.compressedSize) || entry.uncompressedSize < 0 || entry.compressedSize < 0 || entry.uncompressedSize > cap || entry.uncompressedSize > Math.max(1, entry.compressedSize) * LIMITS.ratio || expanded + entry.uncompressedSize > LIMITS.expanded) fail('INVALID_PACKAGE')
      if (directory) { if (entry.uncompressedSize !== 0 || !name.startsWith('assets/')) fail('INVALID_PACKAGE'); directories.push(name); continue }
      if (name !== 'manifest.json' && !name.startsWith('assets/')) fail('INVALID_PACKAGE')
      const header = await zip.readLocalFileHeaderPromise(entry)
      if (!header.fileName.equals(entry.fileNameRaw) || header.compressionMethod !== entry.compressionMethod || header.generalPurposeBitFlag !== entry.generalPurposeBitFlag) fail('INVALID_PACKAGE')
      const stream = await zip.openReadStreamPromise(entry)
      const chunks: Buffer[] = []; let size = 0; let crc = 0
      for await (const chunk of stream) {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += data.length; expanded += data.length
        if (size > cap || expanded > LIMITS.expanded || size > Math.max(1, entry.compressedSize) * LIMITS.ratio) { stream.destroy(); fail('INVALID_PACKAGE') }
        crc = crc32(data, crc); chunks.push(data)
      }
      if (size !== entry.uncompressedSize || crc !== entry.crc32) fail('INVALID_PACKAGE')
      files.set(name, Buffer.concat(chunks))
    }
    const rawManifest = files.get('manifest.json'); if (!rawManifest) fail('INVALID_PACKAGE')
    const fileNames = new Set([...files.keys()].map(name => name.toLowerCase()))
    for (const name of names) {
      const parts = name.split('/')
      for (let i = 1; i < parts.length; i++) if (fileNames.has(parts.slice(0, i).join('/'))) fail('INVALID_PACKAGE')
    }
    const manifest = parseManifest(rawManifest, hostVersion)
    const declared = new Set(manifest.assets.map(asset => asset.path))
    if (files.size !== declared.size + 1 || directories.some(dir => ![...declared].some(name => name.startsWith(dir)))) fail('INVALID_PACKAGE')
    const assets = new Map<string, Buffer>()
    for (const name of declared) {
      const image = files.get(name); if (!image) fail('INVALID_PACKAGE')
      validatePng(image); if (pngDecoder && !pngDecoder(image)) fail('INVALID_PACKAGE'); assets.set(name, image)
    }
    return { manifest, bytes, assets, hash: createHash('sha256').update(bytes).digest('hex') }
  } catch (error) {
    if (error instanceof PluginError) throw error
    return fail('INVALID_PACKAGE')
  } finally { zip?.close() }
}
