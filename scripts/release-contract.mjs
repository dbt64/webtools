import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const RELEASE_CHANNELS = new Set(['stable', 'beta'])
const SEMVER_CORE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/

export class ReleaseContractError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ReleaseContractError'
    this.code = code
  }
}

function fail(code, message) {
  throw new ReleaseContractError(code, message)
}

function validateIdentifiers(value, { prerelease }) {
  if (!value) return
  for (const identifier of value.split('.')) {
    if (!/^[0-9A-Za-z-]+$/.test(identifier)) fail('INVALID_PRODUCT_VERSION', 'Product version contains an invalid SemVer identifier.')
    if (prerelease && /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith('0')) {
      fail('INVALID_PRODUCT_VERSION', 'Numeric prerelease identifiers cannot contain leading zeroes.')
    }
  }
}

export function parseProductVersion(value) {
  if (typeof value !== 'string') fail('INVALID_PRODUCT_VERSION', 'Product version must be a string.')
  const match = SEMVER_CORE.exec(value)
  if (!match) fail('INVALID_PRODUCT_VERSION', 'Product version must follow SemVer 2.0.0.')
  validateIdentifiers(match[4], { prerelease: true })
  validateIdentifiers(match[5], { prerelease: false })
  const [major, minor, patch] = match.slice(1, 4).map(Number)
  if (![major, minor, patch].every(Number.isSafeInteger)) fail('INVALID_PRODUCT_VERSION', 'Product version core is outside the supported numeric range.')
  if ([major, minor, patch].some(part => part > 65535)) fail('WINDOWS_VERSION_RANGE', 'Windows file version components must be between 0 and 65535.')
  return {
    version: value,
    major,
    minor,
    patch,
    prerelease: match[4] ?? '',
    build: match[5] ?? '',
    windowsFileVersion: `${major}.${minor}.${patch}.0`,
  }
}

export function validateReleaseChannel(channel) {
  if (typeof channel !== 'string' || !RELEASE_CHANNELS.has(channel)) {
    fail('INVALID_RELEASE_CHANNEL', 'Release channel must be exactly stable or beta.')
  }
  return channel
}

export function assertSourceStateAllowed({ sourceDirty, allowDirty, channel }) {
  validateReleaseChannel(channel)
  if (typeof sourceDirty !== 'boolean' || typeof allowDirty !== 'boolean') fail('INVALID_SOURCE_STATE', 'Source and dirty-build states must be explicit.')
  if (sourceDirty && !allowDirty) fail('DIRTY_SOURCE', 'Release builds require a clean source tree; use explicit beta development mode for dirty-source smoke builds.')
  if (sourceDirty && channel !== 'beta') fail('DIRTY_STABLE_BUILD', 'Dirty development builds are only allowed on the beta channel.')
  return true
}

export function assertVersionContract({
  productVersion,
  managerVersion,
  nativeHostVersion,
  updateHelperVersion,
  installerVersion,
  pluginApiMajor,
  manifestVersion,
  pluginSdkVersion,
}) {
  parseProductVersion(productVersion)
  for (const [name, version] of Object.entries({ managerVersion, nativeHostVersion, updateHelperVersion, installerVersion })) {
    parseProductVersion(version)
    if (version !== productVersion) fail('VERSION_DRIFT', `${name} (${version}) does not match product version ${productVersion}.`)
  }
  if (!Number.isSafeInteger(pluginApiMajor) || pluginApiMajor < 1) fail('INVALID_PLUGIN_API_MAJOR', 'Plugin API major must be a positive integer independent of the product version.')
  if (!Number.isSafeInteger(manifestVersion) || manifestVersion < 1) fail('INVALID_MANIFEST_VERSION', 'Plugin manifest version must be a positive integer independent of the product version.')
  parseProductVersion(pluginSdkVersion)
  return Object.freeze({ productVersion, pluginApiMajor, manifestVersion, pluginSdkVersion })
}

function validateBuildTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    fail('INVALID_BUILD_TIMESTAMP', 'Build timestamp must be a valid UTC ISO-8601 timestamp.')
  }
  return new Date(value).toISOString()
}

function validateCommit(commit) {
  if (typeof commit !== 'string' || !/^[a-f0-9]{40}$/i.test(commit)) fail('INVALID_GIT_COMMIT', 'Git commit must be a full 40-character SHA-1.')
  return commit.toLowerCase()
}

export function createBuildInfo({
  productVersion,
  gitCommit,
  sourceDirty,
  buildTimestampUtc,
  channel,
  platform,
  arch,
  pluginApiMajor,
  manifestVersion,
  pluginSdkVersion,
}) {
  parseProductVersion(productVersion)
  validateReleaseChannel(channel)
  if (typeof sourceDirty !== 'boolean') fail('INVALID_SOURCE_STATE', 'Source dirty state must be explicit.')
  if (platform !== 'win32' || arch !== 'x64') fail('UNSUPPORTED_BUILD_TARGET', 'Release artifacts must target win32 x64.')
  if (!Number.isSafeInteger(pluginApiMajor) || pluginApiMajor < 1) fail('INVALID_PLUGIN_API_MAJOR', 'Plugin API major must be a positive integer.')
  if (!Number.isSafeInteger(manifestVersion) || manifestVersion < 1) fail('INVALID_MANIFEST_VERSION', 'Manifest version must be a positive integer.')
  parseProductVersion(pluginSdkVersion)
  return {
    schemaVersion: 1,
    productVersion,
    gitCommit: validateCommit(gitCommit),
    sourceDirty,
    buildTimestampUtc: validateBuildTimestamp(buildTimestampUtc),
    channel,
    platform,
    arch,
    pluginApiMajor,
    manifestVersion,
    pluginSdkVersion,
    releaseCandidateEligible: !sourceDirty,
    signing: { status: 'unsigned' },
  }
}

export function verifyBuildInfo(info) {
  const keys = [
    'schemaVersion', 'productVersion', 'gitCommit', 'sourceDirty', 'buildTimestampUtc',
    'channel', 'platform', 'arch', 'pluginApiMajor', 'manifestVersion', 'pluginSdkVersion',
    'releaseCandidateEligible', 'signing',
  ]
  if (!info || typeof info !== 'object' || Array.isArray(info)
      || Object.keys(info).sort().join('\0') !== [...keys].sort().join('\0')
      || info.schemaVersion !== 1) {
    fail('INVALID_BUILD_METADATA', 'Build metadata schema is invalid or contains unsupported fields.')
  }
  parseProductVersion(info.productVersion)
  validateCommit(info.gitCommit)
  validateBuildTimestamp(info.buildTimestampUtc)
  validateReleaseChannel(info.channel)
  if (typeof info.sourceDirty !== 'boolean'
      || info.releaseCandidateEligible !== !info.sourceDirty
      || info.platform !== 'win32' || info.arch !== 'x64'
      || !Number.isSafeInteger(info.pluginApiMajor) || info.pluginApiMajor < 1
      || !Number.isSafeInteger(info.manifestVersion) || info.manifestVersion < 1
      || typeof info.signing !== 'object' || Array.isArray(info.signing)
      || Object.keys(info.signing).join('\0') !== 'status'
      || info.signing.status !== 'unsigned') {
    fail('INVALID_BUILD_METADATA', 'Build metadata identity or signing status is inconsistent.')
  }
  parseProductVersion(info.pluginSdkVersion)
  return true
}

export function createReleaseDirectoryName({ productVersion, channel, gitCommit, sourceDirty, buildTimestampUtc }) {
  parseProductVersion(productVersion)
  validateReleaseChannel(channel)
  const commit = validateCommit(gitCommit)
  if (typeof sourceDirty !== 'boolean') fail('INVALID_SOURCE_STATE', 'Source dirty state must be explicit.')
  let suffix = ''
  if (sourceDirty) {
    const stamp = validateBuildTimestamp(buildTimestampUtc).replace(/[-:.]/g, '')
    suffix = `-dirty-${stamp}`
  }
  return `WebTools-${productVersion}-${channel}-${commit.slice(0, 12)}${suffix}`
}

export function resolveReleaseArtifactDirectory(repositoryRoot, buildInfo) {
  const releaseRoot = path.resolve(repositoryRoot, 'release')
  const output = path.resolve(releaseRoot, createReleaseDirectoryName(buildInfo))
  const relative = path.relative(releaseRoot, output)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail('UNSAFE_RELEASE_OUTPUT', 'Release output must remain below the repository release directory.')
  }
  return output
}

function assertVersionLiteral(source, expression, expected, description) {
  const match = expression.exec(source)
  if (!match || Number(match[1]) !== expected) fail('PLUGIN_VERSION_DRIFT', `${description} does not match the published SDK contract.`)
}

export async function readVersionContract(repositoryRoot) {
  const root = path.resolve(repositoryRoot)
  let appPackage
  let sdkPackage
  let schema
  try {
    [appPackage, sdkPackage, schema] = await Promise.all([
      readFile(path.join(root, 'package.json'), 'utf8').then(JSON.parse),
      readFile(path.join(root, 'plugin-sdk/declarative-v1/package.json'), 'utf8').then(JSON.parse),
      readFile(path.join(root, 'plugin-sdk/declarative-v1/manifest.schema.json'), 'utf8').then(JSON.parse),
    ])
  } catch (error) {
    fail('VERSION_CONTRACT_UNAVAILABLE', `Could not read the repository version contract: ${error.message}`)
  }
  const productVersion = parseProductVersion(appPackage.version).version
  const pluginSdkVersion = parseProductVersion(sdkPackage.version).version
  const sdkUrl = pathToFileURL(path.join(root, 'plugin-sdk/declarative-v1/index.mjs')).href
  const runtimeUrl = pathToFileURL(path.join(root, 'plugin-sdk/declarative-v1/runtime/manifest-v1.mjs')).href
  let sdk
  let runtime
  try { [sdk, runtime] = await Promise.all([import(sdkUrl), import(runtimeUrl)]) }
  catch (error) { fail('VERSION_CONTRACT_UNAVAILABLE', `Could not load published plugin version constants: ${error.message}`) }
  const pluginApiMajor = sdk.API_MAJOR_V1
  const manifestVersion = sdk.MANIFEST_VERSION_V1
  if (!Number.isSafeInteger(pluginApiMajor) || !Number.isSafeInteger(manifestVersion)) fail('PLUGIN_VERSION_DRIFT', 'Published SDK plugin versions must be integer constants.')
  if (runtime.API_MAJOR_V1 !== pluginApiMajor || runtime.MANIFEST_VERSION_V1 !== manifestVersion) {
    fail('PLUGIN_VERSION_DRIFT', 'The host runtime plugin versions do not match the published SDK.')
  }
  if (schema.properties?.api?.properties?.apiMajor?.const !== pluginApiMajor
      || schema.properties?.manifestVersion?.const !== manifestVersion) {
    fail('PLUGIN_VERSION_DRIFT', 'The JSON Schema plugin versions do not match the published SDK.')
  }
  const [sdkTypes, sharedTypes, registry] = await Promise.all([
    readFile(path.join(root, 'plugin-sdk/declarative-v1/types.d.ts'), 'utf8'),
    readFile(path.join(root, 'src/shared/plugin-contracts.ts'), 'utf8'),
    readFile(path.join(root, 'electron/plugins/plugin-registry.ts'), 'utf8'),
  ])
  assertVersionLiteral(sdkTypes, /manifestVersion\s*:\s*(\d+)/, manifestVersion, 'SDK Manifest version type')
  assertVersionLiteral(sdkTypes, /api\s*:\s*\{\s*apiMajor\s*:\s*(\d+)/, pluginApiMajor, 'SDK API major type')
  assertVersionLiteral(sharedTypes, /manifestVersion\s*:\s*(\d+)/, manifestVersion, 'host Manifest version type')
  assertVersionLiteral(sharedTypes, /api\s*:\s*\{\s*apiMajor\s*:\s*(\d+)/, pluginApiMajor, 'host API major type')
  assertVersionLiteral(registry, /api\.apiMajor\s*!==\s*(\d+)/, pluginApiMajor, 'plugin registry API major guard')
  return Object.freeze({ productVersion, pluginApiMajor, manifestVersion, pluginSdkVersion })
}

function safeRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\\') || relativePath.includes(':') || relativePath.startsWith('/')) {
    fail('UNSAFE_ARTIFACT_PATH', 'Artifact paths must be non-empty, relative, slash-separated paths.')
  }
  const parts = relativePath.split('/')
  if (parts.some(part => !part || part === '.' || part === '..'
      || /[\u0000-\u001f<>"|?*]/.test(part)
      || /[ .]$/.test(part)
      || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(part))) {
    fail('UNSAFE_ARTIFACT_PATH', 'Artifact paths cannot contain empty, dot, parent, or control-character segments.')
  }
  return parts
}

function safeBuildId(buildId) {
  if (typeof buildId !== 'string' || !/^[A-Za-z0-9.+-]{1,180}$/.test(buildId)) fail('INVALID_BUILD_ID', 'Build ID contains unsupported characters.')
  return buildId
}

async function resolveRegularArtifact(root, relativePath) {
  const parts = safeRelativePath(relativePath)
  const absolute = path.resolve(root, ...parts)
  const relative = path.relative(root, absolute)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail('UNSAFE_ARTIFACT_PATH', 'Artifact path resolved outside the release root.')
  }
  let current = root
  let fileDetails
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index])
    let details
    try { details = await lstat(current) }
    catch (error) {
      if (error?.code === 'ENOENT') fail('ARTIFACT_MISSING', `Artifact does not exist: ${relativePath}`)
      throw error
    }
    const last = index === parts.length - 1
    if (details.isSymbolicLink() || (last ? !details.isFile() : !details.isDirectory())) {
      fail('UNSAFE_ARTIFACT_PATH', `Artifact path traverses a link or non-regular entry: ${relativePath}`)
    }
    if (last) fileDetails = details
  }
  const actualPath = await realpath(absolute)
  const canonicalRoot = await resolveArtifactRoot(root)
  const canonicalRelative = path.relative(canonicalRoot, actualPath)
  if (!canonicalRelative || canonicalRelative === '..' || canonicalRelative.startsWith(`..${path.sep}`) || path.isAbsolute(canonicalRelative)) {
    fail('UNSAFE_ARTIFACT_PATH', 'Artifact resolves outside the release root.')
  }
  return { absolute: actualPath, size: fileDetails.size }
}

async function resolveArtifactRoot(root) {
  let details
  try { details = await lstat(root) }
  catch (error) {
    if (error?.code === 'ENOENT') fail('ARTIFACT_ROOT_MISSING', 'Artifact directory does not exist.')
    throw error
  }
  if (!details.isDirectory() || details.isSymbolicLink()) fail('UNSAFE_ARTIFACT_PATH', 'Artifact root must be a real directory.')
  return realpath(root)
}

function assertUniquePaths(paths) {
  const seen = new Set()
  for (const relativePath of paths) {
    safeRelativePath(relativePath)
    const key = relativePath.toLocaleLowerCase('en-US')
    if (seen.has(key)) fail('DUPLICATE_ARTIFACT_PATH', `Duplicate artifact path: ${relativePath}`)
    seen.add(key)
  }
}

export async function createArtifactManifest(root, relativePaths, { productVersion, buildId }) {
  parseProductVersion(productVersion)
  safeBuildId(buildId)
  if (!Array.isArray(relativePaths) || relativePaths.length === 0) fail('INVALID_ARTIFACT_LIST', 'At least one artifact is required.')
  assertUniquePaths(relativePaths)
  const canonicalRoot = await resolveArtifactRoot(root)
  const artifacts = []
  for (const relativePath of [...relativePaths].sort((a, b) => a.localeCompare(b, 'en-US'))) {
    const file = await resolveRegularArtifact(canonicalRoot, relativePath)
    const bytes = await readFile(file.absolute)
    artifacts.push({
      relativePath,
      size: file.size,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
  }
  return { schemaVersion: 1, productVersion, buildId, artifacts }
}

export async function verifyArtifactManifest(root, manifest) {
  const expectedManifestKeys = ['schemaVersion', 'productVersion', 'buildId', 'artifacts']
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
      || Object.keys(manifest).sort().join('\0') !== expectedManifestKeys.sort().join('\0')
      || manifest.schemaVersion !== 1 || !Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    fail('INVALID_ARTIFACT_MANIFEST', 'Artifact manifest schema is invalid.')
  }
  parseProductVersion(manifest.productVersion)
  safeBuildId(manifest.buildId)
  const paths = manifest.artifacts.map(artifact => artifact?.relativePath)
  assertUniquePaths(paths)
  const canonicalRoot = await resolveArtifactRoot(root)
  for (const artifact of manifest.artifacts) {
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)
        || Object.keys(artifact).sort().join('\0') !== ['relativePath', 'size', 'sha256'].sort().join('\0')) {
      fail('INVALID_ARTIFACT_MANIFEST', 'Artifact entry contains unsupported fields.')
    }
    if (!Number.isSafeInteger(artifact.size) || artifact.size < 0 || typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(artifact.sha256)) {
      fail('INVALID_ARTIFACT_MANIFEST', `Artifact entry is invalid: ${artifact.relativePath}`)
    }
    const file = await resolveRegularArtifact(canonicalRoot, artifact.relativePath)
    if (file.size !== artifact.size) fail('ARTIFACT_SIZE_MISMATCH', `Artifact size differs: ${artifact.relativePath}`)
    const bytes = await readFile(file.absolute)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (sha256 !== artifact.sha256) fail('ARTIFACT_HASH_MISMATCH', `Artifact SHA-256 differs: ${artifact.relativePath}`)
  }
  return true
}
