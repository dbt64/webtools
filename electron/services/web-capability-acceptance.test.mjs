import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveWebCapabilityAcceptanceOptions } from './web-capability-acceptance.ts'
test('capability effect seams require explicit dual flags, a packaged TEMP executable and the validated isolated profile', async t => {
  const root = await mkdtemp(join(tmpdir(), 'webtools-capability-guards-')); t.after(() => rm(root, { recursive: true, force: true }))
  const profile = join(root, 'profile'); const install = join(root, 'manager'); await mkdir(profile); await mkdir(install)
  const exe = join(install, 'WebTools.exe'); const archive = join(root, 'phase6e4b-runtime-fixture.wtplugin')
  await writeFile(exe, 'test'); await writeFile(archive, 'test')
  const argv = ['--phase6e4b-web-runtime-acceptance', '--phase6e6-capability-acceptance']
  const env = { WEBTOOLS_WEB_RUNTIME_ACCEPTANCE: '1', WEBTOOLS_PHASE6E6_ACCEPTANCE: '1', WEBTOOLS_WEB_RUNTIME_TEST_PROFILE: profile, WEBTOOLS_WEB_RUNTIME_TEST_PACKAGE: archive }
  const guards = { packaged: true, executable: exe, userDataPath: profile, userProfilePath: join(root, 'protected-user'), installRoot: install }
  assert.equal(resolveWebCapabilityAcceptanceOptions([], env, guards), null)
  assert.equal(resolveWebCapabilityAcceptanceOptions(argv, {}, guards), null)
  assert.ok(resolveWebCapabilityAcceptanceOptions(argv, env, guards))
  assert.throws(() => resolveWebCapabilityAcceptanceOptions(argv, env, { ...guards, packaged: false }))
  assert.throws(() => resolveWebCapabilityAcceptanceOptions(argv, env, { ...guards, executable: 'D:\\webtools\\Manager\\WebTools.exe' }))
  assert.throws(() => resolveWebCapabilityAcceptanceOptions(argv, env, { ...guards, userDataPath: guards.userProfilePath }))
})
