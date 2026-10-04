import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePackage } from './package-validator.ts'
import { LIMITS } from './manifest.ts'
import { manifest, zip, png, packageBytes, zip64 } from './fixtures.mjs'
const validate = bytes => validatePackage(bytes, '0.1.0')
test('validates minimal archive and declared bounded PNG and directory entries', async () => {
  const value = manifest({ entry: { pageId: 'home', label: 'Demo', icon: 'assets/icon.png' }, assets: [{ path: 'assets/icon.png', type: 'image/png' }] })
  const result = await validate(packageBytes(value, [{ name: 'assets/', attrs: 0x41ed0010 }, { name: 'assets/icon.png', data: png(), deflate: true }]))
  assert.match(result.hash, /^[a-f0-9]{64}$/); assert.equal(result.assets.get('assets/icon.png').length, png().length)
})
test('rejects missing/duplicate/case-colliding manifests and undeclared content', async () => {
  for (const bytes of [zip([]), zip([{ name: 'other.json', data: '{}' }]), packageBytes(manifest(), [{ name: 'manifest.json', data: '{}' }]), packageBytes(manifest(), [{ name: 'MANIFEST.json', data: '{}' }]), packageBytes(manifest(), [{ name: 'run.js', data: 'alert(1)' }])]) await assert.rejects(() => validate(bytes))
})
test('rejects traversal, absolute, drive/ADS, UNC, reserved/control/trailing names', async () => {
  for (const name of ['../x.png', '/x.png', 'C:/x.png', '//host/x', 'assets/x.png:ads', 'assets/NUL.png', 'assets/COM1.png', 'assets/x. ', 'assets/a\u0000.png', 'assets\\x.png', 'assets/./x.png']) await assert.rejects(() => validate(packageBytes(manifest(), [{ name, data: '' }])))
})
test('rejects symlink, special files, reparse attributes, encryption and corruption', async () => {
  for (const attrs of [0xa1ff0000, 0x21b60000, 0x81a40400]) await assert.rejects(() => validate(zip([{ name: 'manifest.json', data: JSON.stringify(manifest()), attrs }])))
  await assert.rejects(() => validate(zip([{ name: 'manifest.json', data: JSON.stringify(manifest()), flags: 1 }])))
  await assert.rejects(() => validate(zip([{ name: 'manifest.json', data: JSON.stringify(manifest()), crc: 0 }])))
  await assert.rejects(() => validate(Buffer.from('not a ZIP')))
  await assert.rejects(() => validate(packageBytes().subarray(0, 20)))
})
test('enforces archive/entry/manifest/expansion/ratio budgets before writes', async () => {
  await assert.rejects(() => validate(Buffer.alloc(LIMITS.archive + 1)))
  await assert.rejects(() => validate(zip(Array.from({ length: 257 }, (_, i) => ({ name: `assets/${i}.png`, data: '' })))))
  await assert.rejects(() => validate(zip([{ name: 'manifest.json', data: 'x'.repeat(LIMITS.manifest + 1) }])))
  await assert.rejects(() => validate(zip([{ name: 'manifest.json', data: 'x'.repeat(64000), deflate: true }])))
  await assert.rejects(() => validate(zip([{ name: 'manifest.json', data: '{}', deflate: true, size: LIMITS.expanded + 1 }])))
})
test('rejects invalid/oversized PNG, missing assets, damaged IDAT and decode failures', async () => {
  const value = manifest({ assets: [{ path: 'assets/icon.png', type: 'image/png' }] })
  for (const data of [Buffer.from('fake PNG'), png(257, 1), Buffer.alloc(LIMITS.png + 1), Buffer.from(png()).fill(1, 40, 50)]) await assert.rejects(() => validate(packageBytes(value, [{ name: 'assets/icon.png', data }])))
  await assert.rejects(() => validate(packageBytes(value)))
  await assert.rejects(() => validatePackage(packageBytes(value, [{ name: 'assets/icon.png', data: png() }]), '0.1.0', () => false))
})
test('bounded ZIP64 is supported and malformed ZIP64 fails closed', async () => {
  assert.equal((await validate(zip64(packageBytes()))).manifest.id, 'org.example.demo')
  const damaged = zip64(packageBytes()); damaged.writeBigUInt64LE(9007199254740992n, damaged.length - 42 + 8)
  await assert.rejects(() => validate(damaged))
})
test('rejects file-directory prefix aliases and case collisions between declared PNGs', async () => {
  for (const paths of [['assets/A.png', 'assets/a.png'], ['assets/x.png', 'assets/x.png/y.png']]) {
    const value = manifest({ assets: paths.map(path => ({ path, type: 'image/png' })) })
    await assert.rejects(() => validate(packageBytes(value, paths.map(name => ({ name, data: png() })))))
  }
})

test('rejects Unicode NFC-equivalent declared asset paths', async () => {
  const paths = ['assets/café.png', 'assets/cafe\u0301.png']
  const value = manifest({ assets: paths.map(path => ({ path, type: 'image/png' })) })
  const bytes = zip([{ name: 'manifest.json', data: JSON.stringify(value), flags: 0x800 }, ...paths.map(name => ({ name, data: png(), flags: 0x800 }))])
  await assert.rejects(() => validate(bytes), error => error.code === 'INVALID_PACKAGE')
})
