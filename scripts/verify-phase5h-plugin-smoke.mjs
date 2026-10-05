import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { lstat, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertSafeManagerEvidenceRoot } from './lib/manager-lifecycle-evidence.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const smoke = path.join(repo, 'scripts', 'verify-phase5d-plugin-ui-smoke.mjs')
const isSameOrChildPath = (parent, candidate) => {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

export function parsePhase5hSmokeArgs(args) {
  if (!Array.isArray(args) || ![4, 5].includes(args.length) || args.some(value => typeof value !== 'string' || value.length === 0)) {
    throw new Error('Phase 5H smoke requires four absolute paths: evidence root, NativeHost Release directory, Manager win-unpacked directory, and packed .wtplugin; optional fifth argument is --phase5i-manager-cycles=10.')
  }
  const managerCycles = args.length === 5 ? args[4] === '--phase5i-manager-cycles=10' ? 10 : null : 0
  if (managerCycles === null) throw new Error('The only supported Phase 5I cycle count is exactly 10.')
  return { root: args[0], nativeSource: args[1], managerRoot: args[2], pluginPackage: args[3], managerCycles }
}

async function regularFile(pathname, label) {
  const stat = await lstat(pathname).catch(() => null)
  if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be an existing regular file without a reparse point.`)
  return path.resolve(pathname)
}

export function validatePhase5hSmokeLayout({ root: requestedRoot, nativeSource: requestedNative, managerRoot: requestedManager, pluginPackage: requestedPackage, repo: requestedRepo = repo }) {
  const root = assertSafeManagerEvidenceRoot(path.resolve(requestedRoot))
  const nativeSource = path.resolve(requestedNative)
  const managerRoot = assertSafeManagerEvidenceRoot(path.resolve(requestedManager))
  const pluginPackage = path.resolve(requestedPackage)
  const repositoryRelease = path.join(path.resolve(requestedRepo), 'release')
  if (!isSameOrChildPath(repositoryRelease, nativeSource) || nativeSource === repositoryRelease) throw new Error('NativeHost source must be a child of the repository Release output directory.')
  if (isSameOrChildPath(root, managerRoot) || isSameOrChildPath(managerRoot, root) || !managerRoot.toLowerCase().endsWith(`${path.sep}manager-build${path.sep}win-unpacked`)) {
    throw new Error('Manager must use the isolated temp manager-build\\win-unpacked directory, not an installed application.')
  }
  if (!isSameOrChildPath(root, pluginPackage) || pluginPackage === root || !pluginPackage.toLowerCase().endsWith('.wtplugin')) throw new Error('Packed plugin input must be a .wtplugin file inside the evidence root.')
  return { root, nativeSource, managerRoot, pluginPackage }
}

async function validateExistingLayout(paths) {
  const validated = validatePhase5hSmokeLayout(paths)
  const nativeRoot = await realpath(validated.nativeSource)
  const managerRoot = await realpath(validated.managerRoot)
  const packagePath = await realpath(validated.pluginPackage)
  if (!isSameOrChildPath(path.join(repo, 'release'), nativeRoot)) throw new Error('NativeHost Release directory resolves outside repository release/.')
  if (isSameOrChildPath(validated.root, managerRoot) || isSameOrChildPath(managerRoot, validated.root) || !isSameOrChildPath(validated.root, packagePath)) throw new Error('Manager output and plugin input must be isolated temp paths, separate from the evidence profile.')
  const nativeStat = await lstat(path.join(nativeRoot, 'WebTools.NativeHost.exe')).catch(() => null)
  const managerStat = await lstat(path.join(managerRoot, 'WebTools.exe')).catch(() => null)
  if (!nativeStat?.isFile() || nativeStat.isSymbolicLink() || !managerStat?.isFile() || managerStat.isSymbolicLink()) throw new Error('Isolated Release NativeHost and win-unpacked Manager executables must exist as regular files.')
  await regularFile(packagePath, 'Packed plugin')
  return { ...validated, nativeSource: nativeRoot, managerRoot, pluginPackage: packagePath }
}

export async function runPhase5hSmoke(args) {
  if (![undefined, 0, 10].includes(args.managerCycles)) throw new Error('The only supported Phase 5I cycle count is exactly 10.')
  const paths = await validateExistingLayout(args)
  const cycleArgs = args.managerCycles === 10 ? ['--phase5i-manager-cycles=10'] : []
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '--experimental-strip-types', smoke, paths.root, paths.nativeSource, paths.managerRoot, '--phase5h', paths.pluginPackage, ...cycleArgs,
    ], { cwd: repo, windowsHide: true, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Packaged Phase 5H host smoke exited with code ${code}.`)))
  })
  const reportPath = path.join(paths.root, 'phase5h-plugin-smoke-report.json')
  const report = JSON.parse(await readFile(reportPath, 'utf8'))
  assert.equal(report.result, 'PACKAGED PHASE 5H SDK PLUGIN / MANAGER LIFECYCLE PASS')
  return reportPath
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parsePhase5hSmokeArgs(process.argv.slice(2))
    const report = await runPhase5hSmoke(args)
    console.log(JSON.stringify({ result: 'PASS', evidence: report }))
  } catch (error) {
    console.error(`Phase 5H packaged plugin smoke failed: ${error instanceof Error ? error.message : 'UNKNOWN'}`)
    process.exitCode = 1
  }
}
