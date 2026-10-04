import test from 'node:test'
import assert from 'node:assert/strict'
import { parseManifestV1, PluginValidationError } from '../runtime/manifest-v1.mjs'
import { validatePackageV1 } from '../runtime/package-v1.mjs'
import { parseManifest } from '../../../electron/plugins/manifest.ts'
import { validatePackage } from '../../../electron/plugins/package-validator.ts'
import { manifest, packageBytes } from '../../../electron/plugins/fixtures.mjs'

test('canonical SDK and Electron adapters accept the same v1 manifest', () => {
  const bytes = Buffer.from(JSON.stringify(manifest()))
  assert.equal(parseManifestV1(bytes, '0.1.0').id, parseManifest(bytes, '0.1.0').id)
})

test('canonical SDK and Electron adapters reject the same malformed package', async () => {
  const bytes = packageBytes(manifest({ requestedCapabilities: ['manager.page', 'filesystem.read'] }))
  await assert.rejects(() => validatePackageV1(bytes, '0.1.0'), error => error instanceof PluginValidationError && error.code === 'INVALID_MANIFEST')
  await assert.rejects(() => validatePackage(bytes, '0.1.0'), error => error.code === 'INVALID_MANIFEST')
})
