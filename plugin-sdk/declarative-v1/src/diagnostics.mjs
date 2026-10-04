const messages = {
  INVALID_INPUT: 'A manifest field or action value does not match the supported contract.',
  INVALID_MANIFEST: 'Manifest v1 is invalid or references an unsupported field.',
  INCOMPATIBLE_PLUGIN: 'The plugin requires a newer host or unsupported API major.',
  INVALID_PACKAGE: 'The package, declared asset, or archive exceeds a host security rule.',
  SOURCE_IO: 'A source file could not be safely read as a regular file.',
  SENSITIVE_CONTENT: 'The manifest appears to contain credential-like content; remove secrets from package metadata.',
  OUTPUT_EXISTS: 'The output file already exists; choose a different path.',
  OUTPUT_IO: 'The output could not be safely written; no completed package was published.',
  CLI_USAGE: 'Use validate <directory|file.wtplugin> --host-version <version> or pack <directory> --out <file.wtplugin> --host-version <version>.',
}

export function errorRecord(error) {
  const code = error && typeof error === 'object' && typeof error.code === 'string' ? error.code : 'INVALID_PACKAGE'
  const path = error && typeof error === 'object' && typeof error.path === 'string' ? error.path : 'manifest.json'
  const safePath = /^[A-Za-z0-9._/-]{1,240}$/.test(path) ? path : 'manifest.json'
  const suggestion = error && typeof error === 'object' && typeof error.suggestion === 'string' ? error.suggestion : 'Check the plugin source and retry.'
  return { code, path: safePath, message: messages[code] ?? 'Plugin validation failed.', suggestion }
}

export function printError(error) {
  const item = errorRecord(error)
  process.stderr.write(`[ERROR] ${item.code} ${item.path}: ${item.message} Fix: ${item.suggestion}\n`)
}

export function printInfo(text) { process.stdout.write(`[INFO] ${text}\n`) }
export function printWarning(code, text) { process.stdout.write(`[WARNING] ${code}: ${text}\n`) }
