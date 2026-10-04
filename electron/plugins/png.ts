import { crc32, inflateSync } from 'node:zlib'
import { fail } from './errors.ts'
import { LIMITS } from './manifest.ts'

/** Validate the complete static PNG stream before the optional native decoder sees it. */
export function validatePng(bytes: Buffer): void {
  if (bytes.length > LIMITS.png || bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) fail('INVALID_PACKAGE')
  let at = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0
  let ihdr = false; let ended = false; let palette = false; let dataEnded = false; const idat: Buffer[] = []
  while (at < bytes.length) {
    if (at + 12 > bytes.length) fail('INVALID_PACKAGE')
    const length = bytes.readUInt32BE(at); const type = bytes.toString('ascii', at + 4, at + 8)
    if (length > LIMITS.png || at + length + 12 > bytes.length || !/^[A-Za-z]{4}$/.test(type)) fail('INVALID_PACKAGE')
    const chunk = bytes.subarray(at + 8, at + 8 + length)
    if (crc32(bytes.subarray(at + 4, at + 8 + length)) !== bytes.readUInt32BE(at + 8 + length)) fail('INVALID_PACKAGE')
    if (!ihdr && type !== 'IHDR') fail('INVALID_PACKAGE')
    if (idat.length && type !== 'IDAT') dataEnded = true
    if (type === 'IHDR') {
      if (ihdr || length !== 13) fail('INVALID_PACKAGE')
      ihdr = true; width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4); depth = chunk[8]; color = chunk[9]; interlace = chunk[12]
      const validDepths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }
      if (!width || !height || width > 256 || height > 256 || !validDepths[color]?.includes(depth) || chunk[10] !== 0 || chunk[11] !== 0 || interlace > 1) fail('INVALID_PACKAGE')
    } else if (type === 'PLTE') {
      if (palette || idat.length || !length || length % 3 || length > 768 || color === 0 || color === 4 || (color === 3 && length / 3 > 2 ** depth)) fail('INVALID_PACKAGE')
      palette = true
    } else if (type === 'IDAT') {
      if (dataEnded || (color === 3 && !palette)) fail('INVALID_PACKAGE')
      idat.push(chunk)
    } else if (type === 'IEND') {
      if (length || !idat.length || at + 12 !== bytes.length) fail('INVALID_PACKAGE')
      ended = true
    } else if (type === 'acTL' || type === 'fcTL' || type === 'fdAT' || type[0] === type[0].toUpperCase()) fail('INVALID_PACKAGE')
    at += length + 12
  }
  if (!ended) fail('INVALID_PACKAGE')
  const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
  const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]]
  const rows: Array<{ length: number; count: number }> = []
  for (const [x, y, dx, dy] of passes) {
    const w = Math.max(0, Math.ceil((width - x) / dx)); const h = Math.max(0, Math.ceil((height - y) / dy))
    if (w && h) rows.push({ length: 1 + Math.ceil(w * channels[color] * depth / 8), count: h })
  }
  const expected = rows.reduce((sum, row) => sum + row.length * row.count, 0)
  let pixels: Buffer
  try { pixels = inflateSync(Buffer.concat(idat), { maxOutputLength: expected + 1 }) } catch { fail('INVALID_PACKAGE') }
  if (pixels.length !== expected) fail('INVALID_PACKAGE')
  let offset = 0
  for (const row of rows) for (let i = 0; i < row.count; i++) { if (pixels[offset] > 4) fail('INVALID_PACKAGE'); offset += row.length }
}
