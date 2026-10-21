import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createPluginProject } from '../../create-webtools-plugin/src/create-project.mjs'
import { buildPluginProject } from '../src/build-v3.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const repo = path.resolve(here, '../../..')
const sdk = path.resolve(here, '..')

async function linkInstalledPackage(project, packageName, source) {
  const segments = packageName.split('/')
  const directory = path.join(project, 'node_modules', ...segments.slice(0, -1))
  await mkdir(directory, { recursive: true })
  await symlink(source, path.join(directory, segments.at(-1)), 'junction')
}

test('Manifest v3 build emits frontend, CommonJS preload, resources, and a matching runtime inventory', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webtools-build-v3-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await createPluginProject('sample-node', { cwd: root, framework: 'vanilla', runtime: 'node', id: 'org.example.build-v3' })
  const project = path.join(root, 'sample-node')
  await mkdir(path.join(project, 'assets'), { recursive: true })
  await writeFile(path.join(project, 'assets', 'helper.exe'), Buffer.from('test-helper'))
  await linkInstalledPackage(project, 'vite', path.join(repo, 'node_modules', 'vite'))
  await linkInstalledPackage(project, 'typescript', path.join(repo, 'node_modules', 'typescript'))
  await linkInstalledPackage(project, '@webtools/plugin-sdk', sdk)

  const result = await buildPluginProject(project)
  const manifest = JSON.parse(await readFile(path.join(project, 'dist', 'manifest.json'), 'utf8'))
  assert.equal(manifest.manifestVersion, 3)
  assert.equal(manifest.runtime.preload, 'preload/index.cjs')
  assert.ok(manifest.runtimeFiles.some(file => file.path === 'web/index.html' && file.role === 'web'))
  assert.ok(manifest.runtimeFiles.some(file => file.path === 'preload/index.cjs' && file.role === 'node-preload'))
  assert.ok(manifest.runtimeFiles.some(file => file.path === 'resources/helper.exe' && file.role === 'helper'))
  assert.deepEqual(new Set(result.files), new Set(manifest.runtimeFiles.map(file => file.path)))
  assert.match(await readFile(path.join(project, 'dist', 'preload', 'index.cjs'), 'utf8'), /contextBridge\.exposeInMainWorld/u)
})

test('build reports missing project inputs and does not follow an assets directory symlink', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webtools-build-v3-invalid-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'plugin'))
  await assert.rejects(() => buildPluginProject(path.join(root, 'plugin')), error => error.code === 'BUILD_INPUT_MISSING')

  await createPluginProject('linked-assets', { cwd: root, framework: 'vanilla', runtime: 'web', id: 'org.example.linked-assets' })
  const outside = path.join(root, 'outside-assets')
  await mkdir(outside)
  await rm(path.join(root, 'linked-assets', 'assets'), { recursive: true })
  await symlink(outside, path.join(root, 'linked-assets', 'assets'), 'junction')
  await linkInstalledPackage(path.join(root, 'linked-assets'), 'vite', path.join(repo, 'node_modules', 'vite'))
  await assert.rejects(() => buildPluginProject(path.join(root, 'linked-assets')), error => error.code === 'BUILD_SYMLINK')
})
