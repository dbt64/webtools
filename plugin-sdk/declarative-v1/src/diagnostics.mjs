const diagnostics = {
  INVALID_INPUT: {
    message: 'A manifest field or action value does not match the supported contract.',
    suggestion: 'Use the documented Manifest v1 field type and bounds.',
  },
  INVALID_MANIFEST: {
    message: 'Manifest v1 is invalid or references an unsupported field.',
    suggestion: 'Check the Manifest v1 field names, types, bounds, and references.',
  },
  INCOMPATIBLE_PLUGIN: {
    message: 'The plugin requires a newer host or unsupported API major.',
    suggestion: 'Target Plugin API major 1 and set minHostVersion no higher than the selected host.',
  },
  INVALID_PACKAGE: {
    message: 'The package, declared asset, or archive exceeds a host security rule.',
    suggestion: 'Use a valid .wtplugin containing only declared safe files.',
  },
  SOURCE_IO: {
    message: 'A source file could not be safely read as a regular file.',
    suggestion: 'Check the plugin source and retry.',
  },
  SENSITIVE_CONTENT: {
    message: 'The manifest appears to contain credential-like content; remove secrets from package metadata.',
    suggestion: 'Remove credential-like content from the manifest and declared assets.',
  },
  OUTPUT_EXISTS: {
    message: 'The output file already exists; choose a different path.',
    suggestion: 'Choose a new output filename; existing files are never overwritten.',
  },
  OUTPUT_IO: {
    message: 'The output could not be safely written; no completed package was published.',
    suggestion: 'Check the destination directory and retry with a new output filename.',
  },
  CLI_USAGE: {
    message: 'The command or its options are invalid.',
    suggestion: 'Run webtools-plugin --help for command syntax.',
  },
  GENERIC_ICON: {
    message: 'No entry icon is declared; WebTools will use its generic plugin icon.',
    suggestion: 'Add a small declared PNG icon if the plugin should have a custom icon.',
  },
}

const safePathFallback = 'manifest.json'
const safeFieldPattern = /^[A-Za-z][A-Za-z0-9_.\[\]-]{0,119}$/

function safeRelativePath(path) {
  if (typeof path !== 'string' || path.length === 0 || path.length > 240) return safePathFallback
  if (path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path) || /[\\\x00-\x1f\x7f]/.test(path)) return safePathFallback
  const segments = path.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return safePathFallback
  return path
}

export function errorRecord(error) {
  const code = error && typeof error === 'object' && Object.hasOwn(diagnostics, error.code) ? error.code : 'INVALID_PACKAGE'
  const record = { code, path: safeRelativePath(error?.path), ...diagnostics[code] }
  if (typeof error?.field === 'string' && safeFieldPattern.test(error.field)) record.field = error.field
  return record
}

export function printError(error) {
  const item = errorRecord(error)
  const field = item.field ? ` (${item.field})` : ''
  process.stderr.write(`[ERROR] ${item.code} ${item.path}${field}: ${item.message} Fix: ${item.suggestion}\n`)
}

export function printInfo(text) { process.stdout.write(`[INFO] ${text}\n`) }
export function printWarning(code, text) { process.stdout.write(`[WARNING] ${code}: ${text}\n`) }
export function printHelp(text) { process.stdout.write(`${text.trimEnd()}\n`) }
export function printJson(value) { process.stdout.write(`${JSON.stringify(value)}\n`) }
