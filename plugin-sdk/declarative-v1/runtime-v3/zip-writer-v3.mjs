import { deflateRawSync } from 'node:zlib'
import { crc32V1 } from '../runtime/manifest-v1.mjs'
import { LIMITS_V3, ManifestV3ValidationError } from './manifest-v3.mjs'

function u16(value) { const bytes = Buffer.alloc(2); bytes.writeUInt16LE(value); return bytes }
function u32(value) { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value >>> 0); return bytes }
function reject(code) { throw new ManifestV3ValidationError(code) }

export function createDeterministicZipV3(entries) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > LIMITS_V3.entries) reject('PACKAGE_LIMIT_EXCEEDED')
  const ordered = [...entries].sort((a, b) => Buffer.compare(Buffer.from(a.name.normalize('NFC').toLowerCase()), Buffer.from(b.name.normalize('NFC').toLowerCase())))
  const names = new Set(); const folded = new Set(); const localParts = []; const centralParts = []
  let expanded = 0; let offset = 0
  for (const entry of ordered) {
    if (typeof entry.name !== 'string' || !entry.name || entry.name.startsWith('/') || entry.name.includes('\\') || entry.name.includes('\u0000')) reject('INVALID_PATH')
    const foldedName = entry.name.normalize('NFC').toLowerCase()
    if (names.has(entry.name) || folded.has(foldedName)) reject('INVALID_PATH')
    names.add(entry.name); folded.add(foldedName)
    const name = Buffer.from(entry.name, 'utf8'); const data = Buffer.from(entry.data)
    if (name.length > 1024 || data.length > LIMITS_V3.expanded || expanded + data.length > LIMITS_V3.expanded) reject('PACKAGE_LIMIT_EXCEEDED')
    expanded += data.length
    const deflated = deflateRawSync(data, { level: 9 })
    const method = deflated.length < data.length ? 8 : 0
    const compressed = method === 8 ? deflated : data
    if (compressed.length > 0xffffffff || data.length > 0xffffffff || offset > 0xffffffff) reject('PACKAGE_LIMIT_EXCEEDED')
    const crc = crc32V1(data); const flags = 0x0800
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(flags), u16(method), u16(0), u16(33),
      u32(crc), u32(compressed.length), u32(data.length), u16(name.length), u16(0), name, compressed,
    ])
    const central = Buffer.concat([
      u32(0x02014b50), u16(0x0314), u16(20), u16(flags), u16(method), u16(0), u16(33),
      u32(crc), u32(compressed.length), u32(data.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0x81a40000), u32(offset), name,
    ])
    localParts.push(local); centralParts.push(central); offset += local.length
  }
  const central = Buffer.concat(centralParts)
  const archive = Buffer.concat([...localParts, central, u32(0x06054b50), u16(0), u16(0), u16(ordered.length), u16(ordered.length), u32(central.length), u32(offset), u16(0)])
  if (archive.length > LIMITS_V3.archive) reject('PACKAGE_LIMIT_EXCEEDED')
  return archive
}
