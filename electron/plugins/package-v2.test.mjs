import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { crc32, deflateRawSync } from 'node:zlib'
import { validateIncomingPackage, validatePackage, validatePackageV2 } from './package-validator.ts'
import { manifest, packageBytes, png, webManifest, webPackage, zip, zip64 } from './fixtures.mjs'

const validate = bytes => validatePackageV2(bytes, '0.1.0')
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const jpegSignature = Buffer.from([0xff, 0xd8, 0xff])
const webpSignature = Buffer.from('RIFF0000WEBP')
const woff2Signature = Buffer.from('wOF2')
const wasmHeader = Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])

function pngOfSize(size) {
  const source = png()
  const iend = source.length - 12
  const payload = Buffer.alloc(size - source.length - 12)
  const type = Buffer.from('tEXt')
  const length = Buffer.alloc(4); length.writeUInt32BE(payload.length)
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([type, payload])))
  return Buffer.concat([source.subarray(0, iend), length, type, payload, checksum, source.subarray(iend)])
}

function ratioBoundaryData(size, compressedTarget, seed) {
  let low = 0
  let high = seed.length
  while (low <= high) {
    const patch = (low + high) >> 1
    const data = Buffer.alloc(size)
    seed.copy(data, Math.floor((size - patch) / 2), 0, patch)
    const compressedSize = deflateRawSync(data).length
    if (compressedSize === compressedTarget) return data
    if (compressedSize < compressedTarget) low = patch + 1
    else high = patch - 1
  }
  throw new Error('Could not synthesize a deterministic compression-ratio boundary fixture.')
}

function mutateZipEntry(bytes, name, { localOffset, centralOffset, value, width = 4, centralValue } = {}) {
  const output = Buffer.from(bytes)
  let local = 0
  while (local + 30 <= output.length && output.readUInt32LE(local) === 0x04034b50) {
    const nameLength = output.readUInt16LE(local + 26)
    const extraLength = output.readUInt16LE(local + 28)
    const entryName = output.toString('utf8', local + 30, local + 30 + nameLength)
    if (entryName === name) {
      if (localOffset !== undefined) writeInteger(output, local + localOffset, width, value)
      break
    }
    local += 30 + nameLength + extraLength + output.readUInt32LE(local + 18)
  }
  if (localOffset !== undefined && (local + 30 > output.length || output.toString('utf8', local + 30, local + 30 + output.readUInt16LE(local + 26)) !== name)) {
    throw new Error(`ZIP local entry not found: ${name}`)
  }

  const end = output.length - 22
  const directoryOffset = output.readUInt32LE(end + 16)
  const directoryEnd = directoryOffset + output.readUInt32LE(end + 12)
  let central = directoryOffset
  while (central + 46 <= directoryEnd && output.readUInt32LE(central) === 0x02014b50) {
    const nameLength = output.readUInt16LE(central + 28)
    const extraLength = output.readUInt16LE(central + 30)
    const commentLength = output.readUInt16LE(central + 32)
    const entryName = output.toString('utf8', central + 46, central + 46 + nameLength)
    if (entryName === name) {
      if (centralOffset !== undefined) writeInteger(output, central + centralOffset, width, centralValue ?? value)
      return output
    }
    central += 46 + nameLength + extraLength + commentLength
  }
  throw new Error(`ZIP central entry not found: ${name}`)
}

function writeInteger(bytes, offset, width, value) {
  if (width === 2) bytes.writeUInt16LE(value, offset)
  else bytes.writeUInt32LE(value, offset)
}

test('Host package validator accepts exact minimal and multi-Feature inventories without retaining archive bytes', async () => {
  const minimal = await validate(webPackage())
  assert.equal(minimal.manifest.id, 'org.example.web-demo')
  assert.match(minimal.hash, /^[a-f0-9]{64}$/)
  assert.equal(minimal.size, webPackage().length)
  assert.equal(minimal.runtimeSupport, 'not-implemented')
  assert.equal('bytes' in minimal, false)
  assert.equal('assets' in minimal, false)

  const value = webManifest({
    features: [
      { id: 'one', title: 'One', entry: { kind: 'web-bundle', document: 'web/one.html' } },
      { id: 'two', title: 'Two', entry: { kind: 'web-bundle', document: 'web/two.html' } },
    ],
    webBundle: { files: [
      { path: 'web/one.html', mediaType: 'text/html' }, { path: 'web/two.html', mediaType: 'text/html' },
      { path: 'web/app.js', mediaType: 'text/javascript' }, { path: 'web/app.css', mediaType: 'text/css' },
      { path: 'web/data.json', mediaType: 'application/json' }, { path: 'web/core.wasm', mediaType: 'application/wasm' },
    ] },
    assets: [
      { path: 'assets/icon.png', mediaType: 'image/png' }, { path: 'assets/photo.jpg', mediaType: 'image/jpeg' },
      { path: 'assets/photo.webp', mediaType: 'image/webp' }, { path: 'assets/font.woff2', mediaType: 'font/woff2' },
    ],
  })
  const entries = [
    ['web/one.html', '<html>one</html>'], ['web/two.html', '<html>two</html>'], ['web/app.js', 'export default 1'],
    ['web/app.css', 'body{}'], ['web/data.json', '{"ok":true}'], ['web/core.wasm', wasmHeader],
    ['assets/icon.png', pngSignature], ['assets/photo.jpg', jpegSignature], ['assets/photo.webp', webpSignature], ['assets/font.woff2', woff2Signature],
  ].map(([name, data]) => ({ name, data }))
  const checked = await validate(webPackage(value, entries))
  assert.equal(checked.manifest.features.length, 2)
  assert.equal(checked.manifest.webBundle.files.length, 6)
  assert.equal(checked.manifest.assets.length, 4)
})

test('Host package validator rejects exact-inventory, MIME, Feature-entry, executable, and source-map violations', async () => {
  const missing = webManifest({ webBundle: { files: [{ path: 'web/index.html', mediaType: 'text/html' }, { path: 'web/missing.js', mediaType: 'text/javascript' }] } })
  const extras = webPackage(webManifest(), [{ name: 'web/index.html', data: '<html/>' }, { name: 'web/extra.js', data: 'x' }])
  const missingArchive = zip([{ name: 'manifest.json', data: JSON.stringify(missing) }, { name: 'web/index.html', data: '<html/>' }])
  const badMime = webManifest({ webBundle: { files: [{ path: 'web/index.html', mediaType: 'text/javascript' }] } })
  const badEntry = webManifest({ features: [{ id: 'hello', title: 'Hello', entry: { kind: 'web-bundle', document: 'web/other.html' } }] })
  for (const bytes of [
    extras, missingArchive,
    webPackage(badMime), webPackage(badEntry),
    webPackage(webManifest({ webBundle: { files: [{ path: 'web/app.js.map', mediaType: 'text/javascript' }] } })),
    webPackage(webManifest({ webBundle: { files: [{ path: 'web/app.exe', mediaType: 'text/javascript' }] } })),
    webPackage(webManifest({ webBundle: { files: [{ path: 'web/app.dll', mediaType: 'text/javascript' }] } })),
    webPackage(webManifest({ webBundle: { files: [{ path: 'web/app.node', mediaType: 'text/javascript' }] } })),
  ]) await assert.rejects(() => validate(bytes))

  const webScriptManifest = webManifest({ webBundle: { files: [
    { path: 'web/index.html', mediaType: 'text/html' }, { path: 'web/app.js', mediaType: 'text/javascript' },
  ] } })
  const obviousNativeSignatures = [
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]), // ELF
    Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x07, 0, 0, 1]), // 64-bit Mach-O
    Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 2]), // universal Mach-O
  ]
  for (const signature of obviousNativeSignatures) {
    await assert.rejects(() => validate(webPackage(webScriptManifest, [
      { name: 'web/index.html', data: '<html/>' }, { name: 'web/app.js', data: signature },
    ])), error => error.code === 'UNSUPPORTED_FILE_TYPE')
  }

  for (const disguisedHtml of [
    '<!doctype html><html><body>not JavaScript</body></html>',
    '\uFEFF  <html><body>not JavaScript</body></html>',
    '<script>not a JavaScript module file</script>',
  ]) {
    await assert.rejects(() => validate(webPackage(webScriptManifest, [
      { name: 'web/index.html', data: '<html/>' }, { name: 'web/app.js', data: disguisedHtml },
    ])), error => error.code === 'UNSUPPORTED_FILE_TYPE')
  }
})

test('Host package validator rejects duplicate ZIP names, invalid UTF-8 names, unsafe types, and ZIP64 ambiguity', async () => {
  const base = JSON.stringify(webManifest())
  await assert.rejects(() => validate(zip([{ name: 'manifest.json', data: base }, { name: 'web/index.html', data: 'ok' }, { name: 'web/index.html', data: 'again' }])))
  await assert.rejects(() => validate(zip([{ name: 'manifest.json', data: base }, { nameBytes: [0x77, 0x65, 0x62, 0x2f, 0xff], data: 'bad', flags: 0x800 }])))
  await assert.rejects(() => validate(zip([{ name: 'manifest.json', data: base }, { name: 'web/index.html', data: 'x', attrs: 0xa1ff0000 }])))
  await assert.rejects(() => validate(webPackage(webManifest(), [{ name: 'web/index.html', data: '<html/>', attrs: 0x81a40008 }])))
  await assert.rejects(() => validate(webPackage(webManifest(), [{ name: 'web/index.html', data: '<html/>', attrs: 0x81a40040 }])))
  await assert.rejects(() => validate(zip([{ name: 'manifest.json', data: base, flags: 1 }, { name: 'web/index.html', data: 'x' }])))
  await assert.rejects(() => validate(zip([{ name: 'manifest.json', data: base, deflate: true, size: 101_000 }, { name: 'web/index.html', data: 'x' }])))
})

test('Host package validator rejects ambiguous local ZIP metadata and data descriptors', async () => {
  const bytes = webPackage()
  const target = 'web/index.html'
  for (const mismatch of [
    mutateZipEntry(bytes, target, { localOffset: 4, width: 2, value: 21 }),
    mutateZipEntry(bytes, target, { localOffset: 14, value: 0xdeadbeef }),
    mutateZipEntry(bytes, target, { localOffset: 18, value: bytes.readUInt32LE(18) + 1 }),
    mutateZipEntry(bytes, target, { localOffset: 22, value: bytes.readUInt32LE(22) + 1 }),
    mutateZipEntry(bytes, target, { localOffset: 6, centralOffset: 8, width: 2, value: 0x8, centralValue: 0x8 }),
  ]) {
    await assert.rejects(() => validate(mismatch), error => error.code === 'UNSAFE_ARCHIVE')
  }
})

test('Host package validator rejects a bundle inventory that reuses manifest.json', async () => {
  const manifest = webManifest({ webBundle: { files: [
    { path: 'web/index.html', mediaType: 'text/html' },
    { path: 'manifest.json', mediaType: 'application/json' },
  ] } })
  await assert.rejects(() => validate(webPackage(manifest)), error => error.code === 'INVALID_PATH')
})

test('Manifest version dispatch is exact and never sends a failing v2 package through v1', async () => {
  const v1 = {
    manifestVersion: 1, id: 'org.example.old', name: 'Old', description: '', author: { name: 'Example' }, version: '1.0.0',
    api: { apiMajor: 1, minHostVersion: '0.1.0' }, type: 'declarative-manager', entry: { pageId: 'home', label: 'Old' },
    requestedCapabilities: ['manager.page'], settings: [], pages: [{ id: 'home', title: 'Home', blocks: [{ type: 'paragraph', text: 'hello' }] }], actions: [], assets: [],
  }
  assert.equal((await validateIncomingPackage(zip([{ name: 'manifest.json', data: JSON.stringify(v1) }]), '0.1.0')).kind, 'v1')
  const legacyZip64 = zip64(packageBytes(manifest()))
  const directV1 = await validatePackage(legacyZip64, '0.1.0')
  const dispatchedV1 = await validateIncomingPackage(legacyZip64, '0.1.0')
  assert.equal(dispatchedV1.kind, 'v1')
  assert.equal(dispatchedV1.package.hash, directV1.hash, 'version sniffing must retain v1 ZIP64 compatibility')

  const ordinaryV1 = packageBytes(manifest())
  const ordinaryDirect = await validatePackage(ordinaryV1, '0.1.0')
  const ordinaryDispatched = await validateIncomingPackage(ordinaryV1, '0.1.0')
  assert.equal(ordinaryDispatched.kind, 'v1')
  assert.equal(ordinaryDispatched.package.hash, ordinaryDirect.hash)
  assert.deepEqual(ordinaryDispatched.package.manifest, ordinaryDirect.manifest)

  for (const legacyHeaderVariant of [
    mutateZipEntry(ordinaryV1, 'manifest.json', { localOffset: 4, width: 2, value: 45 }),
    mutateZipEntry(ordinaryV1, 'manifest.json', { localOffset: 14, value: 0xdeadbeef }),
  ]) {
    const direct = await validatePackage(legacyHeaderVariant, '0.1.0')
    const routed = await validateIncomingPackage(legacyHeaderVariant, '0.1.0')
    assert.equal(routed.kind, 'v1')
    assert.equal(routed.package.hash, direct.hash)
    assert.deepEqual(routed.package.manifest, direct.manifest)
  }

  for (const [invalid, expectedCode] of [
    [manifest({ id: 'x' }), 'INVALID_MANIFEST'],
    [manifest({ api: { apiMajor: 2, minHostVersion: '0.1.0' } }), 'INCOMPATIBLE_PLUGIN'],
  ]) {
    const invalidBytes = packageBytes(invalid)
    const directError = await validatePackage(invalidBytes, '0.1.0').then(() => null, error => error)
    const routedError = await validateIncomingPackage(invalidBytes, '0.1.0').then(() => null, error => error)
    assert.equal(directError?.code, expectedCode)
    assert.equal(routedError?.code, directError?.code)
  }

  const invalidV2 = webPackage(webManifest({ unknown: 'must reject' }))
  await assert.rejects(() => validateIncomingPackage(invalidV2, '0.1.0'), error => error.code === 'UNKNOWN_FIELD')
  await assert.rejects(() => validateIncomingPackage(zip([{ name: 'manifest.json', data: '{"manifestVersion":99}' }]), '0.1.0'), error => error.code === 'UNSUPPORTED_MANIFEST_VERSION')
  for (const manifestVersion of ['2', null, 2.5]) {
    await assert.rejects(() => validateIncomingPackage(webPackage(webManifest({ manifestVersion })), '0.1.0'), error => error.code === 'INVALID_MANIFEST')
  }
})

test('Manifest and archive count limits accept exact values and reject the first value above', async () => {
  const base = webManifest()
  const json = JSON.stringify(base)
  const padded = `${json}${' '.repeat(65_536 - Buffer.byteLength(json))}`
  assert.equal((await validate(zip([{ name: 'manifest.json', data: padded }, { name: 'web/index.html', data: '<html/>' }]))).manifest.id, base.id)
  await assert.rejects(() => validate(zip([{ name: 'manifest.json', data: `${padded} ` }, { name: 'web/index.html', data: '<html/>' }])))
  await assert.rejects(() => validate(Buffer.alloc(20 * 1024 * 1024 + 1)))

  const files = [{ path: 'web/index.html', mediaType: 'text/html' }, ...Array.from({ length: 126 }, (_, index) => ({ path: `web/chunk-${index}.js`, mediaType: 'text/javascript' }))]
  const assets = Array.from({ length: 128 }, (_, index) => ({ path: `assets/image-${index}.jpg`, mediaType: 'image/jpeg' }))
  const manifest = webManifest({ webBundle: { files }, assets })
  const entries = [...files.map(item => ({ name: item.path, data: item.path.endsWith('.html') ? '<html/>' : '' })), ...assets.map(item => ({ name: item.path, data: jpegSignature }))]
  assert.equal((await validate(webPackage(manifest, entries))).manifest.assets.length, 128)
  await assert.rejects(() => validate(zip([{ name: 'manifest.json', data: JSON.stringify(base) }, ...Array.from({ length: 256 }, (_, index) => ({ name: `x-${index}.js`, data: '' }))])))
})

test('HTML, bundle code, image, font, and icon byte limits accept equality and reject limit plus one', async () => {
  const checkSizedFile = async (path, mediaType, size, icon = false) => {
    const asset = mediaType.startsWith('image/') || mediaType === 'font/woff2'
    const value = webManifest({
      features: [{ id: 'hello', title: 'Hello', ...(icon ? { icon: { kind: 'asset', path: 'assets/icon.png' } } : {}), entry: { kind: 'web-bundle', document: 'web/index.html' } }],
      webBundle: { files: [{ path: 'web/index.html', mediaType: 'text/html' }, ...(path === 'web/index.html' || asset ? [] : [{ path, mediaType }])] },
      assets: icon ? [{ path: 'assets/icon.png', mediaType: 'image/png' }] : asset ? [{ path, mediaType }] : [],
    })
    let data = Buffer.alloc(size)
    if (mediaType === 'image/jpeg') jpegSignature.copy(data)
    if (mediaType === 'image/webp') webpSignature.copy(data)
    if (mediaType === 'font/woff2') woff2Signature.copy(data)
    if (mediaType === 'application/wasm') wasmHeader.copy(data)
    if (mediaType === 'image/png') pngSignature.copy(data)
    const entries = [{ name: 'web/index.html', data: path === 'web/index.html' ? data : '<html/>', deflate: false }, ...(path === 'web/index.html' ? [] : [{ name: path, data, deflate: false }])]
    if (icon) entries.push({ name: 'assets/icon.png', data: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), deflate: false })
    return validate(webPackage(value, entries))
  }

  await checkSizedFile('web/index.html', 'text/html', 1024 * 1024)
  await assert.rejects(() => checkSizedFile('web/index.html', 'text/html', 1024 * 1024 + 1))
  await checkSizedFile('web/app.js', 'text/javascript', 8 * 1024 * 1024)
  await assert.rejects(() => checkSizedFile('web/app.js', 'text/javascript', 8 * 1024 * 1024 + 1))
  await checkSizedFile('assets/photo.jpg', 'image/jpeg', 2 * 1024 * 1024)
  await assert.rejects(() => checkSizedFile('assets/photo.jpg', 'image/jpeg', 2 * 1024 * 1024 + 1))
  await checkSizedFile('assets/photo.png', 'image/png', 2 * 1024 * 1024)
  await assert.rejects(() => checkSizedFile('assets/photo.png', 'image/png', 2 * 1024 * 1024 + 1))
  await checkSizedFile('assets/font.woff2', 'font/woff2', 1024 * 1024)
  await assert.rejects(() => checkSizedFile('assets/font.woff2', 'font/woff2', 1024 * 1024 + 1))
  await checkSizedFile('web/module.wasm', 'application/wasm', 8 * 1024 * 1024)
  await assert.rejects(() => checkSizedFile('web/module.wasm', 'application/wasm', 8 * 1024 * 1024 + 1))

  const iconManifest = webManifest({
    features: [{ id: 'hello', title: 'Hello', icon: { kind: 'asset', path: 'assets/icon.png' }, entry: { kind: 'web-bundle', document: 'web/index.html' } }],
    assets: [{ path: 'assets/icon.png', mediaType: 'image/png' }],
  })
  await validate(webPackage(iconManifest, [
    { name: 'web/index.html', data: '<html/>' }, { name: 'assets/icon.png', data: pngOfSize(256 * 1024), deflate: false },
  ]))
  await assert.rejects(() => validate(webPackage(iconManifest, [
    { name: 'web/index.html', data: '<html/>' }, { name: 'assets/icon.png', data: pngOfSize(256 * 1024 + 1), deflate: false },
  ])), error => error.code === 'PACKAGE_LIMIT_EXCEEDED')
})

test('per-file compression ratio and total expansion limits are enforced without aggregating extracted files', async () => {
  const bomb = webPackage(webManifest(), [{ name: 'web/index.html', data: Buffer.alloc(150_000), deflate: true }])
  await assert.rejects(() => validate(bomb), error => error.code === 'PACKAGE_LIMIT_EXCEEDED')

  const manifest = webManifest()
  const htmlSize = Buffer.byteLength('<html/>')
  // Keep the total expanded size at the exact 50 MiB boundary while staying
  // below the separate 20 MiB archive limit and 100:1 per-entry ratio limit.
  const boundedData = size => {
    const output = Buffer.alloc(size)
    randomBytes(Math.ceil(size / 32)).copy(output)
    return output
  }
  const files = Array.from({ length: 6 }, (_, index) => ({ path: `web/part-${index}.js`, mediaType: 'text/javascript' }))
  files.push({ path: 'web/last.js', mediaType: 'text/javascript' })
  manifest.webBundle.files.push(...files)
  const manifestBytes = Buffer.from(JSON.stringify(manifest))
  const target = 50 * 1024 * 1024 - manifestBytes.length - htmlSize
  const entries = [
    { name: 'web/index.html', data: '<html/>', deflate: false },
    ...files.map((file, index) => ({ name: file.path, data: boundedData(index < 6 ? 8 * 1024 * 1024 : target - 48 * 1024 * 1024), deflate: true })),
  ]
  const exact = webPackage(manifest, entries)
  assert.equal(entries.reduce((sum, entry) => sum + Buffer.byteLength(entry.data), manifestBytes.length), 50 * 1024 * 1024)
  assert.equal((await validate(exact)).size, exact.length)
  const over = [...entries]
  over[over.length - 1] = { ...over.at(-1), data: Buffer.concat([over.at(-1).data, Buffer.from([1])]) }
  await assert.rejects(() => validate(webPackage(manifest, over)), error => error.code === 'PACKAGE_LIMIT_EXCEEDED')
})

test('compressed archive accepts exactly 20 MiB and compression ratio accepts exactly 100:1', async () => {
  const files = ['web/index.html', 'web/one.js', 'web/two.js', 'web/three.js']
  const value = webManifest({ webBundle: { files: files.map(path => ({ path, mediaType: path.endsWith('.html') ? 'text/html' : 'text/javascript' })) } })
  const manifestBytes = Buffer.byteLength(JSON.stringify(value))
  const envelopeBytes = 22 + ['manifest.json', ...files].reduce((size, name) => size + 76 + 2 * Buffer.byteLength(name), 0)
  const payloadBytes = 20 * 1024 * 1024 - envelopeBytes - manifestBytes
  const html = Buffer.from('<html/>')
  const remaining = payloadBytes - html.length - 16 * 1024 * 1024
  assert.ok(remaining > 0 && remaining <= 8 * 1024 * 1024)
  const js = size => { const data = Buffer.alloc(size); data.write('//'); return data }
  const entries = [
    { name: files[0], data: html }, { name: files[1], data: js(8 * 1024 * 1024) },
    { name: files[2], data: js(8 * 1024 * 1024) }, { name: files[3], data: js(remaining) },
  ]
  const exact = webPackage(value, entries)
  assert.equal(exact.length, 20 * 1024 * 1024)
  await validate(exact)
  const over = [...entries.slice(0, -1), { ...entries.at(-1), data: Buffer.concat([entries.at(-1).data, Buffer.from([0])]) }]
  assert.equal(webPackage(value, over).length, 20 * 1024 * 1024 + 1)
  await assert.rejects(() => validate(webPackage(value, over)), error => error.code === 'PACKAGE_LIMIT_EXCEEDED')

  const ratioManifest = webManifest({ webBundle: { files: [
    { path: 'web/index.html', mediaType: 'text/html' }, { path: 'web/ratio.js', mediaType: 'text/javascript' },
  ] } })
  const seed = Buffer.alloc(12_000)
  let seedState = 1
  for (let index = 0; index < seed.length; index++) {
    seedState = (Math.imul(seedState, 1_664_525) + 1_013_904_223) >>> 0
    seed[index] = seedState >>> 24
  }
  const boundary = ratioBoundaryData(1_000_000, 10_000, seed)
  assert.equal(deflateRawSync(boundary).length, 10_000)
  await validate(webPackage(ratioManifest, [
    { name: 'web/index.html', data: '<html/>' }, { name: 'web/ratio.js', data: boundary, deflate: true },
  ]))
  const overRatio = Buffer.concat([boundary, Buffer.from([0])])
  assert.equal(deflateRawSync(overRatio).length, 10_000)
  await assert.rejects(() => validate(webPackage(ratioManifest, [
    { name: 'web/index.html', data: '<html/>' }, { name: 'web/ratio.js', data: overRatio, deflate: true },
  ])), error => error.code === 'PACKAGE_LIMIT_EXCEEDED')
})
