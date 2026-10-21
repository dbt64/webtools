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
  UNSUPPORTED_MANIFEST_VERSION: {
    message: 'The plugin manifest version is not supported by this SDK.',
    suggestion: 'Use Manifest v1 for declarative pages or Manifest v3 for the current Web/Node runtime.',
  },
  UNKNOWN_FIELD: {
    message: 'The manifest contains a field that is not part of its closed contract.',
    suggestion: 'Remove the field or use the current Manifest v3 schema.',
  },
  INVALID_FIELD: {
    message: 'A manifest field has an invalid value or combination.',
    suggestion: 'Check the current Manifest v3 schema and runtime inventory rules.',
  },
  INVALID_CAPABILITY: {
    message: 'A requested capability is unknown or not supported by Manifest v3.',
    suggestion: 'Use only WebTools Host capabilities listed by the SDK; browser and Node APIs do not need Host capability entries.',
  },
  INVALID_PATH: {
    message: 'A source or runtime inventory path is unsafe or collides with another path.',
    suggestion: 'Use unique normalized package-relative paths with forward slashes.',
  },
  INVENTORY_MISMATCH: {
    message: 'Declared runtime files do not match the package contents or dependency metadata.',
    suggestion: 'Check runtimeFiles and dependency package.json versions; the packer materializes production dependencies from package.json.',
  },
  UNSUPPORTED_FILE_TYPE: {
    message: 'A runtime file does not match its declared role or expected binary metadata.',
    suggestion: 'Declare valid runtime resources and build native files for the target Windows architecture and Electron Node ABI.',
  },
  UNSAFE_ARCHIVE: {
    message: 'The package archive has invalid ZIP structure or unsafe entry metadata.',
    suggestion: 'Rebuild the package with the supplied SDK pack command.',
  },
  PACKAGE_LIMIT_EXCEEDED: {
    message: 'The package exceeds a Runtime v3 archive, file, inventory, or expanded-size limit.',
    suggestion: 'Reduce the runtime payload to files needed at execution time.',
  },
  DEPENDENCY_NOT_FOUND: {
    message: 'A declared production dependency is not installed in the plugin project.',
    suggestion: 'Install production dependencies with pnpm or npm, then rerun the SDK pack command.',
  },
  DEPENDENCY_INVALID: {
    message: 'A dependency package does not contain valid identity metadata.',
    suggestion: 'Ensure each production dependency has a valid package.json name and version.',
  },
  UNSAFE_DEPENDENCY_LINK: {
    message: 'A dependency link escapes the plugin project dependency tree.',
    suggestion: 'Install production dependencies into the plugin project node_modules before packing.',
  },
  DEPENDENCY_COLLISION: {
    message: 'Two dependency instances resolve to the same package location with different identities.',
    suggestion: 'Reinstall the dependency graph with pnpm or npm and retry.',
  },
  NATIVE_ABI_MISMATCH: {
    message: 'A native addon targets a different Node ABI than the current WebTools Electron runtime.',
    suggestion: 'Rebuild the addon for the Node ABI in @webtools/plugin-sdk/runtime-target.json, then rerun build and pack.',
  },
  NATIVE_ARCH_MISMATCH: {
    message: 'A native binary targets a different Windows architecture than the current WebTools host.',
    suggestion: 'Install or rebuild the dependency for the current win32-x64 target before packing.',
  },
  CREATE_INVALID_INPUT: {
    message: 'The project name, plugin ID, template selection, or output path is invalid.',
    suggestion: 'Use a simple project folder and a lowercase reverse-DNS plugin ID, then choose Vanilla, Vue, React, or Svelte with Web or Node runtime.',
  },
  CREATE_OUTPUT_EXISTS: {
    message: 'The target directory already contains a project.',
    suggestion: 'Choose a new empty directory; existing files are not overwritten.',
  },
  BUILD_PROJECT_PATH: {
    message: 'The plugin project directory is missing or is not a regular directory.',
    suggestion: 'Run the command from the generated plugin project or pass its directory explicitly.',
  },
  BUILD_INPUT_MISSING: {
    message: 'A required project input file is missing.',
    suggestion: 'Restore the generated project file and rerun the command.',
  },
  BUILD_INPUT_INVALID: {
    message: 'A project JSON input could not be parsed.',
    suggestion: 'Fix the JSON syntax at the reported project-relative path.',
  },
  BUILD_SYMLINK: {
    message: 'A build input is a symbolic link and cannot be copied safely.',
    suggestion: 'Use regular files inside the plugin project and rerun build.',
  },
  BUILD_SPECIAL_FILE: {
    message: 'A build input is not a regular file or directory.',
    suggestion: 'Remove sockets, devices, or other special filesystem entries from the plugin project.',
  },
  BUILD_OUTPUT_PATH: {
    message: 'The build output path conflicts with a file or link, or escapes the plugin project.',
    suggestion: 'Remove the conflicting dist path and keep build output inside the plugin project.',
  },
  BUILD_VITE_MISSING: {
    message: 'Vite is not installed in this plugin project.',
    suggestion: 'Run pnpm install or npm install in the plugin project before dev or build.',
  },
  BUILD_TYPESCRIPT_MISSING: {
    message: 'TypeScript is not installed in this plugin project.',
    suggestion: 'Install the generated project dependencies, then run build again.',
  },
  BUILD_PRELOAD_CONFIG: {
    message: 'The Node preload TypeScript configuration is missing or invalid.',
    suggestion: 'Restore tsconfig.preload.json from the Node starter and rerun build.',
  },
  BUILD_PRELOAD_FAILED: {
    message: 'The Node preload could not be compiled.',
    suggestion: 'Fix the reported TypeScript error in preload/ and rebuild.',
  },
  BUILD_PRELOAD_MISSING: {
    message: 'The preload compiler did not emit the declared CommonJS output.',
    suggestion: 'Set the Node preload output to index.cjs in dist/preload and rebuild.',
  },
  BUILD_WEB_FAILED: {
    message: 'The Web frontend build failed.',
    suggestion: 'Fix the first Vite diagnostic in web/ and rerun webtools-plugin build.',
  },
  BUILD_MANIFEST_VERSION: {
    message: 'The build command accepts Manifest v3 Web and Node projects.',
    suggestion: 'Use the Manifest v3 template from create-webtools-plugin.',
  },
  BUILD_MANIFEST_INVALID: {
    message: 'The generated runtime inventory does not match the Manifest v3 contract.',
    suggestion: 'Check the Node preload path, Feature entry, and emitted file types; then rebuild.',
  },
  BUILD_MISSING_PRELOAD: {
    message: 'manifest.runtime.preload does not exist in the generated build output.',
    suggestion: 'Point runtime.preload at the emitted .cjs file under dist/ and rebuild.',
  },
  BUILD_MISSING_ENTRY: {
    message: 'A Feature entry does not exist in the generated build output.',
    suggestion: 'Point the Feature entry at an emitted web HTML file under dist/ and rebuild.',
  },
  BUILD_MEDIA_TYPE: {
    message: 'The build emitted a file type not supported by the Manifest v3 runtime inventory.',
    suggestion: 'Use supported Web asset formats or place opaque runtime data under assets/.',
  },
  BUILD_OUTPUT_UNEXPECTED: {
    message: 'The build output contains a file outside the supported runtime directories.',
    suggestion: 'Keep runtime files under web/, preload/, or assets/.',
  },
  MISSING_RUNTIME_ENTRY: {
    message: 'A Manifest entry points to a file that is not present in the build output.',
    likelyCause: 'The Manifest path may have been renamed or the build may have omitted the referenced file.',
    suggestion: 'Run build and update the entry path to the emitted file under dist/.',
  },
  MISSING_PRELOAD: {
    message: 'The Node preload path must identify a built .cjs file.',
    likelyCause: 'Node Plugin preloads must use the CommonJS format required by the Host bootstrap.',
    suggestion: 'Use runtime.preload with the CommonJS output emitted under dist/.',
  },
  DEV_SERVER_FAILED: {
    message: 'The loopback development server could not start.',
    suggestion: 'Check the generated Vite configuration, project dependencies, and whether the local port is available.',
  },
  DEV_JSON_UNSUPPORTED: {
    message: 'A long-running development server cannot use one-shot JSON output.',
    suggestion: 'Run webtools-plugin dev without --json.',
  },
  DEV_WATCH_UNAVAILABLE: {
    message: 'The project directory could not be watched for development changes.',
    suggestion: 'Use a local NTFS project directory and check its permissions; run build manually if the filesystem does not support recursive watching.',
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
  if (['BUILD_WEB_FAILED', 'BUILD_PRELOAD_FAILED'].includes(code) && typeof error?.message === 'string') {
    const detail = error.message.replace(/^[^:]+:\s*/u, '').replace(/[A-Za-z]:[\\/][^'"\r\n]*/gu, '<project path>')
    if (detail && detail.length <= 500) record.detail = detail
  }
  return record
}

export function printError(error) {
  const item = errorRecord(error)
  const field = item.field ? ` (${item.field})` : ''
  const cause = item.likelyCause ? ` Cause: ${item.likelyCause}` : ''
  const detail = item.detail ? ` Detail: ${item.detail}` : ''
  process.stderr.write(`[ERROR] ${item.code} ${item.path}${field}: ${item.message}${detail}${cause} Fix: ${item.suggestion}\n`)
}

export function printInfo(text) { process.stdout.write(`[INFO] ${text}\n`) }
export function printWarning(code, text) { process.stdout.write(`[WARNING] ${code}: ${text}\n`) }
export function printHelp(text) { process.stdout.write(`${text.trimEnd()}\n`) }
export function printJson(value) { process.stdout.write(`${JSON.stringify(value)}\n`) }
