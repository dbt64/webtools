import test from 'node:test'
import assert from 'node:assert/strict'
import { parseManifestV1, PluginValidationError } from '../runtime/manifest-v1.mjs'
import { validatePackageV1 } from '../runtime/package-v1.mjs'
import { validatePluginArchiveV1, validatePluginArchiveV2 } from '../index.mjs'
import { parseManifest } from '../../../electron/plugins/manifest.ts'
import { validatePackage, validatePackageV2 } from '../../../electron/plugins/package-validator.ts'
import { manifest, packageBytes, png, webManifest, webPackage, zip } from '../../../electron/plugins/fixtures.mjs'

test('canonical SDK and Electron adapters accept the same v1 manifest', () => {
  const bytes = Buffer.from(JSON.stringify(manifest()))
  assert.equal(parseManifestV1(bytes, '0.1.0').id, parseManifest(bytes, '0.1.0').id)
})

test('canonical SDK and Electron adapters reject the same malformed package', async () => {
  const bytes = packageBytes(manifest({ requestedCapabilities: ['manager.page', 'filesystem.read'] }))
  await assert.rejects(() => validatePackageV1(bytes, '0.1.0'), error => error instanceof PluginValidationError && error.code === 'INVALID_MANIFEST')
  await assert.rejects(() => validatePackage(bytes, '0.1.0'), error => error.code === 'INVALID_MANIFEST')
})

test('public SDK archive API and Host adapter agree for valid basic and PNG packages', async () => {
  const cases = [
    packageBytes(manifest()),
    packageBytes(
      manifest({ entry: { pageId: 'home', label: 'Demo', icon: 'assets/icon.png' }, assets: [{ path: 'assets/icon.png', type: 'image/png' }] }),
      [{ name: 'assets/icon.png', data: png() }],
    ),
  ]
  for (const bytes of cases) {
    const sdk = await validatePluginArchiveV1(bytes, '0.1.0')
    const host = await validatePackage(bytes, '0.1.0')
    assert.equal(sdk.valid, true)
    assert.equal(host.manifest.id, sdk.manifest.id)
    assert.equal(host.manifest.version, sdk.manifest.version)
    assert.equal(host.manifest.api.apiMajor, sdk.manifest.api.apiMajor)
    assert.equal(host.manifest.manifestVersion, sdk.manifest.manifestVersion)
    assert.equal(sdk.size, bytes.length)
    assert.equal('assets' in sdk, false)
  }
})

test('public SDK archive API and Host adapter agree on representative hostile archives', async () => {
  const base = JSON.stringify(manifest())
  const cases = [
    packageBytes(manifest({ privilegedRuntime: { node: true } })),
    packageBytes(manifest({ requestedCapabilities: ['manager.page', 'filesystem.read'] })),
    packageBytes(manifest({ api: { apiMajor: 99, minHostVersion: '0.1.0' } })),
    packageBytes(manifest({ api: { apiMajor: 1, minHostVersion: '9.0.0' } })),
    zip([{ name: 'manifest.json', data: base }, { name: '../outside.png', data: png() }]),
    zip([{ name: 'manifest.json', data: base }, { name: 'manifest.json', data: base }]),
    zip([{ name: 'manifest.json', data: base }, { name: 'assets', data: 'file' }, { name: 'assets/icon.png', data: png() }]),
    Buffer.from('truncated archive'),
  ]

  for (const bytes of cases) {
    let sdkError
    let hostError
    try { await validatePluginArchiveV1(bytes, '0.1.0') } catch (error) { sdkError = error }
    try { await validatePackage(bytes, '0.1.0') } catch (error) { hostError = error }
    assert.ok(sdkError, 'SDK should reject hostile archive')
    assert.ok(hostError, 'Host should reject hostile archive')
    assert.equal(sdkError.code, hostError.code)
  }
})

test('public SDK Manifest v2 preflight and Electron Main agree on inert package descriptors and diagnostics', async () => {
  const valid = webPackage(webManifest({
    requestedCapabilities: ['network.domains'],
    network: { mode: 'domains', domains: [{ host: 'status.example.com', protocol: 'https' }] },
  }))
  const [sdk, host] = await Promise.all([
    validatePluginArchiveV2(valid, '0.1.0'),
    validatePackageV2(valid, '0.1.0'),
  ])
  assert.equal(sdk.valid, true)
  assert.equal(sdk.manifest.id, host.manifest.id)
  assert.equal(sdk.manifest.version, host.manifest.version)
  assert.equal(sdk.sha256, host.hash)
  assert.equal(sdk.size, host.size)
  assert.equal(sdk.networkRuntimeSupport, 'unavailable')
  assert.equal(sdk.runtimeSupport, 'not-implemented')
  assert.equal('bytes' in sdk, false)
  assert.equal('assets' in sdk, false)

  const hostile = [
    webPackage(webManifest({ unknown: true })),
    webPackage(webManifest({ id: 'webtools.translation' })),
    webPackage(webManifest({ network: { mode: 'domains', domains: [{ host: '127.0.0.1', protocol: 'https' }] } })),
    zip([{ name: 'manifest.json', data: JSON.stringify(webManifest()) }, { name: 'web/extra.html', data: '<html/>' }]),
  ]
  for (const bytes of hostile) {
    let sdkError
    let hostError
    try { await validatePluginArchiveV2(bytes, '0.1.0') } catch (error) { sdkError = error }
    try { await validatePackageV2(bytes, '0.1.0') } catch (error) { hostError = error }
    assert.ok(sdkError, 'SDK preflight should reject the package')
    assert.ok(hostError, 'Host install-time authority should reject the package')
    assert.equal(sdkError.code, hostError.code)
  }
})
