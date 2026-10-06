import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { validatePackage as validateHostPackage } from '../electron/plugins/package-validator.ts'

export const PINNED_PNPM = '9.15.9'
const SDK_VERSION = '1.1.0'
const HOST_VERSION_FALLBACK = '0.1.0'
const TEMP_PREFIX = 'webtools-phase6b-sdk-workflow-'
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sdk = path.join(repo, 'plugin-sdk', 'declarative-v1')

function normalizedPath(value) { return path.resolve(value).replace(/[\\/]+/g, path.sep).toLowerCase() }
function samePath(left, right) { return normalizedPath(left) === normalizedPath(right) }

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function unsafeLayout() { throw new Error('Phase 6B workflow paths must remain inside a unique OS temporary directory, separate from the repository and user data.') }

export function createWorkflowLayout(evidenceRoot, repositoryRoot = repo) {
  const root = path.resolve(evidenceRoot)
  const repository = path.resolve(repositoryRoot)
  if (!path.basename(root).startsWith(TEMP_PREFIX) || !isWithin(os.tmpdir(), root) || isWithin(root, repository) || isWithin(repository, root)) unsafeLayout()
  return Object.freeze({
    root,
    repo: repository,
    sdk: path.join(repository, 'plugin-sdk', 'declarative-v1'),
    artifacts: path.join(root, 'artifacts'),
    tooling: path.join(root, 'tooling'),
    author: path.join(root, 'tooling', 'author-project'),
    archive: path.join(root, 'tooling', 'author-project', 'dist', 'author-project.wtplugin'),
    report: path.join(root, 'workflow-report.json'),
  })
}

export function assertWorkflowLayout(layout, repositoryRoot = repo) {
  const expected = createWorkflowLayout(layout?.root, repositoryRoot)
  for (const key of Object.keys(expected)) {
    if (typeof layout[key] !== 'string' || !samePath(layout[key], expected[key])) unsafeLayout()
  }
  for (const key of ['artifacts', 'tooling', 'author', 'archive', 'report']) {
    if (!isWithin(expected.root, expected[key]) || isWithin(expected.repo, expected[key])) unsafeLayout()
  }
  return true
}

export function childEnvironment(source = process.env) {
  const env = { ...source }
  for (const name of Object.keys(env)) if (['node_path', 'node_options'].includes(name.toLowerCase())) delete env[name]
  return env
}

export function assertExternalDependencyGraph(graphText, lockfileText, repositoryRoot = repo, authorDirectory, evidenceRoot) {
  const combined = `${String(graphText)}\n${String(lockfileText)}`.replaceAll('\\', '/').replace(/\/{2,}/g, '/').toLowerCase()
  const repository = path.resolve(repositoryRoot).replaceAll('\\', '/').replace(/\/{2,}/g, '/').toLowerCase()
  if (combined.includes(repository)) throw new Error('The external dependency graph points back into the WebTools checkout.')
  if (/\bworkspace:|\blink:/i.test(combined)) throw new Error('The external dependency graph contains a workspace or directory link.')

  for (const match of combined.matchAll(/file:([^\s,"')]+)/g)) {
    const target = match[1]
    if (!target || path.isAbsolute(target) || path.win32.isAbsolute(target) || /^[a-z]:/i.test(target)) {
      throw new Error('The external dependency graph contains an absolute local package source.')
    }
    if (authorDirectory && evidenceRoot && !isWithin(evidenceRoot, path.resolve(authorDirectory, target))) {
      throw new Error('The external tarball source resolves outside the isolated evidence directory.')
    }
  }
  return true
}

export function buildWorkflowCommandPlan(layout, { pnpmPath, nodePath = process.execPath, sdkVersion = SDK_VERSION, hostVersion = HOST_VERSION_FALLBACK } = {}) {
  assertWorkflowLayout(layout, repo)
  if (typeof pnpmPath !== 'string' || !path.isAbsolute(pnpmPath) || !samePath(nodePath, process.execPath)) {
    throw new Error('Workflow requires the explicit pinned pnpm executable and current Node executable.')
  }
  if (!/^\d+\.\d+\.\d+$/.test(sdkVersion) || !/^[0-9A-Za-z.+-]{1,128}$/.test(hostVersion)) throw new Error('Workflow SDK or Host version is not a safe fixed version.')

  const tarball = `webtools-plugin-sdk-${sdkVersion}.tgz`
  const cli = path.join(layout.tooling, 'node_modules', '@webtools', 'plugin-sdk', 'bin', 'webtools-plugin.mjs')
  const pnpm = (cwd, args, label) => ({ kind: 'pnpm', executable: pnpmPath, args, cwd, label })
  const node = (cwd, args, label) => ({ kind: 'node', executable: nodePath, args, cwd, label })
  return [
    pnpm(layout.sdk, ['--version'], 'verify-pnpm-version'),
    pnpm(layout.sdk, ['pack', '--pack-destination', layout.artifacts], 'pack-sdk-tarball'),
    node(layout.tooling, ['--version'], 'verify-node-version'),
    pnpm(layout.tooling, ['install', '--no-frozen-lockfile', '--ignore-scripts'], 'install-tooling-from-tarball'),
    pnpm(layout.tooling, ['install', '--frozen-lockfile', '--ignore-scripts'], 'freeze-tooling-install'),
    node(layout.tooling, [cli, 'create', 'author-project', '--host-version', hostVersion, '--json'], 'create-basic-author-project'),
    pnpm(layout.author, ['add', '--save-dev', '--ignore-scripts', `file:../../artifacts/${tarball}`], 'add-local-sdk-tarball-to-author-project'),
    pnpm(layout.author, ['install', '--frozen-lockfile', '--ignore-scripts'], 'freeze-author-install'),
    pnpm(layout.author, ['run', 'typecheck'], 'author-typecheck'),
    pnpm(layout.author, ['run', 'validate'], 'author-source-validation'),
    pnpm(layout.author, ['run', 'plugin:pack'], 'author-package'),
    pnpm(layout.author, ['run', 'inspect'], 'author-inspection'),
    pnpm(layout.author, ['list', '--depth', '1', '--json'], 'inspect-author-dependency-graph'),
  ]
}

function pnpmExecutable() {
  const candidate = path.join(path.dirname(process.execPath), 'node_modules', 'pnpm', 'pnpm.exe')
  if (process.platform === 'win32') return candidate
  return 'pnpm'
}

function assertAllowedCommand(command, layout, pnpmPath) {
  assertWorkflowLayout(layout, repo)
  if (command.kind === 'pnpm' && samePath(command.executable, pnpmPath)) {
    if (![layout.sdk, layout.tooling, layout.author].some(root => samePath(command.cwd, root))) unsafeLayout()
    return
  }
  if (command.kind === 'node' && samePath(command.executable, process.execPath)) {
    if (![layout.tooling, layout.author].some(root => samePath(command.cwd, root))) unsafeLayout()
    if (command.args[0] && path.isAbsolute(command.args[0]) && !isWithin(layout.tooling, command.args[0])) unsafeLayout()
    return
  }
  throw new Error('Only the pinned pnpm executable and current Node executable are allowed in the external workflow.')
}

function run(command, layout, pnpmPath) {
  assertAllowedCommand(command, layout, pnpmPath)
  const startedAt = Date.now()
  const result = spawnSync(command.executable, command.args, {
    cwd: command.cwd,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    timeout: 10 * 60 * 1000,
    maxBuffer: 16 * 1024 * 1024,
    env: childEnvironment(),
  })
  const record = {
    label: command.label,
    command: `${path.basename(command.executable)} ${command.args.join(' ')}`,
    exitCode: result.status,
    durationMs: Date.now() - startedAt,
    stdout: String(result.stdout ?? '').trim().slice(0, 4000),
    stderr: String(result.stderr ?? '').trim().slice(0, 4000),
  }
  if (result.error || result.status !== 0) {
    const error = new Error(`Phase 6B workflow command ${command.label} failed (exit ${result.status ?? 1}): ${result.error?.message ?? record.stderr}`)
    error.commandRecord = record
    throw error
  }
  return record
}

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex') }

async function assertRealTemporaryRoot(root) {
  const info = await lstat(root).catch(unsafeLayout)
  const canonical = await realpath(root).catch(unsafeLayout)
  if (!info.isDirectory() || info.isSymbolicLink() || !samePath(root, canonical)) unsafeLayout()
}

function parseJsonOutput(record, label) {
  try { return JSON.parse(record.stdout) }
  catch { throw new Error(`Expected a bounded JSON response from ${label}.`) }
}

export async function runWorkflow() {
  const root = await mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX))
  const layout = createWorkflowLayout(root, repo)
  await assertRealTemporaryRoot(layout.root)
  await mkdir(layout.artifacts)
  await mkdir(layout.tooling)

  const packageMetadata = JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8'))
  const hostVersion = typeof packageMetadata.version === 'string' ? packageMetadata.version : HOST_VERSION_FALLBACK
  const pnpmPath = pnpmExecutable()
  const commands = []
  const plan = buildWorkflowCommandPlan(layout, { pnpmPath, nodePath: process.execPath, sdkVersion: SDK_VERSION, hostVersion })
  try {
    const toolingPackage = {
      name: 'webtools-phase6b-external-tooling',
      version: '1.0.0',
      private: true,
      type: 'module',
      packageManager: `pnpm@${PINNED_PNPM}`,
      dependencies: { '@webtools/plugin-sdk': `file:../artifacts/webtools-plugin-sdk-${SDK_VERSION}.tgz` },
    }
    await writeFile(path.join(layout.tooling, 'package.json'), `${JSON.stringify(toolingPackage, null, 2)}\n`)

    for (const command of plan) {
      const record = run(command, layout, pnpmPath)
      commands.push(record)
      if (command.label === 'verify-pnpm-version' && record.stdout !== PINNED_PNPM) throw new Error(`Expected pnpm ${PINNED_PNPM}; got ${record.stdout}.`)
      if (command.label === 'verify-node-version' && record.stdout !== process.version) throw new Error(`Node executable version did not match the workflow process.`)
      if (command.label === 'create-basic-author-project') {
        const result = parseJsonOutput(record, command.label)
        if (result.ok !== true || result.command !== 'create' || result.result?.plugin?.manifestVersion !== 1 || result.result?.plugin?.apiMajor !== 1) {
          throw new Error('The external SDK tarball did not create the expected basic Manifest v1/API major 1 project.')
        }
      }
      if (command.label === 'author-inspection' && (!record.stdout.includes('VALID') || !record.stdout.includes('Requested capabilities: manager.page.'))) {
        throw new Error('The external package inspect command did not display validation status and declared capabilities.')
      }
    }

    const tarballs = (await readdir(layout.artifacts)).filter(name => name === `webtools-plugin-sdk-${SDK_VERSION}.tgz`)
    if (tarballs.length !== 1) throw new Error('Expected exactly one SDK 1.1.0 tarball in the isolated artifacts directory.')
    const tarballPath = path.join(layout.artifacts, tarballs[0])
    const tarballBytes = await readFile(tarballPath)
    if (!tarballBytes.length) throw new Error('The SDK tarball is empty.')

    const generatedArchive = await readFile(layout.archive)
    const installedPackagePath = path.join(layout.author, 'node_modules', '@webtools', 'plugin-sdk', 'package.json')
    const sdkEntry = path.join(layout.author, 'node_modules', '@webtools', 'plugin-sdk', 'index.mjs')
    const installedPackage = JSON.parse(await readFile(installedPackagePath, 'utf8'))
    const realSdkEntry = await realpath(sdkEntry)
    if (installedPackage.name !== '@webtools/plugin-sdk' || installedPackage.version !== SDK_VERSION || isWithin(repo, realSdkEntry)) {
      throw new Error('The author project did not resolve the standalone SDK 1.1.0 package from its external tarball install.')
    }
    const externalSdk = await import(pathToFileURL(sdkEntry).href)
    const sdkChecked = await externalSdk.validatePluginArchiveV1(generatedArchive, hostVersion)
    const hostChecked = await validateHostPackage(generatedArchive, hostVersion)
    if (sdkChecked.manifest.id !== hostChecked.manifest.id || sdkChecked.manifest.version !== hostChecked.manifest.version || sdkChecked.manifest.api.apiMajor !== hostChecked.manifest.api.apiMajor || sdkChecked.manifest.manifestVersion !== hostChecked.manifest.manifestVersion) {
      throw new Error('External SDK and Host package validator disagree on the generated plugin identity or contract version.')
    }

    const graphRecord = commands.find(command => command.label === 'inspect-author-dependency-graph')
    const graph = parseJsonOutput(graphRecord, 'inspect-author-dependency-graph')
    const lockfile = await readFile(path.join(layout.author, 'pnpm-lock.yaml'), 'utf8')
    assertExternalDependencyGraph(JSON.stringify(graph), lockfile, repo, layout.author, layout.root)
    const safeEnv = childEnvironment()
    if (Object.keys(safeEnv).some(name => ['node_path', 'node_options'].includes(name.toLowerCase()))) {
      throw new Error('Node module-injection environment variables must be absent from external subprocesses.')
    }

    const report = {
      result: 'PASS',
      versions: { node: process.version, pnpm: PINNED_PNPM, productHost: hostVersion, sdk: installedPackage.version, manifest: 1, apiMajor: 1 },
      evidenceRoot: layout.root,
      sdkTarball: { file: tarballs[0], bytes: tarballBytes.length, sha256: sha256(tarballBytes) },
      externalAuthor: { tooling: path.relative(layout.root, layout.tooling), project: path.relative(layout.root, layout.author), isolated: true, nodeModuleInjectionEnv: 'NODE_PATH and NODE_OPTIONS removed', dependencyNames: Object.keys(toolingPackage.dependencies) },
      generatedPlugin: { file: path.relative(layout.root, layout.archive), bytes: generatedArchive.length, sha256: sha256(generatedArchive), id: hostChecked.manifest.id, version: hostChecked.manifest.version, sdkAccepted: true, hostAccepted: true },
      dependencyGraph: { noCheckoutPath: true, noWorkspaceOrDirectoryLinks: true, localTarballUnderEvidenceRoot: true },
      commands,
      limits: ['local SDK tarball only; no npm publication or product release artifact', 'workflow evidence and generated packages remain in the OS temporary directory', 'Host install-time validation and consent remain authoritative'],
    }
    await writeFile(layout.report, `${JSON.stringify(report, null, 2)}\n`)
    return { reportPath: layout.report, report }
  } catch (error) {
    if (error.commandRecord) commands.push(error.commandRecord)
    const failure = {
      result: 'FAIL',
      versions: { node: process.version, pnpm: PINNED_PNPM, sdk: SDK_VERSION },
      evidenceRoot: layout.root,
      commands,
      failure: error.message,
      retainedOutsideRepository: true,
    }
    await writeFile(layout.report, `${JSON.stringify(failure, null, 2)}\n`).catch(() => {})
    throw new Error(`Phase 6B external author workflow failed; temporary evidence retained at ${layout.report}. ${error.message}`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWorkflow().then(({ reportPath, report }) => console.log(JSON.stringify({ ...report, reportPath }, null, 2))).catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
