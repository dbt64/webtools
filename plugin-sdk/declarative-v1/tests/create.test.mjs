import test from 'node:test'
import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const bin = fileURLToPath(new URL('../bin/webtools-plugin.mjs', import.meta.url))
function run(args, cwd) { return spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', windowsHide: true }) }

test('create writes one basic public-API starter in a Unicode path and derives stable defaults', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'webtools-plugin-create-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const parent = path.join(root, '开发目录 with spaces')
  await mkdir(parent)

  const result = run(['create', 'My Basic_Plugin', '--host-version', '0.1.0', '--json'], parent)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal(result.stderr, '')
  const envelope = JSON.parse(result.stdout)
  assert.equal(envelope.ok, true)
  assert.equal(envelope.command, 'create')
  assert.equal(envelope.result.directory, 'My Basic_Plugin')
  assert.equal(envelope.result.plugin.id, 'org.example.my.basic.plugin')
  assert.equal(envelope.result.plugin.name, 'My Basic Plugin')

  const target = path.join(parent, 'My Basic_Plugin')
  assert.deepEqual((await readdir(target)).sort(), ['.gitignore', 'README.md', 'dist', 'manifest.json', 'manifest.typecheck.ts', 'package.json'].sort())
  const manifest = JSON.parse(await readFile(path.join(target, 'manifest.json'), 'utf8'))
  assert.equal(manifest.manifestVersion, 1)
  assert.equal(manifest.id, 'org.example.my.basic.plugin')
  assert.equal(manifest.name, 'My Basic Plugin')
  assert.equal(manifest.api.apiMajor, 1)
  assert.equal(manifest.api.minHostVersion, '0.1.0')
  assert.deepEqual(manifest.requestedCapabilities, ['manager.page'])
  assert.deepEqual(manifest.settings, [])
  assert.deepEqual(manifest.actions, [])
  assert.deepEqual(manifest.assets, [])
  assert.equal(manifest.pages.length, 1)

  const packageJson = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8'))
  assert.equal(packageJson.private, true)
  assert.equal(packageJson.packageManager, 'pnpm@9.15.9')
  assert.equal(packageJson.devDependencies.typescript, '5.9.2')
  assert.deepEqual(Object.keys(packageJson.scripts).sort(), ['inspect', 'plugin:pack', 'typecheck', 'validate'])
  assert.match(packageJson.scripts['plugin:pack'], /webtools-plugin pack/)
  assert.doesNotMatch(packageJson.scripts['plugin:pack'], /pnpm pack/)
  assert.match(await readFile(path.join(target, 'manifest.typecheck.ts'), 'utf8'), /from '@webtools\/plugin-sdk'/)
  const readme = await readFile(path.join(target, 'README.md'), 'utf8')
  assert.match(readme, /local SDK tarball/i)
  assert.match(readme, /file:\.\.\/\.\.\/artifacts\/webtools-plugin-sdk-1\.1\.0\.tgz/)
  assert.equal((await lstat(path.join(target, 'dist'))).isDirectory(), true)
})

test('create derives distinct stable default IDs for non-Latin directory names', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'webtools-plugin-create-unicode-id-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const first = run(['create', '天气插件', '--host-version', '0.1.0', '--json'], root)
  const second = run(['create', '翻译插件', '--host-version', '0.1.0', '--json'], root)
  assert.equal(first.status, 0, first.stderr || first.stdout)
  assert.equal(second.status, 0, second.stderr || second.stdout)
  const firstId = JSON.parse(first.stdout).result.plugin.id
  const secondId = JSON.parse(second.stdout).result.plugin.id
  assert.match(firstId, /^org\.example\.plugin\.[a-f0-9]{12}$/)
  assert.match(secondId, /^org\.example\.plugin\.[a-f0-9]{12}$/)
  assert.notEqual(firstId, secondId)
})

test('create applies explicit metadata and preserves it as JSON data without shell execution', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'webtools-plugin-create-overrides-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const maliciousLooking = 'My plugin $(touch marker)'
  const result = run([
    'create', 'safe-starter', '--host-version', '0.1.0', '--min-host-version', '0.0.9',
    '--id', 'com.example.private.notes', '--name', maliciousLooking,
    '--description', 'A local test starter.', '--author', 'Example Author', '--json',
  ], root)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const manifest = JSON.parse(await readFile(path.join(root, 'safe-starter', 'manifest.json'), 'utf8'))
  assert.equal(manifest.id, 'com.example.private.notes')
  assert.equal(manifest.name, maliciousLooking)
  assert.equal(manifest.description, 'A local test starter.')
  assert.equal(manifest.author.name, 'Example Author')
  assert.equal(manifest.api.minHostVersion, '0.0.9')
  assert.equal(await readFile(path.join(root, 'safe-starter', 'package.json'), 'utf8').then(text => text.includes('touch marker')), false)
  await assert.rejects(() => lstat(path.join(root, 'marker')))
})

test('create rejects rooted, traversal and empty targets without touching files outside the project root', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'webtools-plugin-create-paths-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const outside = path.join(root, 'outside')
  await mkdir(outside)
  const absoluteTarget = path.join(outside, 'absolute')
  const targets = [
    '..\\outside\\traversal',
    '../outside/traversal2',
    '.',
    absoluteTarget,
    'C:\\outside\\drive',
    '\\\\server\\share\\unc',
  ]

  for (const target of targets) {
    const result = run(['create', target, '--host-version', '0.1.0', '--json'], root)
    assert.notEqual(result.status, 0, target)
    assert.equal(JSON.parse(result.stdout).ok, false, target)
  }
  assert.deepEqual(await readdir(outside), [])
})

test('create refuses an existing target without overwriting its contents', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'webtools-plugin-create-existing-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const target = path.join(root, 'existing')
  await mkdir(target)
  await writeFile(path.join(target, 'keep.txt'), 'existing-data')
  const result = run(['create', 'existing', '--host-version', '0.1.0', '--json'], root)
  assert.equal(result.status, 1)
  const envelope = JSON.parse(result.stdout)
  assert.equal(envelope.error.code, 'OUTPUT_EXISTS')
  assert.equal(await readFile(path.join(target, 'keep.txt'), 'utf8'), 'existing-data')
  assert.deepEqual((await readdir(target)).sort(), ['keep.txt'])
})

test('create rejects symlink/junction parents and does not write through them', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'webtools-plugin-create-reparse-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const outside = await mkdtemp(path.join(tmpdir(), 'webtools-plugin-create-outside-'))
  t.after(() => rm(outside, { recursive: true, force: true }))
  const link = path.join(root, 'linked')
  await symlink(outside, link, 'junction')
  const result = run(['create', 'linked/escape', '--host-version', '0.1.0', '--json'], root)
  assert.equal(result.status, 2)
  assert.equal(JSON.parse(result.stdout).ok, false)
  assert.deepEqual(await readdir(outside), [])
})

test('create removes only its partial starter when generated manifest validation fails', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'webtools-plugin-create-invalid-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const result = run(['create', 'bad-starter', '--host-version', '0.1.0', '--id', 'Not a valid id', '--json'], root)
  assert.equal(result.status, 1)
  const envelope = JSON.parse(result.stdout)
  assert.equal(envelope.error.code, 'INVALID_MANIFEST')
  assert.equal(envelope.error.field, 'id')
  await assert.rejects(() => lstat(path.join(root, 'bad-starter')))
  assert.deepEqual(await readdir(root), [])
})

test('create rejects a minimum host version newer than the selected host and leaves no target', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'webtools-plugin-create-minhost-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const result = run(['create', 'future-only', '--host-version', '0.1.0', '--min-host-version', '9.0.0', '--json'], root)
  assert.equal(result.status, 1)
  const envelope = JSON.parse(result.stdout)
  assert.equal(envelope.error.code, 'INCOMPATIBLE_PLUGIN')
  assert.equal(envelope.error.field, 'api.minHostVersion')
  await assert.rejects(() => lstat(path.join(root, 'future-only')))
})
