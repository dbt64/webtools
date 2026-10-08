import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { validateWebPackageForRuntime } from './package-validator.ts'
import { webManifest, webPackage, zip } from './fixtures.mjs'

function runtimePackage(files) {
  const manifest = webManifest({
    webBundle: { files: files.map(({ path, mediaType }) => ({ path, mediaType })) },
  })
  return webPackage(manifest, files.map(({ path, bytes }) => ({ name: path, data: bytes })))
}

test('runtime snapshot exposes exact validated inventory bytes and package hash without archive paths', async () => {
  const html = Buffer.from('<!doctype html><html><body>snapshot</body></html>')
  const script = Buffer.from('export const value = 42')
  const archive = runtimePackage([
    { path: 'web/index.html', mediaType: 'text/html', bytes: html },
    { path: 'web/app.js', mediaType: 'text/javascript', bytes: script },
  ])
  const expectedHash = createHash('sha256').update(archive).digest('hex')
  const snapshot = await validateWebPackageForRuntime(archive, '0.1.0')

  assert.equal(snapshot.packageHash, expectedHash)
  assert.equal(snapshot.archiveSize, archive.length)
  assert.equal(snapshot.manifest.manifestVersion, 2)
  assert.deepEqual(snapshot.inventory, [
    { canonicalPath: 'web/index.html', mimeType: 'text/html', size: html.length },
    { canonicalPath: 'web/app.js', mimeType: 'text/javascript', size: script.length },
  ])
  assert.equal(Object.isFrozen(snapshot), true)
  assert.equal(Object.isFrozen(snapshot.inventory), true)
  assert.equal(Object.isFrozen(snapshot.inventory[0]), true)
  assert.equal(Object.hasOwn(snapshot, 'archivePath'), false)
  assert.equal(Object.hasOwn(snapshot, 'packagePath'), false)
  assert.deepEqual(snapshot.getResource('web/index.html').bytes, html)
  assert.deepEqual(snapshot.getResource('web/app.js').bytes, script)
  assert.equal(snapshot.getResource('missing.js'), undefined)
})

test('runtime snapshot owns bytes across caller mutation and returns defensive resource copies', async () => {
  const sourceBytes = Buffer.from('<!doctype html><p>before</p>')
  const archive = runtimePackage([{ path: 'web/index.html', mediaType: 'text/html', bytes: sourceBytes }])
  const snapshot = await validateWebPackageForRuntime(archive, '0.1.0')
  const expected = Buffer.from(snapshot.getResource('web/index.html').bytes)

  archive.fill(0)
  const firstRead = snapshot.getResource('web/index.html')
  firstRead.bytes.fill(0)
  assert.deepEqual(snapshot.getResource('web/index.html').bytes, expected)
})

test('invalid or non-inventory archive members cannot produce runtime snapshots', async () => {
  const declared = webManifest({ webBundle: { files: [
    { path: 'web/index.html', mediaType: 'text/html' },
    { path: 'web/missing.js', mediaType: 'text/javascript' },
  ] } })
  const missing = webPackage(declared, [{ name: 'web/index.html', data: '<html/>' }])
  const undeclared = webPackage(webManifest(), [
    { name: 'web/index.html', data: '<html/>' },
    { name: 'web/extra.js', data: 'not declared' },
  ])
  const traversal = zip([
    { name: 'manifest.json', data: JSON.stringify(webManifest({
      webBundle: { files: [{ path: 'web/index.html', mediaType: 'text/html' }] },
    })) },
    { name: 'web/../index.html', data: '<html/>' },
  ])

  for (const bytes of [Buffer.alloc(0), missing, undeclared, traversal]) {
    await assert.rejects(() => validateWebPackageForRuntime(bytes, '0.1.0'))
  }
})

test('runtime snapshot rejects invalid MIME, duplicate normalized paths and oversized entries', async () => {
  const badMime = webManifest({ webBundle: { files: [{ path: 'web/index.html', mediaType: 'text/javascript' }] } })
  const duplicate = webManifest({ webBundle: { files: [
    { path: 'web/index.html', mediaType: 'text/html' },
    { path: 'web/Index.html', mediaType: 'text/html' },
  ] } })
  const oversized = Buffer.concat([Buffer.from('<!doctype html>'), Buffer.alloc(1_048_576, 32)])
  await assert.rejects(() => validateWebPackageForRuntime(webPackage(badMime), '0.1.0'))
  await assert.rejects(() => validateWebPackageForRuntime(webPackage(duplicate, [
    { name: 'web/index.html', data: '<html/>' }, { name: 'web/Index.html', data: '<html/>' },
  ]), '0.1.0'))
  await assert.rejects(() => validateWebPackageForRuntime(runtimePackage([
    { path: 'web/index.html', mediaType: 'text/html', bytes: oversized },
  ]), '0.1.0'))
})

test('runtime snapshot preserves domains metadata for runtime fail-closed rejection', async () => {
  const manifest = webManifest({
    requestedCapabilities: ['network.domains'],
    network: { mode: 'domains', domains: [{ host: 'example.org', protocol: 'https' }] },
  })
  const snapshot = await validateWebPackageForRuntime(webPackage(manifest), '0.1.0')
  assert.equal(snapshot.manifest.network.mode, 'domains')
  assert.equal(snapshot.networkRuntimeSupport, 'unavailable')
})
