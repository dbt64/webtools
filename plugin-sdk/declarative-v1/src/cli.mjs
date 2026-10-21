import { lstat, readFile, stat } from 'node:fs/promises'
import { watch } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  LIMITS_V1,
  LIMITS_V3,
  ManifestV3ValidationError,
  PluginValidationError,
  packPluginV1,
  packPluginV3,
  validatePluginArchiveV1,
  validatePluginArchiveV2,
  validatePluginArchiveV3,
  validatePluginSourceV1,
  validatePluginSourceV3,
} from '../index.mjs'
import { createPluginStarter } from './create.mjs'
import { safeDisplayText } from './inspect.mjs'
import { errorRecord, printError, printHelp, printInfo, printJson, printWarning } from './diagnostics.mjs'
import { readIncomingManifestVersion } from '../runtime-v3/package-v3.mjs'
import { buildPluginProject } from './build-v3.mjs'
import { createDevelopmentConnection } from './development-connection.mjs'

const SDK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RUNTIME_TARGET_PATH = path.join(SDK_ROOT, 'runtime-target.json')

const helpText = `WebTools declarative plugin tools

Usage:
  webtools-plugin create <directory> --host-version <version> [--id <id>] [--name <name>] [--description <text>] [--author <name>] [--min-host-version <version>] [--json]
  webtools-plugin dev [project-directory]
  webtools-plugin build [project-directory] [--mode <mode>] [--json]
  webtools-plugin validate <directory|file.wtplugin> --host-version <version> [--project-root <directory>] [--json]
  webtools-plugin pack <directory> --out <file.wtplugin> --host-version <version> [--project-root <directory>] [--json]
  webtools-plugin inspect <file.wtplugin> --host-version <version> [--json]
  webtools-plugin --help

The SDK is a local authoring tool. WebTools validates packages again when installing them.`

const commandOptions = {
  create: { values: ['--host-version', '--id', '--name', '--description', '--author', '--min-host-version'], required: ['--host-version'] },
  dev: { values: [], required: [] },
  build: { values: ['--mode'], required: [] },
  validate: { values: ['--host-version', '--project-root'], required: ['--host-version'] },
  pack: { values: ['--out', '--host-version', '--project-root'], required: ['--out', '--host-version'] },
  inspect: { values: ['--host-version'], required: ['--host-version'] },
}

function usageError() { return new PluginValidationError('CLI_USAGE', 'manifest.json') }

function parseArguments(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { help: true }

  const [command, first, ...remaining] = argv
  const hasTarget = typeof first === 'string' && !first.startsWith('--')
  const target = hasTarget ? first : undefined
  const tail = hasTarget ? remaining : [first, ...remaining].filter(value => value !== undefined)
  const schema = commandOptions[command]
  if (!schema || (target?.startsWith('--')) || (!target && !['dev', 'build'].includes(command))) throw usageError()

  const options = new Map()
  let json = false
  for (let index = 0; index < tail.length; index++) {
    const option = tail[index]
    if (option === '--json') {
      if (json) throw usageError()
      json = true
      continue
    }
    if (!schema.values.includes(option) || options.has(option)) throw usageError()
    const value = tail[index + 1]
    if (typeof value !== 'string' || !value || value.startsWith('--')) throw usageError()
    options.set(option, value)
    index++
  }

  if (schema.required.some(option => !options.has(option))) throw usageError()
  return {
    command,
    target,
    hostVersion: options.get('--host-version'),
    output: options.get('--out'),
    id: options.get('--id'),
    name: options.get('--name'),
    description: options.get('--description'),
    author: options.get('--author'),
    minHostVersion: options.get('--min-host-version'),
    projectRoot: options.get('--project-root'),
    mode: options.get('--mode'),
    json,
  }
}

function pluginSummary(manifest) {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    manifestVersion: manifest.manifestVersion,
    apiMajor: manifest.api.apiMajor,
    minHostVersion: manifest.api.minHostVersion,
    ...(manifest.runtime ? { runtime: manifest.runtime.kind } : {}),
  }
}

function displayedOutputPath(output) {
  const resolved = path.resolve(output)
  const relative = path.relative(process.cwd(), resolved)
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) return path.basename(resolved)
  return (relative || path.basename(resolved)).split(path.sep).join('/')
}

async function runtimeTarget() {
  try {
    const target = JSON.parse(await readFile(RUNTIME_TARGET_PATH, 'utf8'))
    return { platform: target.platform, architecture: target.architecture, nodeAbi: target.nodeAbi }
  }
  catch { throw new PluginValidationError('INCOMPATIBLE_PLUGIN', 'compatibility') }
}

async function validateTarget(target, hostVersion, projectRoot) {
  let targetStat
  try { targetStat = await stat(target) }
  catch { throw new PluginValidationError('SOURCE_IO', 'manifest.json') }

  if (targetStat.isDirectory()) {
    let value
    try { value = JSON.parse(await readFile(path.join(target, 'manifest.json'), 'utf8')) } catch {}
    if (value?.manifestVersion === 3) {
      await validateManifestReferences(target, value)
      return validatePluginSourceV3(target, hostVersion, {
        ...(projectRoot ? { projectRoot } : {}), host: await runtimeTarget(),
      })
    }
    return validatePluginSourceV1(target, hostVersion)
  }
  if (!targetStat.isFile() || targetStat.size <= 0 || targetStat.size > LIMITS_V3.archive) {
    throw new PluginValidationError('INVALID_PACKAGE', 'package.wtplugin')
  }

  let bytes
  try { bytes = await readFile(target) }
  catch { throw new PluginValidationError('SOURCE_IO', 'package.wtplugin') }
  const manifestVersion = await readIncomingManifestVersion(bytes)
  if (manifestVersion === 1) return validatePluginArchiveV1(bytes, hostVersion)
  if (manifestVersion === 2) return validatePluginArchiveV2(bytes, hostVersion)
  if (manifestVersion === 3) return validatePluginArchiveV3(bytes, hostVersion, await runtimeTarget())
  throw new ManifestV3ValidationError('UNSUPPORTED_MANIFEST_VERSION')
}

class DeveloperValidationError extends Error {
  constructor(code, filePath, field, message, likelyCause, suggestion) {
    super(message)
    this.code = code; this.path = filePath; this.field = field
    this.likelyCause = likelyCause; this.suggestion = suggestion
  }
}

async function validateManifestReferences(root, manifest) {
  const declared = new Set(Array.isArray(manifest.runtimeFiles) ? manifest.runtimeFiles.map(file => file?.path).filter(value => typeof value === 'string') : [])
  const requireFile = async (relativePath, field, label) => {
    if (path.isAbsolute(relativePath) || relativePath.includes('\\') || relativePath.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new DeveloperValidationError('MISSING_RUNTIME_ENTRY', 'manifest.json', field,
        `${field}: "${relativePath}" is not a safe package-relative path.`,
        'The Manifest path is absolute or contains a traversal segment.',
        'Use a normalized path relative to the plugin build output.')
    }
    if (!declared.has(relativePath)) throw new DeveloperValidationError('MISSING_RUNTIME_ENTRY', 'manifest.json', field,
      `${field}: "${relativePath}" is missing from runtimeFiles.`,
      `The ${label} may have been renamed or omitted from the generated build output.`,
      'Run webtools-plugin build and make sure the referenced file is emitted under dist/.')
    try {
      const parts = relativePath.split('/')
      let current = root
      for (let index = 0; index < parts.length; index++) {
        current = path.join(current, parts[index])
        const fileInfo = await lstat(current)
        if (fileInfo.isSymbolicLink() || (index < parts.length - 1 && !fileInfo.isDirectory())
          || (index === parts.length - 1 && !fileInfo.isFile())) throw new Error('not a regular package path')
      }
    }
    catch { throw new DeveloperValidationError('MISSING_RUNTIME_ENTRY', 'manifest.json', field,
      `${field}: "${relativePath}" does not exist in the build output.`,
      `The ${label} path does not match a generated file.`,
      'Update the Manifest entry to the actual output path, then rebuild.') }
  }
  if (manifest.runtime?.kind === 'node' && typeof manifest.runtime.preload === 'string') {
    const preload = manifest.runtime.preload
    if (!preload.endsWith('.cjs')) throw new DeveloperValidationError('MISSING_PRELOAD', 'manifest.json', 'runtime.preload',
      `manifest.runtime.preload: "${preload}" must name a .cjs file.`,
      'Node Plugin preloads must use the CommonJS format required by the Host bootstrap.',
      'Set runtime.preload to the built .cjs path under dist/.')
    await requireFile(preload, 'runtime.preload', 'Node preload')
  }
  for (let index = 0; index < (Array.isArray(manifest.features) ? manifest.features.length : 0); index++) {
    const feature = manifest.features[index]
    if (typeof feature?.entry?.document === 'string') await requireFile(feature.entry.document, `features[${index}].entry.document`, 'Feature entry')
    if (typeof feature?.entry?.module === 'string') await requireFile(feature.entry.module, `features[${index}].entry.module`, 'Command entry')
  }
}

async function packTarget(target, output, hostVersion, projectRoot) {
  let value
  try { value = JSON.parse(await readFile(path.join(target, 'manifest.json'), 'utf8')) } catch {}
  if (value?.manifestVersion === 3) return packPluginV3(target, output, hostVersion, {
    ...(projectRoot ? { projectRoot } : {}), host: await runtimeTarget(),
  })
  if (value?.manifestVersion === 2) throw new ManifestV3ValidationError('INCOMPATIBLE_PLUGIN')
  return packPluginV1(target, output, hostVersion)
}

async function inspectTarget(target, hostVersion) {
  if (path.extname(target).toLowerCase() !== '.wtplugin') throw new PluginValidationError('INVALID_PACKAGE', 'package.wtplugin')
  const bytes = await readFile(target).catch(() => { throw new PluginValidationError('SOURCE_IO', 'package.wtplugin') })
  const version = await readIncomingManifestVersion(bytes)
  const host = version === 3 ? await runtimeTarget() : undefined
  const checked = version === 1 ? await validatePluginArchiveV1(bytes, hostVersion)
    : version === 2 ? await validatePluginArchiveV2(bytes, hostVersion)
      : version === 3 ? await validatePluginArchiveV3(bytes, hostVersion, host)
        : (() => { throw new ManifestV3ValidationError('UNSUPPORTED_MANIFEST_VERSION') })()
  const manifest = checked.manifest
  return { valid: true, plugin: { id: manifest.id, name: manifest.name, description: manifest.description, author: manifest.author,
    version: manifest.version, manifestVersion: manifest.manifestVersion, apiMajor: manifest.api.apiMajor,
    minHostVersion: manifest.api.minHostVersion, capabilities: manifest.requestedCapabilities,
    ...(manifest.runtime ? { runtime: manifest.runtime.kind } : {}),
    features: (manifest.features ?? manifest.pages ?? []).map(feature => ({ id: feature.id, title: feature.title })),
    ...(manifest.runtime?.preload ? { preload: manifest.runtime.preload } : {}),
    ...(manifest.compatibility ? { compatibility: manifest.compatibility } : {}),
    dependencies: (manifest.dependencies ?? []).map(dependency => ({ name: dependency.name, version: dependency.version, files: dependency.files.length })),
    nativeAddons: (manifest.runtimeFiles ?? []).filter(file => file.role === 'native-addon').map(file => file.path),
    helpers: (manifest.runtimeFiles ?? []).filter(file => file.role === 'helper').map(file => file.path),
    resources: (manifest.runtimeFiles ?? []).filter(file => file.role === 'resource' || file.role === 'library').map(file => file.path),
  }, size: checked.size, sha256: checked.sha256 }
}

async function startDevServer(projectDirectory) {
  const projectRoot = path.resolve(projectDirectory)
  const projectRequire = createRequire(path.join(projectRoot, 'package.json'))
  let vite
  try { vite = await import(pathToFileURL(projectRequire.resolve('vite')).href) }
  catch { throw Object.assign(new Error('Vite is not installed in this plugin project. Run pnpm install or npm install first.'), { code: 'BUILD_VITE_MISSING', path: 'package.json' }) }
  let server
  try {
    server = await vite.createServer({ root: path.join(projectRoot, 'web'), configFile: path.join(projectRoot, 'vite.config.ts'), server: { host: '127.0.0.1', open: false } })
    await server.listen()
  } catch (error) {
    await server?.close().catch(() => {})
    throw Object.assign(new Error(`The local development server could not start: ${String(error?.message ?? error).split('\n')[0]}`), { code: 'DEV_SERVER_FAILED', path: 'vite.config.ts' })
  }
  return { server, projectRoot }
}

export async function startDevSession(projectDirectory, callbacks = {}) {
  const projectRoot = path.resolve(projectDirectory)
  const initialBuild = await buildPluginProject(projectRoot, { mode: 'development' })
  const { server } = await startDevServer(projectRoot)
  let connection
  try {
    connection = await createDevelopmentConnection(projectRoot, {
      hostVersion: initialBuild.manifest.api.minHostVersion, host: await runtimeTarget(),
      onStatus: callbacks.onStatus ?? printInfo, onError: callbacks.onError ?? printError,
    })
    try { await connection?.publishBuild() } catch (error) { connection?.reportError(error); (callbacks.onError ?? printError)(error) }
  } catch (error) { await server.close(); throw error }
  let timer
  let building = false
  let runningBuild = Promise.resolve()
  let rebuildQueued = false
  let watcher
  let closed = false
  const shouldRebuild = relative => /^(?:web|preload|assets)(?:\/|$)|^(?:manifest\.json|package\.json|pnpm-lock\.yaml|vite\.config\.[cm]?[jt]s|tsconfig\.preload\.json)$/u.test(relative)
  const rebuild = async relative => {
    if (building) { rebuildQueued = true; return }
    building = true
    try {
      await buildPluginProject(projectRoot, { mode: 'development' })
      if (closed) return
      await connection?.publishBuild()
      const onRebuild = callbacks.onRebuild ?? (changedPath => printInfo(`Rebuilt dist/ after ${changedPath}; the connected development Feature reloads in WebTools.`))
      onRebuild(relative)
    } catch (error) { connection?.reportError(error); (callbacks.onError ?? printError)(error) }
    finally {
      building = false
      if (rebuildQueued && !closed) {
        rebuildQueued = false
        scheduleRebuild(relative)
      }
    }
  }
  const scheduleRebuild = relative => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (closed) return
      if (building) { rebuildQueued = true; return }
      runningBuild = rebuild(relative)
    }, 200)
  }
  try {
    watcher = watch(projectRoot, { recursive: true }, (_event, filename) => {
      const relative = String(filename ?? '').replaceAll('\\', '/')
      if (!relative || /^(?:node_modules|dist|\.git)(?:\/|$)/u.test(relative)) return
      if (!shouldRebuild(relative)) return
      scheduleRebuild(relative)
    })
    watcher.on('error', error => {
      const diagnostic = Object.assign(error, { code: 'DEV_WATCH_UNAVAILABLE', path: 'web/' })
      connection?.reportError(diagnostic)
      ;(callbacks.onError ?? printError)(diagnostic)
    })
  } catch (error) {
    await server.close().catch(() => {})
    await connection?.close()
    throw Object.assign(new Error('Recursive project watching is unavailable on this platform.'), { code: 'DEV_WATCH_UNAVAILABLE', path: 'web/' })
  }
  return {
    server,
    initialBuild,
    async close() {
      if (closed) return
      closed = true
      clearTimeout(timer)
      watcher.close()
      await runningBuild
      await connection?.close()
      await server.close()
    },
  }
}

async function execute(args) {
  switch (args.command) {
    case 'validate': {
      const checked = await validateTarget(args.target, args.hostVersion, args.projectRoot)
      return {
        valid: checked.valid,
        plugin: pluginSummary(checked.manifest),
        warnings: checked.warnings ?? [],
      }
    }
    case 'pack': {
      const packed = await packTarget(args.target, args.output, args.hostVersion, args.projectRoot)
      return { ...packed, plugin: pluginSummary(packed.manifest), output: displayedOutputPath(args.output) }
    }
    case 'build':
      return buildPluginProject(args.target ?? process.cwd(), { mode: args.mode })
    case 'dev':
      return startDevSession(args.target ?? process.cwd())
    case 'create': {
      const created = await createPluginStarter(args.target, args)
      return { directory: created.directory, plugin: pluginSummary(created.manifest) }
    }
    case 'inspect':
      return inspectTarget(args.target, args.hostVersion)
  }
  throw usageError()
}

function safeCommand(value) { return Object.hasOwn(commandOptions, value) ? value : 'unknown' }

export async function runCli(argv) {
  const requestedJson = argv.includes('--json')
  const fallbackCommand = safeCommand(argv[0])
  try {
    const args = parseArguments(argv)
    if (args.help) {
      printHelp(helpText)
      return 0
    }

    if (args.command === 'dev' && args.json) throw new DeveloperValidationError('DEV_JSON_UNSUPPORTED', 'vite.config.ts', undefined,
      'The long-running dev server does not support --json output.', 'JSON mode is intended for one-shot commands.', 'Run webtools-plugin dev without --json.')

    const result = await execute(args)
    if (args.json) {
      printJson({ ok: true, command: args.command, result })
      return 0
    }

    if (args.command === 'validate') {
      for (const warning of result.warnings) {
        if (warning.code === 'OPTIONAL_DEPENDENCY_MISSING') {
          const dependency = typeof warning.dependency === 'string' ? safeDisplayText(warning.dependency) : 'optional dependency'
          printWarning(warning.code, `Optional dependency ${dependency} was not installed and was omitted.`)
        } else printWarning(warning.code, safeDisplayText(warning.message ?? ''))
      }
      printInfo(`Plugin ${result.plugin.id} ${result.plugin.version}; Manifest v${result.plugin.manifestVersion}; API major ${result.plugin.apiMajor}.`)
      printInfo('VALID — source or archive checks passed. Installation consent remains a separate host check.')
      return 0
    }

    if (args.command === 'pack') {
      if (result.plugin.runtime === 'node') printWarning('NODE_LOCAL_CODE', 'This Node Plugin runs local code as the current Windows user; WebTools Host API permissions do not create an operating-system sandbox.')
      for (const warning of result.warnings ?? []) printWarning(warning.code, `Optional dependency ${safeDisplayText(warning.dependency)} was not installed and was omitted.`)
      printInfo(`Plugin ${result.plugin.id} ${result.plugin.version}; API major ${result.plugin.apiMajor}.`)
      printInfo(`Output ${result.output}; ${result.size} bytes; SHA-256 ${result.sha256}; VALIDATED.`)
      return 0
    }

    if (args.command === 'create') {
      printInfo(`Created basic starter ${result.plugin.id} in ${result.directory}.`)
      printInfo('Add the supplied local @webtools/plugin-sdk tarball as a development dependency, then run the generated workflow scripts.')
      return 0
    }

    if (args.command === 'inspect') {
      printInfo(`Plugin ${safeDisplayText(result.plugin.id)} — ${safeDisplayText(result.plugin.name)} (${safeDisplayText(result.plugin.version)}).`)
      printInfo(`Description: ${safeDisplayText(result.plugin.description) || '(empty)'}`)
      printInfo(`Author: ${safeDisplayText(result.plugin.author.name)}; Manifest v${result.plugin.manifestVersion}; API major ${result.plugin.apiMajor}; minimum Host ${safeDisplayText(result.plugin.minHostVersion)}.`)
      printInfo(`Features: ${result.plugin.features.map(feature => safeDisplayText(`${feature.id} (${feature.title})`)).join(', ')}.`)
      printInfo(`Requested capabilities: ${result.plugin.capabilities.map(capability => safeDisplayText(capability)).join(', ') || '(none)'}.`)
      if (result.plugin.compatibility) printInfo(`Compatibility: ${result.plugin.compatibility.platforms.join(', ')} / ${result.plugin.compatibility.architectures.join(', ')}${result.plugin.compatibility.nodeAbi ? ` / Node ABI ${result.plugin.compatibility.nodeAbi}` : ''}.`)
      if (result.plugin.preload) printInfo(`Node preload: ${safeDisplayText(result.plugin.preload)}.`)
      printInfo(`Dependencies: ${result.plugin.dependencies.map(item => `${safeDisplayText(item.name)}@${safeDisplayText(item.version)} (${item.files} files)`).join(', ') || '(none)'}.`)
      printInfo(`Native addons: ${result.plugin.nativeAddons.map(item => safeDisplayText(item)).join(', ') || '(none)'}. Helper executables: ${result.plugin.helpers.map(item => safeDisplayText(item)).join(', ') || '(none)'}.`)
      printInfo(`Resources: ${result.plugin.resources.map(item => safeDisplayText(item)).join(', ') || '(none)'}.`)
      printInfo(`VALID — ${result.size} bytes; SHA-256 ${result.sha256}. WebTools performs authoritative validation and consent when installing.`)
      return 0
    }

    if (args.command === 'build') {
      printInfo(`Built ${result.plugin?.id ?? result.manifest?.id ?? 'Manifest v3 plugin'} to ${displayedOutputPath(path.join(result.outputRoot, 'manifest.json'))}.`)
      return 0
    }

    if (args.command === 'dev') {
      const address = result.server.httpServer.address()
      printInfo(`Development preview is available at http://127.0.0.1:${address.port}/.`)
      printInfo(`Initial Runtime-ready build: ${displayedOutputPath(path.join(result.initialBuild.outputRoot, 'manifest.json'))}.`)
      printInfo('Vite HMR updates the loopback preview. Connect this project in WebTools Developer Mode for automatic Host Feature restart after successful rebuilds. Production installation still uses Host-authoritative validation.')
      let stopping = false
      const close = async () => { if (!stopping) { stopping = true; await result.close() } }
      return new Promise(resolve => {
        const stop = () => { void close().then(() => resolve(0)) }
        process.once('SIGINT', stop)
        process.once('SIGTERM', stop)
      })
    }

    throw usageError()
  } catch (error) {
    const diagnostic = errorRecord(error)
    if (requestedJson) printJson({ ok: false, command: fallbackCommand, error: diagnostic })
    else printError(error)
    return diagnostic.code === 'CLI_USAGE' ? 2 : 1
  }
}
