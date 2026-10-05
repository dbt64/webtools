import { spawn, spawnSync } from 'node:child_process'
import { copyFile, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, basename, join, relative, resolve, sep, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
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

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const releaseRoot = resolve(repositoryRoot, 'release')
const artifactPaths = Object.freeze([
  'components/native/WebTools.NativeHost.exe',
  'components/native/WebTools.NativeHost.dll',
  'components/update-helper/WebTools.UpdateHelper.exe',
  'components/manager/WebTools.exe',
  'components/manager/resources/app.asar',
])

class ReleaseCliError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

function command(executable, args, cwd = repositoryRoot) {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', windowsHide: true, shell: false })
  if (result.error) throw new ReleaseCliError('TOOL_UNAVAILABLE', `${executable} is unavailable.`)
  if (result.status !== 0) throw new ReleaseCliError('COMMAND_FAILED', `${executable} failed with exit code ${result.status}.`)
  return result.stdout.trim()
}

function runBuildProcess(executable, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, { cwd: repositoryRoot, windowsHide: true, stdio: 'inherit', shell: false })
    child.once('error', () => rejectPromise(new ReleaseCliError('BUILD_TOOL_FAILED', 'The release build process could not start.')))
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else rejectPromise(new ReleaseCliError('BUILD_FAILED', `Windows packaging failed (exit ${code ?? signal}).`))
    })
  })
}

function parseArguments(argv) {
  const [action, ...passedArgs] = argv
  const args = passedArgs[0] === '--' ? passedArgs.slice(1) : passedArgs
  if (!['build', 'preflight', 'verify'].includes(action)) {
    throw new ReleaseCliError('INVALID_COMMAND', 'Usage: release-build.mjs <build|preflight|verify> [--channel stable|beta] [--allow-dirty]')
  }
  let channel = 'stable'
  let allowDirty = false
  let target = ''
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--channel') {
      if (++i >= args.length) throw new ReleaseCliError('INVALID_ARGUMENT', '--channel requires stable or beta.')
      channel = validateReleaseChannel(args[i])
    } else if (arg === '--allow-dirty') {
      allowDirty = true
    } else if (!arg.startsWith('-') && action === 'verify' && !target) {
      target = arg
    } else {
      throw new ReleaseCliError('INVALID_ARGUMENT', `Unsupported release argument: ${arg}`)
    }
  }
  if (action === 'verify' && !target) throw new ReleaseCliError('INVALID_ARGUMENT', 'verify requires a release artifact directory.')
  if (action !== 'verify' && target) throw new ReleaseCliError('INVALID_ARGUMENT', 'A target path is accepted only by verify.')
  return { action, channel, allowDirty, target }
}

function pathInside(parent, child) {
  const rel = relative(parent, child)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

async function existingDirectory(path) {
  try {
    const details = await lstat(path)
    if (details.isSymbolicLink() || !details.isDirectory()) throw new ReleaseCliError('UNSAFE_RELEASE_OUTPUT', 'Release output path must be a real directory, not a link.')
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function readPreflight({ channel, allowDirty }) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new ReleaseCliError('UNSUPPORTED_BUILD_TARGET', 'Release packaging requires Windows x64.')
  const node = process.versions.node.split('.').map(Number)
  if (node[0] < 20 || (node[0] === 20 && node[1] < 19)) throw new ReleaseCliError('NODE_VERSION', 'Node.js 20.19 or newer is required.')
  const versions = await readVersionContract(repositoryRoot)
  const parsed = parseProductVersion(versions.productVersion)
  if (channel === 'stable' && parsed.prerelease) throw new ReleaseCliError('STABLE_PRERELEASE', 'A prerelease product version must use the beta channel.')
  const packageJson = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'))
  const pnpmPin = /^pnpm@(\d+\.\d+\.\d+)$/.exec(packageJson.packageManager ?? '')
  if (!pnpmPin) throw new ReleaseCliError('PNPM_VERSION', 'package.json must pin an exact pnpm version.')
  if (await existsFile(join(repositoryRoot, 'package-lock.json'))) throw new ReleaseCliError('MULTIPLE_LOCKFILES', 'Remove the obsolete npm lockfile before creating a release build.')
  const lockfile = await readFile(join(repositoryRoot, 'pnpm-lock.yaml'), 'utf8')
  if (!/^lockfileVersion: ['"]?9\.0['"]?$/m.test(lockfile)) throw new ReleaseCliError('LOCKFILE_VERSION', 'pnpm-lock.yaml does not use the expected lockfile format.')
  if (!(await existsFile(join(repositoryRoot, 'node_modules/electron-builder/cli.js')))) throw new ReleaseCliError('DEPENDENCIES_MISSING', 'Install the frozen pnpm dependencies before packaging.')
  const sdkList = command('dotnet', ['--list-sdks'])
  if (!sdkList.split(/\r?\n/).some(line => /^10\./.test(line.trim()))) throw new ReleaseCliError('DOTNET_SDK', '.NET 10 SDK is required to build NativeHost and UpdateHelper.')
  const windowsPowerShell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  if (!(await existsFile(windowsPowerShell))) throw new ReleaseCliError('POWERSHELL', 'Windows PowerShell is unavailable.')
  const gitCommit = command('git', ['rev-parse', 'HEAD'])
  if (!/^[a-f0-9]{40}$/i.test(gitCommit)) throw new ReleaseCliError('GIT_IDENTITY', 'Git did not return a full commit SHA.')
  const status = command('git', ['status', '--porcelain', '--untracked-files=all'])
  const sourceDirty = status.length > 0
  assertSourceStateAllowed({ sourceDirty, allowDirty, channel })
  const buildTimestampUtc = new Date().toISOString()
  const buildInfo = createBuildInfo({
    ...versions,
    gitCommit,
    sourceDirty,
    buildTimestampUtc,
    channel,
    platform: 'win32',
    arch: 'x64',
  })
  const outputDirectory = resolveReleaseArtifactDirectory(repositoryRoot, buildInfo)
  await validateReleaseRoot()
  if (await existingDirectory(outputDirectory)) throw new ReleaseCliError('RELEASE_OUTPUT_EXISTS', 'This version/channel/source identity already has an output directory; refusing to overwrite it.')
  await verifyVersionBuildWiring(repositoryRoot)
  return { buildInfo, outputDirectory, windowsPowerShell, pnpmVersion: pnpmPin[1] }
}

async function existsFile(path) {
  try { const details = await lstat(path); return details.isFile() && !details.isSymbolicLink() }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error }
}

async function validateReleaseRoot() {
  const repository = await realpath(repositoryRoot)
  let releaseDetails
  try { releaseDetails = await lstat(releaseRoot) }
  catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  if (releaseDetails.isSymbolicLink() || !releaseDetails.isDirectory()) throw new ReleaseCliError('UNSAFE_RELEASE_OUTPUT', 'Repository release/ must be a real directory.')
  const canonical = await realpath(releaseRoot)
  if (!pathInside(repository, canonical)) throw new ReleaseCliError('UNSAFE_RELEASE_OUTPUT', 'Repository release/ resolves outside the checkout.')
  const workParent = join(releaseRoot, '.phase6a-work')
  try {
    const workDetails = await lstat(workParent)
    if (workDetails.isSymbolicLink() || !workDetails.isDirectory()) throw new ReleaseCliError('UNSAFE_RELEASE_OUTPUT', 'The release work directory must be a real directory.')
    if (!pathInside(canonical, await realpath(workParent))) throw new ReleaseCliError('UNSAFE_RELEASE_OUTPUT', 'The release work directory resolves outside release/.')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

function runCheckedProcess(executable, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, { cwd: repositoryRoot, windowsHide: true, stdio: 'inherit', shell: false })
    child.once('error', () => rejectPromise(new ReleaseCliError('CHECK_TOOL_FAILED', `${executable} could not start.`)))
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else rejectPromise(new ReleaseCliError('CHECK_FAILED', `${executable} check failed (exit ${code ?? signal}).`))
    })
  })
}

async function verifyVersionBuildWiring(root) {
  const [nativeProject, updaterProject, buildScript, nsis, electronMain] = await Promise.all([
    readFile(join(root, 'native/WebTools.NativeHost/WebTools.NativeHost.csproj'), 'utf8'),
    readFile(join(root, 'native/WebTools.UpdateHelper/WebTools.UpdateHelper.csproj'), 'utf8'),
    readFile(join(root, 'scripts/build-native-production.ps1'), 'utf8'),
    readFile(join(root, 'scripts/native-production.nsi'), 'utf8'),
    readFile(join(root, 'electron/main.ts'), 'utf8'),
  ])
  if (/<(?:Version|AssemblyVersion|FileVersion)>/i.test(nativeProject + updaterProject)) throw new ReleaseCliError('VERSION_DRIFT', 'Native projects must not define a separate product version.')
  for (const required of ['-p:Version=$productVersion', '-p:AssemblyVersion=$windowsFileVersion', '-p:FileVersion=$windowsFileVersion', '-p:InformationalVersion=$productVersion', '-p:IncludeSourceRevisionInInformationalVersion=false']) {
    if (!buildScript.includes(required)) throw new ReleaseCliError('VERSION_WIRING', 'Native build does not derive component metadata from package.json.')
  }
  if (!nsis.includes('WEBTOOLS_PRODUCT_VERSION') || !nsis.includes('WEBTOOLS_FILE_VERSION') || !nsis.includes('WEBTOOLS_CHANNEL')
      || !nsis.includes('/LANG=2052') || !nsis.includes('"FileVersion" "${WEBTOOLS_FILE_VERSION}"')
      || /WebTools-Setup-0\.1\.0\.exe/.test(nsis)) {
    throw new ReleaseCliError('VERSION_WIRING', 'Installer version metadata and name must be injected by the versioned build.')
  }
  if (!electronMain.includes('IPC_CHANNELS.getVersion, () => app.getVersion()')) throw new ReleaseCliError('VERSION_WIRING', 'Manager version must continue to derive from Electron app version.')
  if (!buildScript.includes('$managerVersionForms = @("$major.$minor.$patch", $windowsFileVersion)')
      || !buildScript.includes('$managerVersion.FileVersion -notin $managerVersionForms')
      || !buildScript.includes('$managerVersion.ProductVersion -notin $managerVersionForms')) {
    throw new ReleaseCliError('VERSION_WIRING', 'Packaged Manager numeric version resources must match the product version core.')
  }
}

const installerName = buildInfo => buildInfo.channel === 'stable'
  ? `WebTools-Setup-${buildInfo.productVersion}.exe`
  : `WebTools-Setup-${buildInfo.productVersion}-${buildInfo.channel}.exe`

async function copyRegularFile(source, destination) {
  const details = await lstat(source)
  if (!details.isFile() || details.isSymbolicLink()) throw new ReleaseCliError('UNSAFE_BUILD_OUTPUT', 'Build output contains a non-regular artifact.')
  await mkdir(dirname(destination), { recursive: true })
  await copyFile(source, destination)
}

async function buildRelease(preflight) {
  const { buildInfo, outputDirectory, windowsPowerShell, pnpmVersion } = preflight
  const runId = randomUUID()
  const workParent = join(releaseRoot, '.phase6a-work')
  const workDirectory = join(workParent, runId)
  const buildingDirectory = join(releaseRoot, `.${basename(outputDirectory)}.building-${runId}`)
  await mkdir(workParent, { recursive: true })
  if (await existingDirectory(workParent) !== true || await existingDirectory(workDirectory) || await existingDirectory(buildingDirectory)) {
    throw new ReleaseCliError('UNSAFE_RELEASE_OUTPUT', 'Temporary release output identity is not available.')
  }

  console.log(`WebTools ${buildInfo.productVersion} (${buildInfo.channel})`)
  console.log(`Source: ${buildInfo.gitCommit}; dirty=${buildInfo.sourceDirty}; RC eligible=${buildInfo.releaseCandidateEligible}`)
  console.log(`pnpm: ${pnpmVersion}; target: ${buildInfo.platform}-${buildInfo.arch}`)
  console.log('Running typecheck, Node tests, Electron build, NativeHost/UpdateHelper checks, package build and isolated install smoke.')

  await runCheckedProcess('dotnet', [
    'run', '--project', 'native/WebTools.NativeHost.Checks/WebTools.NativeHost.Checks.csproj',
    '--configuration', 'Release',
  ])

  await runBuildProcess(windowsPowerShell, [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(repositoryRoot, 'scripts/build-native-production.ps1'),
    '-OutputDirectory', workDirectory,
    '-Channel', buildInfo.channel,
  ])

  const stage = join(workDirectory, 'stage')
  const files = [
    [join(workDirectory, installerName(buildInfo)), `installer/${installerName(buildInfo)}`],
    [join(stage, 'host/WebTools.NativeHost.exe'), 'components/native/WebTools.NativeHost.exe'],
    [join(stage, 'host/WebTools.NativeHost.dll'), 'components/native/WebTools.NativeHost.dll'],
    [join(stage, 'updater/WebTools.UpdateHelper.exe'), 'components/update-helper/WebTools.UpdateHelper.exe'],
    [join(stage, 'manager/WebTools.exe'), 'components/manager/WebTools.exe'],
    [join(stage, 'manager/resources/app.asar'), 'components/manager/resources/app.asar'],
  ]
  await mkdir(buildingDirectory)
  for (const [source, target] of files) await copyRegularFile(source, join(buildingDirectory, target))
  await mkdir(join(buildingDirectory, 'metadata'))
  await mkdir(join(buildingDirectory, 'checksums'))
  await mkdir(join(buildingDirectory, 'evidence'))
  await writeFile(join(buildingDirectory, 'metadata/build-info.json'), `${JSON.stringify(buildInfo, null, 2)}\n`, 'utf8')
  await copyFile(join(repositoryRoot, 'docs/release-notes-template.md'), join(buildingDirectory, 'release-notes.md'))
  const verification = {
    schemaVersion: 1,
    buildId: basename(outputDirectory),
    result: 'pass',
    checks: [
      'pnpm run typecheck', 'pnpm test', 'pnpm run build',
      'NativeHost Checks', 'UpdateHelper Checks', 'Windows package:win-unpacked',
      'NSIS installer compile', 'cover-install ordering smoke',
      'isolated Unicode/space-path install, Manager discovery and self-uninstall',
    ].map(name => ({ name, result: 'pass' })),
  }
  await writeFile(join(buildingDirectory, 'evidence/verification.json'), `${JSON.stringify(verification, null, 2)}\n`, 'utf8')
  const manifest = await createArtifactManifest(buildingDirectory, files.map(([, target]) => target), {
    productVersion: buildInfo.productVersion,
    buildId: verification.buildId,
  })
  await writeFile(join(buildingDirectory, 'checksums/artifact-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await verifyArtifactManifest(buildingDirectory, manifest)
  await rename(buildingDirectory, outputDirectory)
  await rm(workDirectory, { recursive: true, force: false })
  console.log(`Release artifact set created: ${relative(repositoryRoot, outputDirectory).replaceAll('\\', '/')}`)
  console.log(`Installer: ${relative(repositoryRoot, join(outputDirectory, `installer/${installerName(buildInfo)}`)).replaceAll('\\', '/')}`)
  console.log(`Release candidate eligible: ${buildInfo.releaseCandidateEligible}`)
}

async function verifyReleaseDirectory(target) {
  await validateReleaseRoot()
  const targetPath = resolve(repositoryRoot, target)
  if (!pathInside(releaseRoot, targetPath)) throw new ReleaseCliError('UNSAFE_RELEASE_PATH', 'Release verification accepts directories contained by this repository release/ folder only.')
  const canonicalReleaseRoot = await realpath(releaseRoot)
  const canonicalTarget = await realpath(targetPath)
  if (!pathInside(canonicalReleaseRoot, canonicalTarget)) throw new ReleaseCliError('UNSAFE_RELEASE_PATH', 'Release directory resolves outside release/.')
  const targetDetails = await lstat(targetPath)
  if (targetDetails.isSymbolicLink() || !targetDetails.isDirectory()) throw new ReleaseCliError('UNSAFE_RELEASE_PATH', 'Release verification target must be a real directory.')
  const metadata = JSON.parse(await readFile(join(canonicalTarget, 'metadata/build-info.json'), 'utf8'))
  const manifest = JSON.parse(await readFile(join(canonicalTarget, 'checksums/artifact-manifest.json'), 'utf8'))
  verifyBuildInfo(metadata)
  const expectedBuildId = createReleaseDirectoryName(metadata)
  if (basename(canonicalTarget) !== expectedBuildId) throw new ReleaseCliError('BUILD_ID_MISMATCH', 'Release folder name does not match its build metadata.')
  if (manifest.productVersion !== metadata.productVersion || manifest.buildId !== expectedBuildId) {
    throw new ReleaseCliError('BUILD_ID_MISMATCH', 'Artifact manifest and build metadata identities differ.')
  }
  if (metadata.releaseCandidateEligible !== !metadata.sourceDirty || metadata.signing?.status !== 'unsigned') {
    throw new ReleaseCliError('BUILD_METADATA_INVALID', 'Build eligibility or signing status is inconsistent.')
  }
  const expectedInstaller = `installer/WebTools-Setup-${metadata.productVersion}${metadata.channel === 'stable' ? '' : `-${metadata.channel}`}.exe`
  const expectedPaths = [expectedInstaller, ...artifactPaths]
  if (manifest.artifacts.length !== expectedPaths.length || expectedPaths.some(path => !manifest.artifacts.some(item => item.relativePath === path))) {
    throw new ReleaseCliError('ARTIFACT_LIST_MISMATCH', 'Artifact manifest does not cover every required release component.')
  }
  await verifyArtifactManifest(canonicalTarget, manifest)
  console.log(`Artifact hashes verified: ${manifest.artifacts.length} files.`)
  console.log(`Source: ${metadata.gitCommit}; dirty=${metadata.sourceDirty}; channel=${metadata.channel}; RC eligible=${metadata.releaseCandidateEligible}`)
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.action === 'verify') return verifyReleaseDirectory(options.target)
  const preflight = await readPreflight(options)
  if (options.action === 'preflight') {
    console.log(`Preflight PASS: WebTools ${preflight.buildInfo.productVersion}, ${preflight.buildInfo.channel}, dirty=${preflight.buildInfo.sourceDirty}, RC eligible=${preflight.buildInfo.releaseCandidateEligible}`)
    return
  }
  await buildRelease(preflight)
}

main().catch(error => {
  const code = error?.code ? ` [${error.code}]` : ''
  console.error(`Release engineering failed${code}: ${error?.message ?? 'unknown error'}`)
  process.exitCode = 1
})
