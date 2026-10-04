import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { validatePackageV1 } from '../runtime/package-v1.mjs'
import { manifest as typedManifest } from '../../../examples/plugins/private-notes/manifest.typecheck.ts'

const exampleDir = fileURLToPath(new URL('../../../examples/plugins/private-notes/', import.meta.url))
const cli = fileURLToPath(new URL('../bin/webtools-plugin.mjs', import.meta.url))

test('private-notes is a valid non-executable third-party storage example', async t => {
  const manifest = JSON.parse(await readFile(path.join(exampleDir, 'manifest.json'), 'utf8'))
  assert.deepEqual(manifest, typedManifest)
  const typeSource = await readFile(path.join(exampleDir, 'manifest.typecheck.ts'), 'utf8')
  assert.ok(typeSource.includes("from '@webtools/plugin-sdk'"))
  assert.doesNotMatch(typeSource, /plugin-sdk\/declarative-v1\/types/)
  assert.equal(manifest.id, 'org.example.webtools.private-notes')
  assert.deepEqual(manifest.requestedCapabilities, ['manager.page', 'plugin.storage.read', 'plugin.storage.write'])
  assert.deepEqual(new Set(manifest.actions.map(action => action.type)), new Set(['plugin.storage.read', 'plugin.storage.write']))
  assert.equal(manifest.actions.some(action => action.type === 'sharedAI.complete'), false)
  assert.equal(manifest.assets.length, 0)
  const before = await readFile(path.join(exampleDir, 'manifest.json'))
  const validation = spawnSync(process.execPath, [cli, 'validate', exampleDir, '--host-version', '0.1.0'], { encoding: 'utf8', windowsHide: true })
  assert.equal(validation.status, 0, validation.stderr)
  assert.deepEqual(await readFile(path.join(exampleDir, 'manifest.json')), before)

  const work = await mkdtemp(path.join(tmpdir(), 'wtplugin-example-'))
  t.after(() => rm(work, { recursive: true, force: true }))
  const packed = spawnSync(process.execPath, [cli, 'pack', exampleDir, '--out', path.join(work, 'private-notes.wtplugin'), '--host-version', '0.1.0'], { encoding: 'utf8', windowsHide: true })
  assert.equal(packed.status, 0, packed.stderr)
  assert.match(packed.stdout, /org\.example\.webtools\.private-notes/)
  const checked = await validatePackageV1(await readFile(path.join(work, 'private-notes.wtplugin')), '0.1.0')
  assert.equal(checked.manifest.id, manifest.id)
})
