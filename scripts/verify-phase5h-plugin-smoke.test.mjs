import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parsePhase5hSmokeArgs, runPhase5hSmoke, validatePhase5hSmokeLayout } from './verify-phase5h-plugin-smoke.mjs'

test('Phase 5H smoke requires the exact four isolated build inputs', () => {
  assert.deepEqual(parsePhase5hSmokeArgs(['a', 'b', 'c', 'd']), { root: 'a', nativeSource: 'b', managerRoot: 'c', pluginPackage: 'd', managerCycles: 0 })
  assert.deepEqual(parsePhase5hSmokeArgs(['a', 'b', 'c', 'd', '--phase5i-manager-cycles=10']), { root: 'a', nativeSource: 'b', managerRoot: 'c', pluginPackage: 'd', managerCycles: 10 })
  assert.throws(() => parsePhase5hSmokeArgs(['a', 'b', 'c']), /four/)
  assert.throws(() => parsePhase5hSmokeArgs(['a', 'b', 'c', 'd', '--phase5i-manager-cycles=9']), /exactly 10/)
  assert.throws(() => parsePhase5hSmokeArgs(['a', 'b', 'c', 'd', '--phase5i-manager-cycles=11']), /exactly 10/)
  assert.throws(() => parsePhase5hSmokeArgs(['a', 'b', 'c', 'd', '--phase5i-manager-cycles=no']), /exactly 10/)
  assert.throws(() => parsePhase5hSmokeArgs(['a', 'b', 'c', 'd', 'e']), /exactly 10/)
})

test('Phase 5I smoke runner refuses an unbounded or alternate cycle count before touching files', async () => {
  await assert.rejects(runPhase5hSmoke({ managerCycles: 9 }), /exactly 10/)
  await assert.rejects(runPhase5hSmoke({ managerCycles: 1000 }), /exactly 10/)
})

test('Phase 5H smoke accepts only a temp profile, isolated Manager, repository Release NativeHost and package inside that profile', async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'webtools-phase5h-smoke-test-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const root = path.join(temp, 'acceptance')
  const nativeSource = path.join(process.cwd(), 'release', 'phase5h-test-native')
  const managerRoot = path.join(temp, 'manager-build', 'win-unpacked')
  const packagePath = path.join(root, 'private-notes.wtplugin')
  await Promise.all([mkdir(root), mkdir(nativeSource, { recursive: true }), mkdir(managerRoot, { recursive: true })])
  await Promise.all([
    writeFile(path.join(nativeSource, 'WebTools.NativeHost.exe'), 'test'),
    writeFile(path.join(managerRoot, 'WebTools.exe'), 'test'),
    writeFile(packagePath, 'test'),
  ])
  const result = validatePhase5hSmokeLayout({ root, nativeSource, managerRoot, pluginPackage: packagePath, repo: process.cwd() })
  assert.equal(result.root, path.resolve(root))
  assert.equal(result.pluginPackage, path.resolve(packagePath))
  assert.throws(() => validatePhase5hSmokeLayout({ root, nativeSource, managerRoot: path.join('D:\\webtools', 'Manager', 'win-unpacked'), pluginPackage: packagePath, repo: process.cwd() }), /temporary directory|isolated temp/)
  assert.throws(() => validatePhase5hSmokeLayout({ root, nativeSource, managerRoot, pluginPackage: path.join(os.tmpdir(), 'outside.wtplugin'), repo: process.cwd() }), /inside the evidence root/)
})
