import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import * as sdk from '../index.mjs'
import { getPluginPaths } from '../node.mjs'

test('SDK root exposes Manifest v3 authoring and package APIs without runtime-internal paths', async () => {
  for (const key of ['MANIFEST_VERSION_V3', 'parseManifestV3', 'validatePluginSourceV3', 'validatePluginArchiveV3', 'packPluginV3']) {
    assert.equal(typeof sdk[key], key === 'MANIFEST_VERSION_V3' ? 'number' : 'function', key)
  }
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(packageJson.private, undefined)
  assert.equal(packageJson.version, '1.8.0')
  assert.equal(packageJson.exports['./theme.css'], './web/theme.css')
  assert.ok(packageJson.exports['./node'])
  assert.ok(packageJson.exports['./manifest'])
  assert.ok(packageJson.exports['./runtime-target.json'])
  assert.equal(packageJson.exports['./runtime-v3/manifest'], undefined)
  assert.equal(packageJson.exports['./runtime-v3/package'], undefined)
})

test('Node SDK resolves package resources and persistent local data through its public helper', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wt-plugin-paths-'))
  const previous = process.env.WEBTOOLS_PLUGIN_DATA
  process.env.WEBTOOLS_PLUGIN_DATA = path.join(root, 'profile', 'plugins', 'local-data', 'org.example.test')
  try {
    assert.deepEqual(getPluginPaths(path.join(root, 'installed', 'preload')), {
      packageDirectory: path.join(root, 'installed'),
      localDataDirectory: path.join(root, 'profile', 'plugins', 'local-data', 'org.example.test'),
    })
    assert.throws(() => getPluginPaths('relative/preload'), /absolute path/u)
  } finally {
    if (previous === undefined) delete process.env.WEBTOOLS_PLUGIN_DATA
    else process.env.WEBTOOLS_PLUGIN_DATA = previous
    await rm(root, { recursive: true, force: true })
  }
})
