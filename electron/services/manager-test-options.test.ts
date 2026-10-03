import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

const pipe = 'WebTools.NativeHost.Manager.v1.Phase4E.G3Acceptance123'

test('Manager test profile accepts only an explicit isolated profile inside TEMP', async t => {
  const module = await import('./manager-test-options.ts')
  const resolve = module.resolveManagerTestProfile
  const root = mkdtempSync(join(tmpdir(), 'webtools-manager-profile-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const profile = join(root, 'profile')
  mkdirSync(profile)
  const userProfile = join(process.env.APPDATA ?? root, 'Nook')
  const installRoot = join(root, 'installed-app')
  mkdirSync(installRoot)
  const options = { userProfilePath: userProfile, installRoot }
  const env = { WEBTOOLS_MANAGER_TEST_PROFILE: profile, WEBTOOLS_NATIVE_PIPE: pipe, WEBTOOLS_MANAGER_ONLY: '1' }

  assert.equal(resolve([], env, options), undefined, 'Normal launches ignore test-only values')
  assert.throws(() => resolve(['--phase4g-manager-test'], { ...env, WEBTOOLS_MANAGER_ONLY: undefined }, options), /Manager-only/i)
  assert.equal(resolve(['--phase4g-manager-test'], env, options), realpathSync.native(profile))
  assert.throws(() => resolve(['--phase4g-manager-test'], { ...env, WEBTOOLS_MANAGER_TEST_PROFILE: 'relative' }, options), /absolute/i)
  assert.throws(() => resolve(['--phase4g-manager-test'], { ...env, WEBTOOLS_MANAGER_TEST_PROFILE: join(root, 'missing') }, options), /resolve|exist|directory/i)
  assert.throws(() => resolve(['--phase4g-manager-test'], { ...env, WEBTOOLS_MANAGER_TEST_PROFILE: tmpdir() }, options), /profile|directory/i)
  assert.throws(() => resolve(['--phase4g-manager-test'], { ...env, WEBTOOLS_MANAGER_TEST_PROFILE: join(tmpdir(), '..', `${dirname(tmpdir()).split(/[\\/]/).pop()}-outside`, 'profile') }, options), /temporary|TEMP/i)
  assert.throws(() => resolve(['--phase4g-manager-test'], { ...env, WEBTOOLS_MANAGER_TEST_PROFILE: userProfile }, options), /real user profile/i)
  assert.throws(() => resolve(['--phase4g-manager-test'], { ...env, WEBTOOLS_MANAGER_TEST_PROFILE: installRoot }, options), /application install directory/i)
  assert.throws(() => resolve(['--phase4g-manager-test'], { ...env, WEBTOOLS_MANAGER_TEST_PROFILE: join(installRoot, 'nested-profile') }, options), /application install directory/i)
  assert.throws(() => resolve(['--phase4g-manager-test'], { ...env, WEBTOOLS_NATIVE_PIPE: 'WebTools.NativeHost.Manager.v1' }, options), /pipe/i)
  assert.throws(() => resolve(['--phase4g-manager-test'], {
    WEBTOOLS_MANAGER_TEST_PROFILE: profile,
    WEBTOOLS_MANAGER_ONLY: '1',
  }, options), /pipe/i)
})

test('Manager test profile rejects a junction that resolves outside TEMP', async t => {
  if (process.platform !== 'win32') {
    t.skip('Windows junction/reparse-point behavior is verified on Windows')
    return
  }
  const module = await import('./manager-test-options.ts')
  const root = mkdtempSync(join(tmpdir(), 'webtools-manager-junction-'))
  const protectedRoot = join(process.env.APPDATA ?? dirname(tmpdir()), 'Nook')
  if (!existsSync(protectedRoot)) {
    rmSync(root, { recursive: true, force: true })
    t.skip('The real Nook profile is absent, so a junction-to-profile escape cannot be exercised on this host')
    return
  }
  const junction = join(root, 'profile-junction')
  t.after(() => {
    try { unlinkSync(junction) } catch { /* Link may not have been created. */ }
    rmSync(root, { recursive: true, force: true })
  })
  symlinkSync(protectedRoot, junction, 'junction')

  assert.throws(() => module.resolveManagerTestProfile(
    ['--phase4g-manager-test'],
    {
      WEBTOOLS_MANAGER_TEST_PROFILE: junction,
      WEBTOOLS_NATIVE_PIPE: pipe,
      WEBTOOLS_MANAGER_ONLY: '1',
    },
    { userProfilePath: protectedRoot, installRoot: join(root, 'install') },
  ), /junction|reparse|temporary|profile/i)
})
