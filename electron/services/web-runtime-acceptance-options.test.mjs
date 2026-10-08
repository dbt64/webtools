import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveWebRuntimeAcceptanceOptions } from './web-runtime-acceptance-options.ts'

test('Phase 6E-4B acceptance requires both explicit switches and isolated TEMP fixture/profile', async t => {
  const root = await mkdtemp(join(tmpdir(), 'webtools-6e4b-'))
  const profile = join(root, 'profile')
  const packagePath = join(root, 'phase6e4b-runtime-fixture.wtplugin')
  await mkdir(profile)
  await writeFile(packagePath, Buffer.from('test fixture bytes'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const env = { WEBTOOLS_WEB_RUNTIME_ACCEPTANCE: '1', WEBTOOLS_WEB_RUNTIME_TEST_PROFILE: profile, WEBTOOLS_WEB_RUNTIME_TEST_PACKAGE: packagePath }
  assert.equal(resolveWebRuntimeAcceptanceOptions(['app'], env, { userProfilePath: join(root, 'production-profile') }), null)
  assert.equal(resolveWebRuntimeAcceptanceOptions(['app', '--phase6e4b-web-runtime-acceptance'], env, { userProfilePath: join(root, 'production-profile') }).profilePath, profile)
  assert.throws(() => resolveWebRuntimeAcceptanceOptions(['app', '--phase6e4b-web-runtime-acceptance'], { ...env, WEBTOOLS_WEB_RUNTIME_TEST_PACKAGE: join(root, 'arbitrary.wtplugin') }, { userProfilePath: join(root, 'production-profile') }), /fixed runtime fixture filename/)
  assert.throws(() => resolveWebRuntimeAcceptanceOptions(['app', '--phase6e4b-web-runtime-acceptance'], { ...env, WEBTOOLS_WEB_RUNTIME_TEST_PROFILE: join(root, 'profile', 'nested') }, { userProfilePath: join(root, 'production-profile') }), /already exist|existing directory|non-directory/i)
})

test('Phase 6E-4B acceptance rejects fixture paths inside the disposable profile', async t => {
  const root = await mkdtemp(join(tmpdir(), 'webtools-6e4b-'))
  const profile = join(root, 'profile')
  await mkdir(profile)
  const packagePath = join(profile, 'phase6e4b-runtime-fixture.wtplugin')
  await writeFile(packagePath, Buffer.from('test fixture bytes'))
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.throws(() => resolveWebRuntimeAcceptanceOptions(['app', '--phase6e4b-web-runtime-acceptance'], {
    WEBTOOLS_WEB_RUNTIME_ACCEPTANCE: '1', WEBTOOLS_WEB_RUNTIME_TEST_PROFILE: profile, WEBTOOLS_WEB_RUNTIME_TEST_PACKAGE: packagePath,
  }, { userProfilePath: join(root, 'production-profile') }), /outside the profile|overlap/i)
})
