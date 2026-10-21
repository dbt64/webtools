import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolvePluginRuntimeAcceptanceOptions } from './plugin-runtime-acceptance-options.ts'
import { createPluginRuntimeAcceptanceHostOverrides, PLUGIN_RUNTIME_ACCEPTANCE_ID, PLUGIN_RUNTIME_ACCEPTANCE_ISOLATION_ID } from './plugin-runtime-acceptance.ts'

test('isolated development chooser permits only its fixed canonical project and confirmed fixture identity', async t => {
  const env = await fixture(t)
  const options = resolvePluginRuntimeAcceptanceOptions(['--plugin-runtime-acceptance'], env.env, env.guards)
  const host = createPluginRuntimeAcceptanceHostOverrides(options)
  assert.throws(() => host.chooseDevelopmentProject(), /ENOENT|project/i)
  const project = join(env.root, 'author'); await mkdir(project)
  await writeFile(join(project, 'manifest.json'), JSON.stringify({ id: PLUGIN_RUNTIME_ACCEPTANCE_ID }))
  assert.equal(await host.chooseDevelopmentProject(), project)
  assert.equal(host.confirmDevelopmentProject({ manifest: { id: PLUGIN_RUNTIME_ACCEPTANCE_ID } }), true)
  assert.equal(host.confirmDevelopmentProject({ manifest: { id: 'org.example.unrelated' } }), false)
  await writeFile(join(project, 'manifest.json'), JSON.stringify({ id: 'org.example.unrelated' }))
  assert.throws(() => host.chooseDevelopmentProject(), /identity/i)
})

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'webtools-plugin-runtime-acceptance-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const profile = join(root, 'profile'); const packageRoot = join(root, 'fixtures'); const appRoot = join(root, 'manager')
  const protectedProfile = join(root, 'real-Nook'); const protectedInstall = join(root, 'real-install')
  await Promise.all([mkdir(profile), mkdir(packageRoot), mkdir(appRoot), mkdir(protectedProfile), mkdir(protectedInstall)])
  const managerExe = join(appRoot, 'WebTools.exe')
  await writeFile(managerExe, 'test executable')
  const packagePath = join(packageRoot, 'plugin-runtime-fixture.wtplugin')
  const updatePath = join(packageRoot, 'plugin-runtime-update.wtplugin')
  const isolationPath = join(packageRoot, 'plugin-runtime-isolation.wtplugin')
  await Promise.all([writeFile(packagePath, 'fixture'), writeFile(updatePath, 'update'), writeFile(isolationPath, 'isolation')])
  const env = { WEBTOOLS_PLUGIN_RUNTIME_ACCEPTANCE: '1', WEBTOOLS_PLUGIN_RUNTIME_TEST_ROOT: root,
    WEBTOOLS_PLUGIN_RUNTIME_TEST_PROFILE: profile, WEBTOOLS_PLUGIN_RUNTIME_TEST_DEBUG_PORT: '24689' }
  const guards = { packaged: true, executable: managerExe, userProfilePath: protectedProfile, installRoot: protectedInstall, userDataPath: profile }
  return { root, profile, packageRoot, appRoot, managerExe, packagePath, updatePath, isolationPath, env, guards }
}

test('packaged Plugin Runtime acceptance requires both explicit opt-ins and canonical TEMP paths', async t => {
  const env = await fixture(t)
  assert.equal(resolvePluginRuntimeAcceptanceOptions([], env.env, env.guards), null)
  const accepted = resolvePluginRuntimeAcceptanceOptions(['--plugin-runtime-acceptance'], env.env, env.guards)
  assert.equal(accepted.profilePath, env.profile)
  assert.equal(accepted.fixturePath, env.packagePath)
  assert.equal(accepted.updatePath, env.updatePath)
  assert.equal(accepted.isolationPath, env.isolationPath)
  assert.equal(accepted.debugPort, 24689)
  assert.throws(() => resolvePluginRuntimeAcceptanceOptions(['--plugin-runtime-acceptance'], { ...env.env, WEBTOOLS_PLUGIN_RUNTIME_TEST_PROFILE: join(env.root, 'missing') }, env.guards), /ENOENT|existing|directory/i)
  assert.throws(() => resolvePluginRuntimeAcceptanceOptions(['--plugin-runtime-acceptance'], { ...env.env, WEBTOOLS_PLUGIN_RUNTIME_TEST_DEBUG_PORT: '80' }, env.guards), /port/i)
})

test('packaged Plugin Runtime acceptance rejects a production/non-TEMP executable or profile overlap', async t => {
  const env = await fixture(t)
  assert.throws(() => resolvePluginRuntimeAcceptanceOptions(['--plugin-runtime-acceptance'], env.env,
    { ...env.guards, executable: join(env.root, '..', '..', 'WebTools.exe') }), /TEMP|temporary|packaged/i)
  assert.throws(() => resolvePluginRuntimeAcceptanceOptions(['--plugin-runtime-acceptance'], env.env,
    { ...env.guards, userDataPath: join(env.root, 'wrong-profile') }), /profile/i)
  assert.throws(() => resolvePluginRuntimeAcceptanceOptions(['--plugin-runtime-acceptance'],
    { ...env.env, WEBTOOLS_PLUGIN_RUNTIME_TEST_PROFILE: env.guards.userProfilePath }, env.guards), /overlap|profile/i)
})

test('packaged Plugin Runtime acceptance rejects fixture reparse points and partial opt-in', async t => {
  const env = await fixture(t)
  await rm(env.packagePath)
  await mkdir(env.packagePath)
  assert.throws(() => resolvePluginRuntimeAcceptanceOptions(['--plugin-runtime-acceptance'], env.env, env.guards), /regular|link|fixture/i)
  assert.throws(() => resolvePluginRuntimeAcceptanceOptions(['--plugin-runtime-acceptance'], { ...env.env, WEBTOOLS_PLUGIN_RUNTIME_ACCEPTANCE: undefined }, env.guards), /both|acceptance/i)
})

test('Runtime 2.0 acceptance override is tied to validated options, fixed package choices, and isolated effects', async t => {
  const env = await fixture(t)
  const options = resolvePluginRuntimeAcceptanceOptions(['--plugin-runtime-acceptance'], env.env, env.guards)
  const host = createPluginRuntimeAcceptanceHostOverrides(options)
  const controls = join(env.profile, 'plugin-runtime-controls.json')
  await writeFile(controls, JSON.stringify({ package: 'fixture', deleteData: false }))
  assert.equal(Buffer.from(await host.choosePackage()).toString(), 'fixture')
  const confirm = request => host.confirm({ pluginId: PLUGIN_RUNTIME_ACCEPTANCE_ID, name: 'fixture', version: '1.0.0', kind: request })
  assert.equal(await confirm('delete-data'), false)
  assert.equal(await host.confirm({ pluginId: 'org.example.unrelated', kind: 'install' }), false)
  await writeFile(controls, JSON.stringify({ package: 'update', deleteData: true }))
  assert.equal(Buffer.from(await host.choosePackage()).toString(), 'update')
  assert.equal(await confirm('delete-data'), true)
  await writeFile(controls, JSON.stringify({ package: 'isolation', deleteData: false }))
  assert.equal(Buffer.from(await host.choosePackage()).toString(), 'isolation')
  assert.equal(await host.confirm({ pluginId: PLUGIN_RUNTIME_ACCEPTANCE_ISOLATION_ID, kind: 'install' }), true)
  host.webEffects.clipboardWrite('private clipboard text')
  assert.throws(() => createPluginRuntimeAcceptanceHostOverrides({ ...options }), /Unvalidated/)
  const effects = await readFile(join(env.profile, 'plugin-runtime-effects.json'), 'utf8')
  assert.equal(JSON.parse(effects).clipboardWriteCount, 1)
  assert.equal(effects.includes('private clipboard text'), false)
})

test('Runtime 2.0 acceptance records the exact Node runtime upgrade confirmation', async t => {
  const env = await fixture(t)
  const options = resolvePluginRuntimeAcceptanceOptions(['--plugin-runtime-acceptance'], env.env, env.guards)
  const host = createPluginRuntimeAcceptanceHostOverrides(options)
  await writeFile(join(env.profile, 'plugin-runtime-controls.json'), JSON.stringify({ package: 'update', deleteData: true }))

  assert.equal(await host.confirm({
    kind: 'install', pluginId: PLUGIN_RUNTIME_ACCEPTANCE_ID, name: 'fixture', version: '2.0.0', runtimeKind: 'node',
    versionChange: { kind: 'upgrade', currentVersion: '1.0.0', incomingVersion: '2.0.0', addedCapabilities: [], removedCapabilities: [], reauthorizationRequired: false },
  }), true)

  const effects = JSON.parse(await readFile(join(env.profile, 'plugin-runtime-effects.json'), 'utf8'))
  assert.deepEqual(effects.upgradeConfirmations, [{ pluginId: PLUGIN_RUNTIME_ACCEPTANCE_ID, currentVersion: '1.0.0', incomingVersion: '2.0.0', runtimeKind: 'node' }])
})

test('isolated config reset requires explicit approval for a fixed acceptance plugin without recording raw configuration', async t => {
  const env = await fixture(t)
  const options = resolvePluginRuntimeAcceptanceOptions(['--plugin-runtime-acceptance'], env.env, env.guards)
  const host = createPluginRuntimeAcceptanceHostOverrides(options)
  const controls = join(env.profile, 'plugin-runtime-controls.json')
  const request = { kind: 'reset-config', pluginId: PLUGIN_RUNTIME_ACCEPTANCE_ID, name: 'fixture', version: '1.0.0',
    preview: 'configuration-content-must-not-be-recorded' }

  await writeFile(controls, JSON.stringify({ package: 'fixture', deleteData: false }))
  assert.equal(await host.confirm(request), false)
  await writeFile(controls, JSON.stringify({ package: 'fixture', deleteData: false, resetConfig: false }))
  assert.equal(await host.confirm(request), false)
  await writeFile(controls, JSON.stringify({ package: 'fixture', deleteData: false, resetConfig: true }))
  assert.equal(await host.confirm(request), true)
  assert.equal(await host.confirm({ ...request, pluginId: PLUGIN_RUNTIME_ACCEPTANCE_ISOLATION_ID }), true)
  assert.equal(await host.confirm({ ...request, pluginId: 'org.example.unrelated' }), false)
  assert.equal(await host.confirm({ ...request, kind: 'delete-data' }), false)
  assert.equal(Buffer.from(await host.choosePackage()).toString(), 'fixture')

  const effects = await readFile(join(env.profile, 'plugin-runtime-effects.json'), 'utf8')
  assert.equal(JSON.parse(effects).confirmations.filter(kind => kind === 'reset-config').length, 4)
  assert.equal(effects.includes(request.preview), false)
})

test('isolated reset consent rejects malformed approval and unknown control fields', async t => {
  const env = await fixture(t)
  const options = resolvePluginRuntimeAcceptanceOptions(['--plugin-runtime-acceptance'], env.env, env.guards)
  const host = createPluginRuntimeAcceptanceHostOverrides(options)
  const controls = join(env.profile, 'plugin-runtime-controls.json')
  for (const resetConfig of ['true', 1, null, {}]) {
    await writeFile(controls, JSON.stringify({ package: 'fixture', deleteData: false, resetConfig }))
    await assert.rejects(() => host.confirm({ kind: 'reset-config', pluginId: PLUGIN_RUNTIME_ACCEPTANCE_ID }), /control file/i)
  }
  await writeFile(controls, JSON.stringify({ package: 'fixture', deleteData: false, resetConfig: true, approveAll: true }))
  await assert.rejects(() => host.choosePackage(), /control file/i)
})
