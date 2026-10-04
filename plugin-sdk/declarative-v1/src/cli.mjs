import { readFile, stat } from 'node:fs/promises'
import { validatePackageV1 } from '../runtime/package-v1.mjs'
import { LIMITS_V1, PluginValidationError } from '../runtime/manifest-v1.mjs'
import { readPluginSource } from './source.mjs'
import { errorRecord, printError, printInfo, printWarning } from './diagnostics.mjs'
import { rejectCredentialLike } from './sensitive-content.mjs'

function parseArguments(argv) {
  const [command, target, ...tail] = argv
  const options = new Map()
  for (let i = 0; i < tail.length; i += 2) {
    const key = tail[i]
    if (!key?.startsWith('--') || !tail[i + 1] || options.has(key)) throw Object.assign(new Error(), { code: 'CLI_USAGE' })
    options.set(key, tail[i + 1])
  }
  const hostVersion = options.get('--host-version')
  if (!target || !hostVersion || !['validate', 'pack'].includes(command)) throw Object.assign(new Error(), { code: 'CLI_USAGE' })
  if (command === 'pack' && (!options.get('--out') || options.size !== 2)) throw Object.assign(new Error(), { code: 'CLI_USAGE' })
  if (command === 'validate' && options.size !== 1) throw Object.assign(new Error(), { code: 'CLI_USAGE' })
  return { command, target, hostVersion, output: options.get('--out') }
}

async function validate(target, hostVersion) {
  let targetStat
  try { targetStat = await stat(target) } catch { throw Object.assign(new Error(), { code: 'SOURCE_IO', path: 'manifest.json' }) }
  if (targetStat.isDirectory()) {
    const source = await readPluginSource(target, hostVersion)
    rejectCredentialLike(source.manifestBytes, 'manifest.json')
    for (const [relative, bytes] of source.assets) rejectCredentialLike(bytes, relative)
    if (!source.manifest.entry.icon) printWarning('GENERIC_ICON', 'No entry icon is declared; WebTools will use its generic plugin icon.')
    return source.manifest
  }
  if (!targetStat.isFile() || targetStat.size <= 0 || targetStat.size > LIMITS_V1.archive) throw Object.assign(new Error(), { code: 'INVALID_PACKAGE', path: 'package.wtplugin' })
  let bytes
  try { bytes = await readFile(target) } catch { throw Object.assign(new Error(), { code: 'SOURCE_IO', path: 'package.wtplugin' }) }
  if (bytes.length > LIMITS_V1.archive) throw Object.assign(new Error(), { code: 'INVALID_PACKAGE', path: 'package.wtplugin' })
  const result = await validatePackageV1(bytes, hostVersion)
  rejectCredentialLike(Buffer.from(JSON.stringify(result.manifest)), 'manifest.json')
  for (const [relative, asset] of result.assets) rejectCredentialLike(asset, relative)
  return result.manifest
}

export async function runCli(argv) {
  try {
    const args = parseArguments(argv)
    if (args.command === 'validate') {
      const manifest = await validate(args.target, args.hostVersion)
      printInfo(`Plugin ${manifest.id} ${manifest.version}; Manifest v${manifest.manifestVersion}; API major ${manifest.api.apiMajor}.`)
      printInfo('VALID — source checks passed. Archive and installation consent remain separate host checks.')
      return 0
    }
    const { packPlugin } = await import('./pack.mjs')
    const result = await packPlugin(args.target, args.output, args.hostVersion)
    printInfo(`Plugin ${result.id} ${result.version}; API major ${result.apiMajor}.`)
    printInfo(`Output ${result.output}; ${result.size} bytes; SHA-256 ${result.sha256}; VALIDATED.`)
    return 0
  } catch (error) {
    printError(error)
    return errorRecord(error).code === 'CLI_USAGE' ? 2 : 1
  }
}
