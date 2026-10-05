import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  assertVersionContract,
  assertSourceStateAllowed,
  createArtifactManifest,
  createBuildInfo,
  createReleaseDirectoryName,
  parseProductVersion,
  readVersionContract,
  resolveReleaseArtifactDirectory,
  validateReleaseChannel,
  verifyArtifactManifest,
  verifyBuildInfo,
} from './release-contract.mjs'

test('product version parser accepts SemVer and derives the Windows file version', () => {
  assert.deepEqual(parseProductVersion('0.1.0'), {
    version: '0.1.0', major: 0, minor: 1, patch: 0, prerelease: '', build: '',
    windowsFileVersion: '0.1.0.0',
  })
  assert.equal(parseProductVersion('2.4.8-rc.2+build.17').version, '2.4.8-rc.2+build.17')
})

test('product version parser rejects invalid or unsafe SemVer input', () => {
  for (const input of ['01.2.3', '1.2', '1.2.3/../../out', '1.2.3\\bad', '1.2.3-', '1.2.3+']) {
    assert.throws(() => parseProductVersion(input), { code: 'INVALID_PRODUCT_VERSION' }, input)
  }
  assert.throws(() => parseProductVersion('65536.0.0'), { code: 'WINDOWS_VERSION_RANGE' })
})

test('component versions derive from product version while plugin contract versions stay independent', () => {
  const contract = assertVersionContract({
    productVersion: '0.1.0', managerVersion: '0.1.0', nativeHostVersion: '0.1.0',
    updateHelperVersion: '0.1.0', installerVersion: '0.1.0', pluginApiMajor: 1,
    manifestVersion: 1, pluginSdkVersion: '1.0.0',
  })
  assert.notEqual(contract.pluginApiMajor, contract.productVersion)
  assert.notEqual(contract.manifestVersion, contract.productVersion)
  assert.throws(() => assertVersionContract({
    productVersion: '0.1.0', managerVersion: '0.1.0', nativeHostVersion: '1.0.0',
    updateHelperVersion: '0.1.0', installerVersion: '0.1.0', pluginApiMajor: 1,
    manifestVersion: 1, pluginSdkVersion: '1.0.0',
  }), { code: 'VERSION_DRIFT' })
})

test('repository version contract reads the canonical product and independent plugin versions', async () => {
  const contract = await readVersionContract(process.cwd())
  assert.equal(contract.productVersion, '0.1.0')
  assert.equal(contract.pluginApiMajor, 1)
  assert.equal(contract.manifestVersion, 1)
  assert.equal(contract.pluginSdkVersion, '1.0.0')
  assert.notEqual(contract.pluginApiMajor, contract.productVersion)
  assert.notEqual(contract.manifestVersion, contract.productVersion)
})

test('Windows package derives NativeHost, UpdateHelper and NSIS versions from the product manifest', async () => {
  const [buildScript, nsi, coverInstall, nativeProject, updaterProject, mainProcess] = await Promise.all([
    readFile('scripts/build-native-production.ps1', 'utf8'),
    readFile('scripts/native-production.nsi', 'utf8'),
    readFile('scripts/verify-cover-install.mjs', 'utf8'),
    readFile('native/WebTools.NativeHost/WebTools.NativeHost.csproj', 'utf8'),
    readFile('native/WebTools.UpdateHelper/WebTools.UpdateHelper.csproj', 'utf8'),
    readFile('electron/main.ts', 'utf8'),
  ])
  assert.match(buildScript, /ConvertFrom-Json/)
  assert.match(buildScript, /-p:Version=\$productVersion/)
  assert.match(buildScript, /-p:AssemblyVersion=\$windowsFileVersion/)
  assert.match(buildScript, /-p:FileVersion=\$windowsFileVersion/)
  assert.match(buildScript, /-p:IncludeSourceRevisionInInformationalVersion=false/)
  assert.match(buildScript, /WEBTOOLS_PRODUCT_VERSION/)
  assert.match(buildScript, /WEBTOOLS_FILE_VERSION/)
  assert.match(buildScript, /WEBTOOLS_CHANNEL/)
  assert.match(buildScript, /\$managerVersionForms = @\("\$major\.\$minor\.\$patch", \$windowsFileVersion\)/)
  assert.match(buildScript, /\$managerVersion\.FileVersion -notin \$managerVersionForms/)
  assert.match(buildScript, /\$managerVersion\.ProductVersion -notin \$managerVersionForms/)
  assert.match(nsi, /OutFile .*WEBTOOLS_PRODUCT_VERSION.*WEBTOOLS_CHANNEL/)
  assert.match(nsi, /VIProductVersion .*WEBTOOLS_FILE_VERSION/)
  assert.match(nsi, /VIAddVersionKey \/LANG=2052 "ProductVersion"/)
  assert.match(nsi, /VIAddVersionKey \/LANG=2052 "FileVersion"/)
  assert.match(nsi, /"DisplayVersion" "\$\{WEBTOOLS_PRODUCT_VERSION\}"/)
  assert.doesNotMatch(nsi, /WebTools-Setup-0\.1\.0\.exe/)
  assert.match(coverInstall, /WEBTOOLS_PRODUCT_VERSION/)
  assert.match(coverInstall, /WEBTOOLS_FILE_VERSION/)
  assert.match(coverInstall, /WEBTOOLS_CHANNEL/)
  assert.doesNotMatch(nativeProject, /<Version>|<AssemblyVersion>|<FileVersion>/)
  assert.doesNotMatch(updaterProject, /<Version>|<AssemblyVersion>|<FileVersion>/)
  assert.match(mainProcess, /IPC_CHANNELS\.getVersion, \(\) => app\.getVersion\(\)/)
})

test('release channels accept only the declared stable and beta values', () => {
  assert.equal(validateReleaseChannel('stable'), 'stable')
  assert.equal(validateReleaseChannel('beta'), 'beta')
  for (const channel of ['dev', 'Stable', '../stable', 'stable;whoami']) {
    assert.throws(() => validateReleaseChannel(channel), { code: 'INVALID_RELEASE_CHANNEL' })
  }
})

test('dirty release builds require explicit beta development mode and cannot be RC eligible', () => {
  assert.doesNotThrow(() => assertSourceStateAllowed({ sourceDirty: false, allowDirty: false, channel: 'stable' }))
  assert.throws(() => assertSourceStateAllowed({ sourceDirty: true, allowDirty: false, channel: 'beta' }), { code: 'DIRTY_SOURCE' })
  assert.throws(() => assertSourceStateAllowed({ sourceDirty: true, allowDirty: true, channel: 'stable' }), { code: 'DIRTY_STABLE_BUILD' })
  assert.doesNotThrow(() => assertSourceStateAllowed({ sourceDirty: true, allowDirty: true, channel: 'beta' }))
})

test('build metadata distinguishes a dirty development build from a release candidate', () => {
  const clean = createBuildInfo({
    productVersion: '0.1.0', gitCommit: 'a'.repeat(40), sourceDirty: false,
    buildTimestampUtc: '2026-10-06T00:00:00.000Z', channel: 'beta', platform: 'win32', arch: 'x64',
    pluginApiMajor: 1, manifestVersion: 1, pluginSdkVersion: '1.0.0',
  })
  assert.equal(clean.releaseCandidateEligible, true)
  assert.equal(clean.signing.status, 'unsigned')
  const dirty = createBuildInfo({
    productVersion: '0.1.0', gitCommit: 'b'.repeat(40), sourceDirty: true,
    buildTimestampUtc: '2026-10-06T00:00:00.000Z', channel: 'beta', platform: 'win32', arch: 'x64',
    pluginApiMajor: 1, manifestVersion: 1, pluginSdkVersion: '1.0.0',
  })
  assert.equal(dirty.sourceDirty, true)
  assert.equal(dirty.releaseCandidateEligible, false)
  assert.equal(dirty.channel, 'beta')
  assert.equal(JSON.stringify(dirty).includes('C:\\Users'), false)
  assert.equal(JSON.stringify(dirty).includes('zry'), false)
  assert.equal(verifyBuildInfo(clean), true)
  assert.equal(verifyBuildInfo(dirty), true)
  assert.throws(() => verifyBuildInfo({ ...dirty, releaseCandidateEligible: true }), { code: 'INVALID_BUILD_METADATA' })
  assert.throws(() => verifyBuildInfo({ ...clean, localPath: 'C:\\Users\\zry' }), { code: 'INVALID_BUILD_METADATA' })
})

test('dirty output identity is unique and remains a safe release directory name', () => {
  const name = createReleaseDirectoryName({
    productVersion: '0.1.0-rc.1', channel: 'beta', gitCommit: 'c'.repeat(40),
    sourceDirty: true, buildTimestampUtc: '2026-10-06T00:00:00.000Z',
  })
  assert.equal(name, 'WebTools-0.1.0-rc.1-beta-cccccccccccc-dirty-20261006T000000000Z')
  assert.equal(name.includes('..'), false)
  assert.throws(() => createReleaseDirectoryName({
    productVersion: '../escape', channel: 'stable', gitCommit: 'c'.repeat(40),
    sourceDirty: false, buildTimestampUtc: '2026-10-06T00:00:00.000Z',
  }), { code: 'INVALID_PRODUCT_VERSION' })
})

test('release output is generated below the repository release directory', () => {
  const output = resolveReleaseArtifactDirectory('D:/workspace/WebTools', {
    productVersion: '0.1.0', channel: 'beta', gitCommit: 'd'.repeat(40), sourceDirty: false,
    buildTimestampUtc: '2026-10-06T00:00:00.000Z',
  })
  assert.match(output.replaceAll('\\', '/'), /^D:\/workspace\/WebTools\/release\/WebTools-0\.1\.0-beta-dddddddddddd$/)
})

test('artifact manifest generation sorts safe relative paths and verification detects changes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'webtools-release-manifest-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'installer'))
  await mkdir(join(root, 'components'))
  await writeFile(join(root, 'installer', 'setup.exe'), 'installer bytes')
  await writeFile(join(root, 'components', 'native.dll'), 'native bytes')
  const identity = { productVersion: '0.1.0', buildId: '0.1.0-beta-abcdef123456' }
  const manifest = await createArtifactManifest(root, ['components/native.dll', 'installer/setup.exe'], identity)
  assert.deepEqual(manifest.artifacts.map(item => item.relativePath), ['components/native.dll', 'installer/setup.exe'])
  assert.match(manifest.artifacts[0].sha256, /^[a-f0-9]{64}$/)
  await verifyArtifactManifest(root, manifest)
  await writeFile(join(root, 'components', 'native.dll'), 'mutate bytes')
  await assert.rejects(() => verifyArtifactManifest(root, manifest), { code: 'ARTIFACT_HASH_MISMATCH' })
})

test('artifact manifest rejects missing files, duplicate paths and traversal paths', async t => {
  const root = await mkdtemp(join(tmpdir(), 'webtools-release-unsafe-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'file.exe'), 'payload')
  const identity = { productVersion: '0.1.0', buildId: 'build' }
  await assert.rejects(() => createArtifactManifest(root, ['missing.exe'], identity), { code: 'ARTIFACT_MISSING' })
  await assert.rejects(() => createArtifactManifest(root, ['file.exe', 'FILE.exe'], identity), { code: 'DUPLICATE_ARTIFACT_PATH' })
  for (const unsafe of ['../file.exe', 'C:/file.exe', 'folder\\file.exe', './file.exe', '', 'NUL.txt', 'bad?.exe', 'trailing. ']) {
    await assert.rejects(() => createArtifactManifest(root, [unsafe], identity), { code: 'UNSAFE_ARTIFACT_PATH' }, unsafe)
  }
})

test('artifact verifier rejects missing payloads and unsafe manifest paths', async t => {
  const root = await mkdtemp(join(tmpdir(), 'webtools-release-verify-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const base = { schemaVersion: 1, productVersion: '0.1.0', buildId: 'build', artifacts: [] }
  await assert.rejects(() => verifyArtifactManifest(root, {
    ...base, artifacts: [{ relativePath: 'missing.exe', size: 1, sha256: 'a'.repeat(64) }],
  }), { code: 'ARTIFACT_MISSING' })
  await assert.rejects(() => verifyArtifactManifest(root, {
    ...base, artifacts: [{ relativePath: '../outside.exe', size: 1, sha256: 'a'.repeat(64) }],
  }), { code: 'UNSAFE_ARTIFACT_PATH' })
  await assert.rejects(() => verifyArtifactManifest(root, {
    ...base, unexpected: 'field',
  }), { code: 'INVALID_ARTIFACT_MANIFEST' })
})
