import { deflateRawSync } from 'node:zlib'
import { crc32V1, LIMITS_V1, validateArchivePathV1, failValidation } from '../runtime/manifest-v1.mjs'

function u16(value) { const bytes = Buffer.alloc(2); bytes.writeUInt16LE(value); return bytes }
function u32(value) { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value >>> 0); return bytes }

export function createDeterministicZip(entries) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > LIMITS_V1.entries) failValidation('INVALID_PACKAGE', 'manifest.json')
  const ordered = [...entries].sort((a, b) => Buffer.compare(Buffer.from(a.name.normalize('NFC').toLowerCase()), Buffer.from(b.name.normalize('NFC').toLowerCase())))
  const identities = new Set()
  let expanded = 0
  let offset = 0
  const localParts = []
  const centralParts = []
  for (const entry of ordered) {
    validateArchivePathV1(entry.name)
    const identity = entry.name.normalize('NFC').toLowerCase()
    if (identities.has(identity)) failValidation('INVALID_PACKAGE', entry.name)
    identities.add(identity)
    const name = Buffer.from(entry.name, 'utf8')
    const data = Buffer.from(entry.data)
    const cap = entry.name === 'manifest.json' ? LIMITS_V1.manifest : LIMITS_V1.png
    if (!name.length || name.length > 240 || data.length > cap || expanded + data.length > LIMITS_V1.expanded) failValidation('INVALID_PACKAGE', entry.name)
    expanded += data.length
    const deflated = deflateRawSync(data, { level: 9 })
    const method = deflated.length < data.length ? 8 : 0
    const compressed = method === 8 ? deflated : data
    const crc = crc32V1(data)
    const flags = 0x0800
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(flags), u16(method), u16(0), u16(33),
      u32(crc), u32(compressed.length), u32(data.length), u16(name.length), u16(0), name, compressed,
    ])
    const central = Buffer.concat([
      u32(0x02014b50), u16(0x0314), u16(20), u16(flags), u16(method), u16(0), u16(33),
      u32(crc), u32(compressed.length), u32(data.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0x81a40000), u32(offset), name,
    ])
    localParts.push(local)
    centralParts.push(central)
    offset += local.length
  }
  const centralDirectory = Buffer.concat(centralParts)
  if (centralDirectory.length > 0xffffffff || offset > 0xffffffff) failValidation('INVALID_PACKAGE', 'package.wtplugin')
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(ordered.length), u16(ordered.length),
    u32(centralDirectory.length), u32(offset), u16(0),
  ])
  const archive = Buffer.concat([...localParts, centralDirectory, end])
  if (!archive.length || archive.length > LIMITS_V1.archive) failValidation('INVALID_PACKAGE', 'package.wtplugin')
  return archive
}
