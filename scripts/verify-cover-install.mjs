import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, copyFile, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { once } from 'node:events'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { parseProductVersion } from './release-contract.mjs'

// Full NSIS uninstall/reinstall regression in a private registry and directory.
// No production installation, shortcuts, startup entries, or user data are touched.
const fixture = await mkdtemp(join(tmpdir(), 'webtools-cover-install-'))
const installRoot = join(fixture, '安装目录 中文 空格')
const registry = `Software\\WebToolsInstallerChecks\\${randomUUID()}`
const helperPath = process.argv[2]
const interactive = process.argv.includes('--interactive')
const refusal = process.argv.includes('--refusal')
assert.ok(helperPath, 'Pass a published WebTools.UpdateHelper.exe path.')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function run(exe, args, options = {}) {
  const process = spawn(exe, args, { windowsHide: true, ...options })
  const timer = setTimeout(() => process.kill(), interactive ? 600_000 : 30_000) // Own disposable fixture only.
  try { return (await once(process, 'exit'))[0] } finally { clearTimeout(timer) }
}
async function findCompiler(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isFile() && entry.name === 'makensis.exe' && directory.endsWith(`${sep}Bin`)) return path
    if (entry.isDirectory()) { const found = await findCompiler(path); if (found) return found }
  }
}
const compiler = await findCompiler(join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache', 'nsis-3.0.4.1'))
assert.ok(compiler, 'Existing NSIS compiler is required.')
const stage = join(fixture, 'stage')
await mkdir(join(stage, 'host'), { recursive: true })
await mkdir(join(stage, 'manager', 'resources'), { recursive: true })
await mkdir(join(stage, 'updater'), { recursive: true })
await copyFile(resolve(helperPath), join(stage, 'updater', 'WebTools.UpdateHelper.exe'))
await copyFile('resources/app.ico', join(stage, 'app.ico'))
const source = await readFile('scripts/native-production.nsi', 'utf8')
const productManifest = JSON.parse(await readFile('package.json', 'utf8'))
const productVersion = parseProductVersion(productManifest.version)
const nsisDefinitions = [
  `!define WEBTOOLS_PRODUCT_VERSION "${productVersion.version}"`,
  `!define WEBTOOLS_FILE_VERSION "${productVersion.windowsFileVersion}"`,
  '!define WEBTOOLS_CHANNEL "stable"',
  '',
].join('\n')
const sandboxSource = source
  .replace('SetCompressor /SOLID lzma', 'SetCompressor zlib')
  .replace('Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', `${registry}\\Uninstall`)
  .replace('Software\\Microsoft\\Windows\\CurrentVersion\\Run', `${registry}\\Run`)
  .replaceAll('$SMPROGRAMS', join(fixture, 'start-menu'))
  .replaceAll('$DESKTOP', join(fixture, 'desktop'))
  // Failure is observable without blocking on an error MessageBox in unattended checks.
  .replace(/MessageBox MB_ICONSTOP\|MB_OK[^\r\n]+/g, 'SetErrorLevel 41')
const completedUninstall = join(fixture, 'old-uninstall-completed.txt')
await mkdir(join(fixture, 'desktop'))

let runningManager
try {
  for (const generation of ['old', 'new']) {
    await writeFile(join(stage, 'host', 'WebTools.NativeHost.exe'), generation)
    await writeFile(join(stage, 'manager', 'WebTools.exe'), generation)
    await writeFile(join(stage, 'manager', 'resources', 'app.asar'), generation)
    if (generation === 'old' && interactive) {
      const checks = resolve('native/WebTools.UpdateHelper.Checks/bin/Release/net10.0-windows')
      for (const entry of await readdir(checks, { withFileTypes: true })) {
        if (entry.isFile()) await copyFile(join(checks, entry.name), join(stage, 'manager', entry.name))
      }
      await copyFile(join(checks, 'WebTools.UpdateHelper.Checks.exe'), join(stage, 'manager', 'WebTools.exe'))
    }
    let nsi = sandboxSource.replace('OutFile "WebTools-Setup-${WEBTOOLS_PRODUCT_VERSION}.exe"', `OutFile "${generation}-setup.exe"`)
    if (generation === 'old') {
      // Deterministic delayed old uninstall catches an unwaited temporary child.
      nsi = nsi.replace('Section "Uninstall"', 'Section "Uninstall"\n  Sleep 1500')
      nsi = nsi.replace('  RMDir /r "$INSTDIR"', `  RMDir /r "$INSTDIR"\n  FileOpen $0 "${completedUninstall}" w\n  FileWrite $0 "complete"\n  FileClose $0`)
    }
    await writeFile(join(fixture, `${generation}.nsi`), '\uFEFF' + nsisDefinitions + nsi)
    assert.equal(await run(compiler, ['/V2', `${generation}.nsi`], { cwd: fixture, stdio: 'inherit' }), 0, `${generation} installer compilation`)
    if (generation === 'old') {
      assert.equal(await run(join(fixture, 'old-setup.exe'), ['/S', `/D=${installRoot}`], { windowsVerbatimArguments: true }), 0, 'Fresh old installation')
      if (!interactive) assert.equal(await readFile(join(installRoot, 'Manager', 'WebTools.exe'), 'utf8'), 'old')
    }
  }
  if (interactive) {
    runningManager = spawn(join(installRoot, 'Manager', 'WebTools.exe'), [refusal ? '--process-fixture' : '--window-fixture'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    await once(runningManager.stdout, 'data')
    console.log('READY isolated update UI:', join(fixture, 'new-setup.exe'))
    console.log('Existing install directory:', installRoot)
    if (refusal) {
      // Enter in this test driver performs a normal fixture exit, simulating tray Exit.
      process.stdin.once('data', () => runningManager.stdin.write('exit\n'))
    }
  }
  const updateExit = await run(join(fixture, 'new-setup.exe'), interactive ? [] : ['/S', `/D=${installRoot}`], { windowsVerbatimArguments: true, windowsHide: !interactive })
  console.log('Cover-install exit:', updateExit)
  assert.equal(updateExit, 0, 'The same installation must complete old uninstall and new install successfully.')
  if (interactive) assert.notEqual(runningManager.exitCode, null, 'The old Manager must have exited normally before setup finishes.')
  assert.equal(await readFile(completedUninstall, 'utf8'), 'complete', 'Old uninstaller must finish before update returns.')
  assert.equal(await readFile(join(installRoot, 'Manager', 'WebTools.exe'), 'utf8'), 'new')
  await delay(2000)
  assert.equal(await readFile(join(installRoot, 'Manager', 'WebTools.exe'), 'utf8'), 'new', 'A delayed old uninstaller must not delete new files.')
  console.log('PASS complete same-directory cover-install; old uninstall waited; new files remain.')
} finally {
  if (refusal) process.stdin.pause()
  if (runningManager?.exitCode === null) {
    runningManager.stdin.write('exit\n')
    await Promise.race([once(runningManager, 'exit'), delay(5000)])
    if (runningManager.exitCode === null) runningManager.kill()
  }
  // Wait for the intentionally delayed legacy uninstaller before fixture cleanup.
  await delay(2500)
  await run('reg.exe', ['delete', `HKCU\\${registry}`, '/f'], { stdio: 'ignore' })
  assert.ok(resolve(fixture).startsWith(resolve(tmpdir()) + sep))
  await rm(fixture, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 })
}
