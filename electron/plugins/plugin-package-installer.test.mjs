import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ManagedFs } from './managed-fs.ts'
import { materializeRuntimePackage, verifyMaterializedRuntimePackage } from './plugin-package-installer.ts'

test('runtime materialization stages validated files and verifies exact content-addressed inventory', async t => {
  const root = await mkdtemp(join(tmpdir(), 'webtools-v3-materialize-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fs = new ManagedFs(join(root, 'plugins'))
  await fs.initialize()
  const inventory = [
    { path: 'web/index.html', role: 'web', mediaType: 'text/html' },
    { path: 'node_modules/pkg/package.json', role: 'dependency', mediaType: 'application/json', dependency: 'pkg' },
  ]
  const resources = [
    { canonicalPath: 'web/index.html', mimeType: 'text/html', size: Buffer.byteLength('<html>v3</html>'), bytes: Buffer.from('<html>v3</html>') },
    { canonicalPath: 'node_modules/pkg/package.json', mimeType: 'application/json', size: Buffer.byteLength('{"name":"pkg"}'), bytes: Buffer.from('{"name":"pkg"}') },
  ]
  const target = 'runtime/org.example.demo/1.0.0/abcdef'
  const committed = await materializeRuntimePackage(fs, target, inventory, resources, () => true)
  assert.deepEqual(committed, { created: true })
  await verifyMaterializedRuntimePackage(fs, target, inventory, resources)
  assert.equal((await readFile(join(root, 'plugins', 'runtime', 'org.example.demo', '1.0.0', 'abcdef', 'web', 'index.html'))).toString(), '<html>v3</html>')
  assert.deepEqual(await readdir(join(root, 'plugins', 'staging')), [])
})

test('runtime materialization creates shared inventory directories once instead of rescanning them per file', async t => {
  const root = await mkdtemp(join(tmpdir(), 'webtools-v3-materialize-dir-cost-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fs = new ManagedFs(join(root, 'plugins'))
  await fs.initialize()
  const inventory = ['web/a.js', 'web/b.js', 'web/c.js'].map(path => ({ path, role: 'web', mediaType: 'text/javascript' }))
  const resources = inventory.map(item => ({ canonicalPath: item.path, mimeType: item.mediaType, size: 2, bytes: Buffer.from('ok') }))
  let mkdirCalls = 0
  const mkdir = fs.mkdir.bind(fs)
  fs.mkdir = async logical => { mkdirCalls++; await mkdir(logical) }

  await materializeRuntimePackage(fs, 'runtime/org.example.materialize-cost/1.0.0/abcdef', inventory, resources, () => true)

  assert.equal(mkdirCalls, 3, 'create stage root, shared web directory once, and destination parent once')
})

test('runtime materialization refuses tampering, undeclared files and superseded install intents', async t => {
  const root = await mkdtemp(join(tmpdir(), 'webtools-v3-integrity-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fs = new ManagedFs(join(root, 'plugins'))
  await fs.initialize()
  const inventory = [{ path: 'web/index.html', role: 'web', mediaType: 'text/html' }]
  const resources = [{ canonicalPath: 'web/index.html', mimeType: 'text/html', size: Buffer.byteLength('<html/>hello'), bytes: Buffer.from('<html/>hello') }]
  const target = 'runtime/org.example.demo/1.0.0/abcdef'
  await assert.rejects(() => materializeRuntimePackage(fs, target, inventory, resources, () => false), error => error.code === 'INTENT_SUPERSEDED')
  await assert.rejects(() => readFile(join(root, 'plugins', target, 'web', 'index.html')), { code: 'ENOENT' })
  assert.deepEqual(await readdir(join(root, 'plugins', 'staging')), [])
  await materializeRuntimePackage(fs, target, inventory, resources, () => true)
  await writeFile(join(root, 'plugins', target, 'web', 'index.html'), '<html/>tampered')
  await assert.rejects(() => verifyMaterializedRuntimePackage(fs, target, inventory, resources), error => error.code === 'INTEGRITY_FAILED')
  await writeFile(join(root, 'plugins', target, 'web', 'extra.js'), 'unexpected')
  await assert.rejects(() => verifyMaterializedRuntimePackage(fs, target, inventory, resources), error => error.code === 'INTEGRITY_FAILED')
})

test('runtime materialization accepts valid near-limit package paths with host staging prefixes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'webtools-v3-long-materialize-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fs = new ManagedFs(join(root, 'plugins'))
  await fs.initialize()
  const path = `runtime/${'a'.repeat(180)}/index.html`
  const bytes = Buffer.from('<html>long path</html>')
  const inventory = [{ path, role: 'web', mediaType: 'text/html' }]
  const resources = [{ canonicalPath: path, mimeType: 'text/html', size: bytes.length, bytes }]
  const target = 'runtime/org.example.long/1.0.0/abcdef'

  assert.ok(path.length <= 240, 'the declared archive path remains within the supported package limit')
  const result = await materializeRuntimePackage(fs, target, inventory, resources, () => true)
  assert.deepEqual(result, { created: true })
  await verifyMaterializedRuntimePackage(fs, target, inventory, resources)
  assert.deepEqual(await readdir(join(root, 'plugins', 'staging')), [])
})

test('runtime verification does not re-walk managed-root ancestry for every inventory file', async t => {
  const root = await mkdtemp(join(tmpdir(), 'webtools-v3-verification-cost-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fs = new ManagedFs(join(root, 'plugins'))
  await fs.initialize()
  const inventory = [
    { path: 'web/index.html', role: 'web', mediaType: 'text/html' },
    { path: 'node_modules/pkg/index.js', role: 'dependency', mediaType: 'text/javascript', dependency: 'pkg' },
  ]
  const resources = [
    { canonicalPath: 'web/index.html', mimeType: 'text/html', size: 7, bytes: Buffer.from('<html/>') },
    { canonicalPath: 'node_modules/pkg/index.js', mimeType: 'text/javascript', size: 14, bytes: Buffer.from('module.exports') },
  ]
  const target = 'runtime/org.example.verification-cost/1.0.0/abcdef'
  await materializeRuntimePackage(fs, target, inventory, resources, () => true)

  let safePathChecks = 0
  const assertSafe = fs.assertSafe.bind(fs)
  fs.assertSafe = async path => { safePathChecks++; await assertSafe(path) }
  await verifyMaterializedRuntimePackage(fs, target, inventory, resources)

  assert.ok(safePathChecks <= 1, `validate the package root once instead of re-walking its ancestors per file; got ${safePathChecks} checks`)
})

test('runtime verification rejects a junction that redirects a package directory outside its snapshot root', async t => {
  const root = await mkdtemp(join(tmpdir(), 'webtools-v3-junction-integrity-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fs = new ManagedFs(join(root, 'plugins'))
  await fs.initialize()
  const bytes = Buffer.from('<html>approved</html>')
  const inventory = [{ path: 'web/index.html', role: 'web', mediaType: 'text/html' }]
  const resources = [{ canonicalPath: 'web/index.html', mimeType: 'text/html', size: bytes.length, bytes }]
  const target = 'runtime/org.example.junction/1.0.0/abcdef'
  await materializeRuntimePackage(fs, target, inventory, resources, () => true)

  const external = join(root, 'external')
  await mkdir(external)
  await writeFile(join(external, 'index.html'), bytes)
  const webDirectory = join(root, 'plugins', target, 'web')
  await rm(webDirectory, { recursive: true })
  try { await symlink(external, webDirectory, 'junction') }
  catch (error) {
    if (error.code === 'EPERM' || error.code === 'ENOTSUP') { t.skip('Windows did not allow creating a test junction'); return }
    throw error
  }

  await assert.rejects(() => verifyMaterializedRuntimePackage(fs, target, inventory, resources), error => error.code === 'UNSAFE_PATH')
})
