import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  LIMITS_V1,
  PluginValidationError,
  packPluginV1,
  validatePluginArchiveV1,
  validatePluginSourceV1,
} from '../index.mjs'
import { createPluginStarter } from './create.mjs'
import { inspectPluginArchiveFile, safeDisplayText } from './inspect.mjs'
import { errorRecord, printError, printHelp, printInfo, printJson, printWarning } from './diagnostics.mjs'

const helpText = `WebTools declarative plugin tools

Usage:
  webtools-plugin create <directory> --host-version <version> [--id <id>] [--name <name>] [--description <text>] [--author <name>] [--min-host-version <version>] [--json]
  webtools-plugin validate <directory|file.wtplugin> --host-version <version> [--json]
  webtools-plugin pack <directory> --out <file.wtplugin> --host-version <version> [--json]
  webtools-plugin inspect <file.wtplugin> --host-version <version> [--json]
  webtools-plugin --help

The SDK is a local authoring tool. WebTools validates packages again when installing them.`

const commandOptions = {
  create: { values: ['--host-version', '--id', '--name', '--description', '--author', '--min-host-version'], required: ['--host-version'] },
  validate: { values: ['--host-version'], required: ['--host-version'] },
  pack: { values: ['--out', '--host-version'], required: ['--out', '--host-version'] },
  inspect: { values: ['--host-version'], required: ['--host-version'] },
}

function usageError() { return new PluginValidationError('CLI_USAGE', 'manifest.json') }

function parseArguments(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { help: true }

  const [command, target, ...tail] = argv
  const schema = commandOptions[command]
  if (!schema || !target || target.startsWith('--')) throw usageError()

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
  }
}

function displayedOutputPath(output) {
  const resolved = path.resolve(output)
  const relative = path.relative(process.cwd(), resolved)
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) return path.basename(resolved)
  return (relative || path.basename(resolved)).split(path.sep).join('/')
}

async function validateTarget(target, hostVersion) {
  let targetStat
  try { targetStat = await stat(target) }
  catch { throw new PluginValidationError('SOURCE_IO', 'manifest.json') }

  if (targetStat.isDirectory()) return validatePluginSourceV1(target, hostVersion)
  if (!targetStat.isFile() || targetStat.size <= 0 || targetStat.size > LIMITS_V1.archive) {
    throw new PluginValidationError('INVALID_PACKAGE', 'package.wtplugin')
  }

  let bytes
  try { bytes = await readFile(target) }
  catch { throw new PluginValidationError('SOURCE_IO', 'package.wtplugin') }
  return validatePluginArchiveV1(bytes, hostVersion)
}

async function execute(args) {
  switch (args.command) {
    case 'validate': {
      const checked = await validateTarget(args.target, args.hostVersion)
      return {
        valid: checked.valid,
        plugin: pluginSummary(checked.manifest),
        warnings: checked.warnings ?? [],
      }
    }
    case 'pack': {
      const packed = await packPluginV1(args.target, args.output, args.hostVersion)
      return { ...packed, plugin: pluginSummary(packed.manifest), output: displayedOutputPath(args.output) }
    }
    case 'create': {
      const created = await createPluginStarter(args.target, args)
      return { directory: created.directory, plugin: pluginSummary(created.manifest) }
    }
    case 'inspect':
      return inspectPluginArchiveFile(args.target, args.hostVersion)
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

    const result = await execute(args)
    if (args.json) {
      printJson({ ok: true, command: args.command, result })
      return 0
    }

    if (args.command === 'validate') {
      for (const warning of result.warnings) printWarning(warning.code, warning.message)
      printInfo(`Plugin ${result.plugin.id} ${result.plugin.version}; Manifest v${result.plugin.manifestVersion}; API major ${result.plugin.apiMajor}.`)
      printInfo('VALID — source or archive checks passed. Installation consent remains a separate host check.')
      return 0
    }

    if (args.command === 'pack') {
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
      printInfo(`Requested capabilities: ${result.plugin.capabilities.map(capability => safeDisplayText(capability)).join(', ')}.`)
      printInfo(`VALID — ${result.size} bytes; SHA-256 ${result.sha256}. WebTools performs authoritative validation and consent when installing.`)
      return 0
    }

    throw usageError()
  } catch (error) {
    const diagnostic = errorRecord(error)
    if (requestedJson) printJson({ ok: false, command: fallbackCommand, error: diagnostic })
    else printError(error)
    return diagnostic.code === 'CLI_USAGE' ? 2 : 1
  }
}
