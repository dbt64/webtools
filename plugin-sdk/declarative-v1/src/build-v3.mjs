import { createRequire } from 'node:module'
import { copyFile, lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseManifestV3 } from '../runtime-v3/manifest-v3.mjs'

const SDK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TARGET_PATH = path.join(SDK_ROOT, 'runtime-target.json')
const CONTENT_TYPES = new Map([
  ['.html', 'text/html'], ['.htm', 'text/html'], ['.js', 'text/javascript'], ['.mjs', 'text/javascript'], ['.cjs', 'text/javascript'],
  ['.css', 'text/css'], ['.json', 'application/json'], ['.wasm', 'application/wasm'], ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'], ['.woff2', 'font/woff2'],
])

export class PluginBuildError extends Error {
  constructor(code, pathValue, message, suggestion) {
    super(message)
    this.name = 'PluginBuildError'
    this.code = code
    this.path = pathValue
    this.suggestion = suggestion
  }
}

function fail(code, filePath, message, suggestion) { throw new PluginBuildError(code, filePath, message, suggestion) }
function inside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

async function requireProjectDirectory(value) {
  let target
  try { target = path.resolve(value); const info = await lstat(target); if (!info.isDirectory() || info.isSymbolicLink()) fail('BUILD_PROJECT_PATH', '.', 'The plugin project directory must be a real directory.', 'Run this command from the generated plugin project directory.') }
  catch (error) { if (error instanceof PluginBuildError) throw error; fail('BUILD_PROJECT_PATH', '.', 'The plugin project directory could not be opened.', 'Check the path and file permissions.') }
  return realpath(target)
}

async function readJson(filePath, displayPath) {
  try { return JSON.parse(await readFile(filePath, 'utf8')) }
  catch (error) {
    if (error?.code === 'ENOENT') fail('BUILD_INPUT_MISSING', displayPath, `${displayPath} is missing.`, 'Restore the generated project file and rerun the command.')
    fail('BUILD_INPUT_INVALID', displayPath, `${displayPath} is not valid JSON.`, 'Fix the JSON syntax and try again.')
  }
}

async function assertOutputPath(root, target, relativePath) {
  const absolute = path.resolve(target)
  if (!inside(root, absolute)) fail('BUILD_OUTPUT_PATH', relativePath, `${relativePath} resolves outside the plugin project.`, 'Keep generated build output inside the project directory.')
  const info = await lstat(absolute).catch(() => undefined)
  if (info?.isSymbolicLink() || (info && !info.isDirectory())) fail('BUILD_OUTPUT_PATH', relativePath, `${relativePath} is not a safe build directory.`, 'Remove the link or conflicting file from the generated output path.')
  if (!info) await mkdir(absolute, { recursive: true })
  if (await realpath(absolute) !== absolute) fail('BUILD_OUTPUT_PATH', relativePath, `${relativePath} resolves through a link.`, 'Use a normal project directory for build output.')
  return absolute
}

async function walkFiles(root, relativeRoot = '') {
  const base = path.join(root, relativeRoot)
  if (relativeRoot) {
    const rootInfo = await lstat(base).catch(error => error?.code === 'ENOENT' ? undefined : Promise.reject(error))
    if (rootInfo?.isSymbolicLink()) fail('BUILD_SYMLINK', relativeRoot, `Build input ${relativeRoot} is a symbolic link.`, 'Use regular project files; symlinked build inputs are not copied.')
    if (rootInfo && !rootInfo.isDirectory()) fail('BUILD_SPECIAL_FILE', relativeRoot, `Build input ${relativeRoot} is not a regular directory.`, 'Use a regular directory for plugin assets.')
  }
  let names
  try { names = await readdir(base) } catch (error) { if (error?.code === 'ENOENT') return []; throw error }
  const found = []
  for (const name of names.sort((a, b) => a.localeCompare(b, 'en'))) {
    const rel = relativeRoot ? `${relativeRoot}/${name}` : name
    const info = await lstat(path.join(root, ...rel.split('/')))
    if (info.isSymbolicLink()) fail('BUILD_SYMLINK', rel, `Build input ${rel} is a symbolic link.`, 'Use regular project files; symlinked build inputs are not copied.')
    if (info.isDirectory()) found.push(...await walkFiles(root, rel))
    else if (info.isFile()) found.push(rel)
    else fail('BUILD_SPECIAL_FILE', rel, `Build input ${rel} is not a regular file.`, 'Remove sockets, devices, or other special files from plugin resources.')
  }
  return found
}

function outputRole(relativePath, preload) {
  const extension = path.extname(relativePath).toLowerCase()
  if (relativePath === preload) return { role: 'node-preload', mediaType: 'text/javascript' }
  if (relativePath.startsWith('web/')) {
    const mediaType = CONTENT_TYPES.get(extension)
    if (!mediaType) fail('BUILD_MEDIA_TYPE', relativePath, `The Web runtime output type ${extension || '(no extension)'} is not in Manifest v3.`, 'Use a supported web asset extension or place this file in assets/ as an opaque resource.')
    return { role: 'web', mediaType }
  }
  if (relativePath.startsWith('resources/')) {
    if (['.exe', '.com'].includes(extension)) return { role: 'helper', mediaType: 'application/octet-stream' }
    if (extension === '.dll') return { role: 'library', mediaType: 'application/octet-stream' }
    const mediaType = CONTENT_TYPES.get(extension) ?? 'application/octet-stream'
    return { role: 'resource', mediaType }
  }
  fail('BUILD_OUTPUT_UNEXPECTED', relativePath, `Unexpected file in Runtime 2.0 build output: ${relativePath}.`, 'Use web/, preload/, or assets/ source directories.')
}

async function materializeAssets(projectRoot, outputRoot) {
  const source = path.join(projectRoot, 'assets')
  const entries = await walkFiles(projectRoot, 'assets')
  for (const entry of entries) {
    const relative = entry.slice('assets/'.length)
    const target = path.join(outputRoot, 'resources', ...relative.split('/'))
    await mkdir(path.dirname(target), { recursive: true })
    await copyFile(path.join(source, ...relative.split('/')), target)
  }
}

async function compileNodePreload(projectRoot, outputRoot) {
  const configPath = path.join(projectRoot, 'tsconfig.preload.json')
  const configInfo = await lstat(configPath).catch(() => undefined)
  if (!configInfo) return
  if (configInfo.isSymbolicLink() || !configInfo.isFile()) fail('BUILD_PRELOAD_CONFIG', 'tsconfig.preload.json', 'The Node preload TypeScript config is not a regular file.', 'Restore the generated tsconfig.preload.json.')
  const projectRequire = createRequire(path.join(projectRoot, 'package.json'))
  let typescript
  try { typescript = projectRequire('typescript') } catch { fail('BUILD_TYPESCRIPT_MISSING', 'tsconfig.preload.json', 'The TypeScript compiler is not installed in this plugin project.', 'Run pnpm install or npm install in the plugin project.') }
  const read = typescript.readConfigFile(configPath, typescript.sys.readFile)
  if (read.error) fail('BUILD_PRELOAD_CONFIG', 'tsconfig.preload.json', 'The Node preload TypeScript config could not be read.', 'Fix tsconfig.preload.json and rerun build.')
  const parsed = typescript.parseJsonConfigFileContent(read.config, typescript.sys, projectRoot)
  const program = typescript.createProgram(parsed.fileNames, { ...parsed.options, outDir: path.join(outputRoot, 'preload'), noEmit: false })
  const diagnostics = [...parsed.errors, ...typescript.getPreEmitDiagnostics(program)]
  if (diagnostics.some(item => item.category === typescript.DiagnosticCategory.Error)) {
    const first = diagnostics.find(item => item.category === typescript.DiagnosticCategory.Error)
    const where = first?.file && first.start !== undefined ? `${path.relative(projectRoot, first.file.fileName)}:${first.file.getLineAndCharacterOfPosition(first.start).line + 1}` : 'tsconfig.preload.json'
    const message = typescript.flattenDiagnosticMessageText(first.messageText, '\n')
    fail('BUILD_PRELOAD_FAILED', where, `Node Plugin preload failed to compile: ${message}`, 'Fix the TypeScript error in the reported preload source and rebuild.')
  }
  const emitted = program.emit()
  if (emitted.emitSkipped || emitted.diagnostics.some(item => item.category === typescript.DiagnosticCategory.Error)) fail('BUILD_PRELOAD_FAILED', 'preload/', 'The Node Plugin preload was not emitted.', 'Check the TypeScript diagnostics and preload output path.')
  const preload = path.join(outputRoot, 'preload', 'index.js')
  const finalPreload = path.join(outputRoot, 'preload', 'index.cjs')
  await import('node:fs/promises').then(fs => fs.rename(preload, finalPreload)).catch(() => fail('BUILD_PRELOAD_MISSING', 'preload/index.cjs', 'The preload compiler did not produce preload/index.js.', 'Set tsconfig.preload.json outDir/rootDir to the generated Node starter defaults.'))
}

export async function createRuntimeManifest(projectRoot, outputRoot, sourceManifest) {
  const files = await walkFiles(outputRoot)
  const preload = sourceManifest.runtime?.kind === 'node' ? sourceManifest.runtime.preload : undefined
  const commandEntries = new Set((sourceManifest.features ?? []).filter(feature => feature.entry?.kind === 'node-command').map(feature => feature.entry.module))
  const runtimeFiles = files.filter(file => file !== 'manifest.json').map(relative => ({ path: relative,
    ...(commandEntries.has(relative) ? { role: 'node-command', mediaType: 'text/javascript' } : outputRole(relative, preload)) }))
  const manifest = {
    ...sourceManifest,
    runtimeFiles,
    dependencies: [],
  }
  const target = JSON.parse(await readFile(TARGET_PATH, 'utf8'))
  if (manifest.runtime?.kind === 'node' && manifest.runtimeFiles.some(file => file.path.endsWith('.node')) && !manifest.compatibility.nodeAbi) {
    manifest.compatibility = { ...manifest.compatibility, nodeAbi: target.nodeAbi }
  }
  return manifest
}

async function validateBuildReferences(outputRoot, manifest) {
  const files = new Set(await walkFiles(outputRoot))
  if (manifest.runtime?.preload !== undefined) {
    const preload = manifest.runtime.preload
    if (typeof preload !== 'string' || !files.has(preload)) fail('BUILD_MISSING_PRELOAD', 'manifest.runtime.preload',
      'manifest.runtime.preload does not exist in the generated build output.', 'Point runtime.preload at the emitted .cjs file under dist/ and rebuild.')
  }
  for (let index = 0; index < (manifest.features ?? []).length; index++) {
    const entry = manifest.features[index]?.entry
    const document = entry?.kind === 'node-command' ? entry.module : entry?.document
    if (typeof document !== 'string' || !files.has(document)) fail('BUILD_MISSING_ENTRY', `features[${index}].entry.document`,
      `features[${index}].entry.document does not exist in the generated build output.`, 'Point the Feature entry at an emitted web HTML file under dist/ and rebuild.')
  }
}

export async function buildPluginProject(projectDirectory = process.cwd(), options = {}) {
  const projectRoot = await requireProjectDirectory(projectDirectory)
  const manifest = await readJson(path.join(projectRoot, 'manifest.json'), 'manifest.json')
  if (manifest.manifestVersion !== 3) fail('BUILD_MANIFEST_VERSION', 'manifest.json', 'The Runtime 2.0 build command requires Manifest v3.', 'Use the legacy SDK create command only for Manifest v1 declarative plugins.')
  const outputRoot = await assertOutputPath(projectRoot, path.join(projectRoot, 'dist'), 'dist')
  for (const generated of ['preload', 'resources']) {
    const destination = path.join(outputRoot, generated)
    const info = await lstat(destination).catch(() => undefined)
    if (info?.isSymbolicLink() || (info && !info.isDirectory())) fail('BUILD_OUTPUT_PATH', `dist/${generated}`, `dist/${generated} is not a regular generated directory.`, 'Remove the conflicting link or file and retry.')
    if (info) await rm(destination, { recursive: true })
  }
  const oldManifest = path.join(outputRoot, 'manifest.json')
  const oldManifestInfo = await lstat(oldManifest).catch(() => undefined)
  if (oldManifestInfo?.isSymbolicLink() || (oldManifestInfo && !oldManifestInfo.isFile())) fail('BUILD_OUTPUT_PATH', 'dist/manifest.json', 'dist/manifest.json is not a regular generated file.', 'Remove the conflicting link or directory and retry.')
  if (oldManifestInfo) await rm(oldManifest)

  await materializeAssets(projectRoot, outputRoot)
  if ((manifest.features ?? []).some(feature => feature.entry?.kind === 'web-bundle')) {
    const projectRequire = createRequire(path.join(projectRoot, 'package.json'))
    let vite
    try { const entry = projectRequire.resolve('vite'); vite = await import(pathToFileURL(entry).href) }
    catch { fail('BUILD_VITE_MISSING', 'package.json', 'Vite is not installed in this plugin project.', 'Run pnpm install or npm install in the plugin project.') }
    try { await vite.build({ root: path.join(projectRoot, 'web'), configFile: path.join(projectRoot, 'vite.config.ts'), mode: options.mode ?? 'production' }) }
    catch (error) { fail('BUILD_WEB_FAILED', 'web/', `Web bundle build failed: ${String(error?.message ?? error).split('\n')[0]}`, 'Fix the first Vite diagnostic and run webtools-plugin build again.') }
  }

  if (manifest.runtime?.kind === 'node' && manifest.runtime.preload) await compileNodePreload(projectRoot, outputRoot)
  const runtimeManifest = await createRuntimeManifest(projectRoot, outputRoot, manifest)
  await validateBuildReferences(outputRoot, runtimeManifest)
  try { parseManifestV3(Buffer.from(JSON.stringify(runtimeManifest)), manifest.api.minHostVersion) }
  catch (error) {
    const code = error?.code ?? 'INVALID_FIELD'
    fail('BUILD_MANIFEST_INVALID', 'manifest.json', `The generated Manifest v3 output is invalid (${code}).`, 'Check feature entries, runtime kind, preload path, and output file types.')
  }
  await writeFile(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(runtimeManifest, null, 2)}\n`, { flag: 'wx' })
  return { projectRoot, outputRoot, manifest: runtimeManifest, files: runtimeManifest.runtimeFiles.map(file => file.path) }
}
