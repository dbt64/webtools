import { crc32, deflateSync, deflateRawSync } from 'node:zlib'
export function manifest(overrides = {}) {
  return { manifestVersion: 1, id: 'org.example.demo', name: 'Demo', description: 'Plain text', author: { name: 'Example' }, version: '1.0.0', api: { apiMajor: 1, minHostVersion: '0.1.0' }, type: 'declarative-manager', entry: { pageId: 'home', label: 'Demo' }, requestedCapabilities: ['manager.page'], settings: [], pages: [{ id: 'home', title: 'Home', blocks: [{ type: 'paragraph', text: 'Hello' }] }], actions: [], assets: [], ...overrides }
}
/** Test-only ZIP construction enables malicious central-directory metadata cases. Never used by product code. */
export function zip(entries) {
  const local = []; const central = []; let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name); const data = Buffer.from(entry.data ?? ''); const compressed = entry.deflate ? deflateRawSync(data) : data
    const crc = entry.crc ?? crc32(data); const size = entry.size ?? data.length; const flags = entry.flags ?? 0
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50); l.writeUInt16LE(20, 4); l.writeUInt16LE(flags, 6); l.writeUInt16LE(entry.deflate ? 8 : 0, 8); l.writeUInt32LE(crc, 14); l.writeUInt32LE(compressed.length, 18); l.writeUInt32LE(size, 22); l.writeUInt16LE(name.length, 26)
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(0x314, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(flags, 8); c.writeUInt16LE(entry.deflate ? 8 : 0, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(compressed.length, 20); c.writeUInt32LE(size, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE((entry.attrs ?? 0x81a40000) >>> 0, 38); c.writeUInt32LE(offset, 42)
    local.push(l, name, compressed); central.push(c, name); offset += l.length + name.length + compressed.length
  }
  const directory = Buffer.concat(central); const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(directory.length, 12); e.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, directory, e])
}
function chunk(name, data) { const type = Buffer.from(name); const size = Buffer.alloc(4); size.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([type, data]))); return Buffer.concat([size, type, data, crc]) }
export function png(width = 1, height = 1) {
  const h = Buffer.alloc(13); h.writeUInt32BE(width); h.writeUInt32BE(height, 4); h[8] = 8; h[9] = 6
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', h), chunk('IDAT', deflateSync(Buffer.alloc(height * (1 + width * 4)))), chunk('IEND', Buffer.alloc(0))])
}
export function packageBytes(value = manifest(), entries = []) { return zip([{ name: 'manifest.json', data: JSON.stringify(value) }, ...entries]) }
export function zip64(bytes) {
  const end = bytes.subarray(bytes.length - 22); const prefix = bytes.subarray(0, bytes.length - 22)
  const record = Buffer.alloc(56); record.writeUInt32LE(0x06064b50); record.writeBigUInt64LE(44n, 4); record.writeUInt16LE(45, 12); record.writeUInt16LE(45, 14); record.writeBigUInt64LE(BigInt(end.readUInt16LE(8)), 24); record.writeBigUInt64LE(BigInt(end.readUInt16LE(10)), 32); record.writeBigUInt64LE(BigInt(end.readUInt32LE(12)), 40); record.writeBigUInt64LE(BigInt(end.readUInt32LE(16)), 48)
  const locator = Buffer.alloc(20); locator.writeUInt32LE(0x07064b50); locator.writeBigUInt64LE(BigInt(prefix.length), 8); locator.writeUInt32LE(1, 16)
  const sentinel = Buffer.from(end); sentinel.writeUInt16LE(0xffff, 8); sentinel.writeUInt16LE(0xffff, 10); sentinel.writeUInt32LE(0xffffffff, 12); sentinel.writeUInt32LE(0xffffffff, 16)
  return Buffer.concat([prefix, record, locator, sentinel])
}
