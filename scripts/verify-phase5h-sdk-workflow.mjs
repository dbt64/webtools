import { spawnSync, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { packageBytes, manifest, png } from '../electron/plugins/fixtures.mjs'
import { validatePackageV1 } from '../plugin-sdk/declarative-v1/runtime/package-v1.mjs'
import { validatePackage as validateHostPackage } from '../electron/plugins/package-validator.ts'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sdk = path.join(repo, 'plugin-sdk', 'declarative-v1')
const sample = path.join(repo, 'examples', 'plugins', 'private-notes')

export function workflowCommands(pluginDir = './plugin', packagePath = './dist/private-notes.wtplugin') {
  return [
    ['install'],
    ['install', '--frozen-lockfile'],
    ['exec', 'tsc', '--noEmit', '--strict', '--skipLibCheck', '--moduleResolution', 'bundler', '--module', 'ESNext', '--target', 'ES2022', `${pluginDir}/manifest.typecheck.ts`],
    ['exec', 'webtools-plugin', 'validate', pluginDir, '--host-version', '0.1.0'],
    ['exec', 'webtools-plugin', 'pack', pluginDir, '--out', packagePath, '--host-version', '0.1.0'],
    ['exec', 'webtools-plugin', 'validate', packagePath, '--host-version', '0.1.0'],
  ]
}

function pnpmExecutable() {
  if (process.platform !== 'win32') return 'pnpm'
  return path.join(path.dirname(process.execPath), 'node_modules', 'pnpm', 'pnpm.exe')
}

function run(executable, args, cwd) {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
  if (result.error || result.status !== 0) {
    const error = new Error(`Command failed: ${path.basename(executable)} ${args.join(' ')}\n${result.stderr ?? result.error?.message ?? ''}`)
    error.exitCode = result.status ?? 1
    throw error
  }
  return { command: `${path.basename(executable)} ${args.join(' ')}`, exitCode: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() }
}

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex') }

export async function runWorkflow() {
  const evidenceRoot = await mkdtemp(path.join(os.tmpdir(), 'webtools-phase5h-sdk-workflow-'))
  const artifacts = path.join(evidenceRoot, 'artifacts')
  const author = path.join(evidenceRoot, 'author-project')
  const plugin = path.join(author, 'plugin')
  const dist = path.join(author, 'dist')
  await Promise.all([mkdir(artifacts), mkdir(plugin, { recursive: true })])
  await mkdir(dist)
  const pnpm = pnpmExecutable()
  const commands = []
  commands.push(run(pnpm, ['pack', '--pack-destination', artifacts], sdk))
  const tarballs = (await readdir(artifacts)).filter(file => file.endsWith('.tgz') && file.startsWith('webtools-plugin-sdk-'))
  if (tarballs.length !== 1) throw new Error('Expected exactly one SDK tarball in isolated artifacts folder.')
  const tarball = tarballs[0]
  const authorPackage = {
    name: 'third-party-webtools-plugin-author-test', version: '1.0.0', private: true, type: 'module',
    packageManager: 'pnpm@9.15.9',
    devDependencies: { '@webtools/plugin-sdk': `file:../artifacts/${tarball}`, typescript: '5.9.2' },
  }
  await writeFile(path.join(author, 'package.json'), `${JSON.stringify(authorPackage, null, 2)}\n`)
  commands.push(run(pnpm, ['install', '--no-frozen-lockfile', '--ignore-scripts'], author))
  commands.push(run(pnpm, ['install', '--frozen-lockfile', '--ignore-scripts'], author))
  for (const file of ['manifest.json', 'manifest.typecheck.ts', 'README.md']) await copyFile(path.join(sample, file), path.join(plugin, file))
  commands.push(run(pnpm, ['exec', 'tsc', '--noEmit', '--strict', '--skipLibCheck', '--moduleResolution', 'bundler', '--module', 'ESNext', '--target', 'ES2022', 'plugin/manifest.typecheck.ts'], author))
  commands.push(run(pnpm, ['exec', 'webtools-plugin', 'validate', './plugin', '--host-version', '0.1.0'], author))
  commands.push(run(pnpm, ['exec', 'webtools-plugin', 'pack', './plugin', '--out', './dist/private-notes.wtplugin', '--host-version', '0.1.0'], author))
  commands.push(run(pnpm, ['exec', 'webtools-plugin', 'validate', './dist/private-notes.wtplugin', '--host-version', '0.1.0'], author))
  const artifact = await readFile(path.join(dist, 'private-notes.wtplugin'))
  const standaloneAccepted = await validatePackageV1(artifact, '0.1.0')
  const hostAccepted = await validateHostPackage(artifact, '0.1.0')

  const compatibility = []
  const fixtures = [
    { label: 'existing declarative v1 fixture without assets', bytes: packageBytes(manifest()) },
    { label: 'existing declarative v1 fixture with bounded PNG asset', bytes: packageBytes(manifest({ entry: { pageId: 'home', label: 'Demo', icon: 'assets/icon.png' }, assets: [{ path: 'assets/icon.png', type: 'image/png' }] }), [{ name: 'assets/icon.png', data: png() }]) },
  ]
  const compatibilityDir = path.join(author, 'compatibility')
  await mkdir(compatibilityDir)
  for (const [index, item] of fixtures.entries()) {
    const name = `declarative-v1-${index + 1}.wtplugin`
    const location = path.join(compatibilityDir, name)
    await writeFile(location, item.bytes)
    const host = await validateHostPackage(item.bytes, '0.1.0')
    const sdkCheck = await validatePackageV1(item.bytes, '0.1.0')
    const cli = run(pnpm, ['exec', 'webtools-plugin', 'validate', `./compatibility/${name}`, '--host-version', '0.1.0'], author)
    commands.push(cli)
    compatibility.push({ label: item.label, hostAccepted: true, sdkAccepted: true, cliAccepted: cli.exitCode === 0, id: host.manifest.id, sha256: sha256(item.bytes), sdkHash: sdkCheck.hash })
  }

  const dependencyGraph = JSON.parse(execFileSync(pnpm, ['list', '--depth', '1', '--json'], { cwd: author, encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 }))[0]
  const graphText = JSON.stringify(dependencyGraph)
  if (graphText.includes(repo.replaceAll('\\', '/')) || graphText.includes(repo)) throw new Error('External SDK dependency graph unexpectedly references the WebTools checkout.')
  const report = {
    result: 'PASS',
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', windowsHide: true }).trim(),
    pnpmVersion: execFileSync(pnpm, ['--version'], { cwd: repo, encoding: 'utf8', windowsHide: true }).trim(),
    evidenceRoot,
    sdkTarball: { file: tarball, sha256: sha256(await readFile(path.join(artifacts, tarball))) },
    authorProject: { isolated: true, sourceCopiedOnly: true, dependencyNames: Object.keys(authorPackage.devDependencies) },
    commands,
    generatedPlugin: { file: 'author-project/dist/private-notes.wtplugin', sha256: sha256(artifact), bytes: artifact.length, hostAccepted: true, sdkAccepted: true, id: hostAccepted.manifest.id, sdkHash: standaloneAccepted.hash },
    compatibility,
    limits: ['local tarball distribution only; not published to npm', 'compatibility samples are the existing generic Manifest v1 fixture generator cases; no archived historical package file is claimed'],
  }
  const reportPath = path.join(evidenceRoot, 'workflow-report.json')
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  return { reportPath, report }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWorkflow().then(({ reportPath, report }) => console.log(JSON.stringify({ ...report, reportPath }, null, 2))).catch(error => {
    console.error(`Phase 5H SDK workflow failed: ${error.message}`)
    process.exitCode = 1
  })
}
