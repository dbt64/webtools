import { lstatSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'

const ARGUMENT = '--plugin-runtime-acceptance'
const MAX_PACKAGE_BYTES = 512 * 1024 * 1024
const validatedOptions = new WeakSet<object>()

export interface PluginRuntimeAcceptanceGuards {
  packaged: boolean
  executable: string
  userProfilePath: string
  installRoot?: string
  userDataPath?: string
}

export interface PluginRuntimeAcceptanceOptions {
  rootPath: string
  profilePath: string
  fixturePath: string
  updatePath: string
  isolationPath: string
  debugPort: number
}

export function isPluginRuntimeAcceptanceOptions(value: unknown): value is PluginRuntimeAcceptanceOptions {
  return value !== null && typeof value === 'object' && validatedOptions.has(value)
}

function sameOrChild(parent: string, child: string): boolean {
  const fromParent = relative(resolve(parent), resolve(child))
  return fromParent === '' || (fromParent !== '..' && !fromParent.startsWith(`..${sep}`) && !isAbsolute(fromParent))
}

function overlaps(left: string, right: string): boolean { return sameOrChild(left, right) || sameOrChild(right, left) }
function realOrAbsolute(value: string): string { try { return realpathSync.native(value) } catch { return resolve(value) } }

function assertStrictTempDirectory(value: string, label: string): string {
  if (!isAbsolute(value)) throw new Error(`Plugin Runtime ${label} must be absolute.`)
  const temp = realOrAbsolute(tmpdir())
  const lexical = resolve(value)
  if (lexical === resolve(tmpdir()) || !sameOrChild(temp, lexical)) throw new Error(`Plugin Runtime ${label} must be a strict TEMP descendant.`)
  let current = resolve(tmpdir())
  const parts = relative(current, lexical).split(sep).filter(Boolean)
  for (const part of parts) {
    current = join(current, part)
    const stat = lstatSync(current)
    if (stat.isSymbolicLink()) throw new Error(`Plugin Runtime ${label} cannot contain a link or reparse point.`)
    if (current !== lexical && !stat.isDirectory()) throw new Error(`Plugin Runtime ${label} contains a non-directory component.`)
  }
  if (!lstatSync(lexical).isDirectory()) throw new Error(`Plugin Runtime ${label} must be an existing directory.`)
  const canonical = realpathSync.native(lexical)
  if (!sameOrChild(temp, canonical) || canonical === temp) throw new Error(`Plugin Runtime ${label} resolves outside TEMP.`)
  return canonical
}

function assertRegularTempFile(value: string, expectedName: string, rootPath: string, profilePath: string): string {
  if (!isAbsolute(value) || basename(value).toLowerCase() !== expectedName) throw new Error(`Plugin Runtime fixture must use the fixed ${expectedName} name.`)
  const lexical = resolve(value)
  const expected = resolve(rootPath, 'fixtures', expectedName)
  if (lexical.toLowerCase() !== expected.toLowerCase() || !sameOrChild(rootPath, lexical) || overlaps(profilePath, lexical)) {
    throw new Error('Plugin Runtime fixture must be in the fixed isolated fixture directory outside the profile.')
  }
  const stat = lstatSync(lexical)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > MAX_PACKAGE_BYTES) {
    throw new Error('Plugin Runtime fixture must be a bounded regular file, not a link.')
  }
  const canonical = realpathSync.native(lexical)
  if (canonical.toLowerCase() !== lexical.toLowerCase() || !sameOrChild(rootPath, canonical) || overlaps(profilePath, canonical)) {
    throw new Error('Plugin Runtime fixture resolves outside the isolated test root.')
  }
  return canonical
}

/** Only enables the real packaged Runtime 2.0 acceptance seam under a disposable TEMP installation/profile. */
export function resolvePluginRuntimeAcceptanceOptions(argv: readonly string[], env: NodeJS.ProcessEnv,
  guards: PluginRuntimeAcceptanceGuards): PluginRuntimeAcceptanceOptions | null {
  const hasArg = argv.includes(ARGUMENT)
  const hasEnv = env.WEBTOOLS_PLUGIN_RUNTIME_ACCEPTANCE === '1'
  if (!hasArg) return null
  if (!hasEnv) throw new Error('Plugin Runtime packaged acceptance requires both explicit opt-ins.')
  if (!guards.packaged || !isAbsolute(guards.executable) || !isAbsolute(guards.userProfilePath)
    || (guards.userDataPath && !isAbsolute(guards.userDataPath)) || (guards.installRoot && !isAbsolute(guards.installRoot))) {
    throw new Error('Plugin Runtime acceptance requires a packaged Manager and absolute isolation guards.')
  }
  const rootPath = assertStrictTempDirectory(env.WEBTOOLS_PLUGIN_RUNTIME_TEST_ROOT ?? '', 'test root')
  const profilePath = assertStrictTempDirectory(env.WEBTOOLS_PLUGIN_RUNTIME_TEST_PROFILE ?? '', 'test profile')
  if (!sameOrChild(rootPath, profilePath) || rootPath === profilePath) throw new Error('Plugin Runtime profile must be inside its isolated TEMP test root.')
  const executable = resolve(guards.executable)
  const tempRoot = realOrAbsolute(tmpdir())
  if (!sameOrChild(tempRoot, executable) || executable === tempRoot) throw new Error('Plugin Runtime packaged executable must be under TEMP.')
  let current = resolve(tmpdir())
  for (const part of relative(current, executable).split(sep).filter(Boolean)) {
    current = join(current, part)
    if (lstatSync(current).isSymbolicLink()) throw new Error('Plugin Runtime executable path cannot contain links.')
  }
  if (!lstatSync(executable).isFile() || realpathSync.native(executable).toLowerCase() !== executable.toLowerCase()) {
    throw new Error('Plugin Runtime packaged executable must be a canonical regular file.')
  }
  if (guards.userDataPath) {
    const userDataPath = realpathSync.native(resolve(guards.userDataPath))
    if (userDataPath.toLowerCase() !== profilePath.toLowerCase()) throw new Error('Plugin Runtime profile does not match the active Electron userData path.')
  }

  const protectedRoots = [guards.userProfilePath, guards.installRoot].filter((value): value is string => Boolean(value))
  for (const protectedRoot of protectedRoots) {
    const canonical = realOrAbsolute(resolve(protectedRoot))
    if (overlaps(canonical, profilePath)) throw new Error('Plugin Runtime test profile overlaps a protected user profile or install.')
  }

  const fixturePath = assertRegularTempFile(join(rootPath, 'fixtures', 'plugin-runtime-fixture.wtplugin'),
    'plugin-runtime-fixture.wtplugin', rootPath, profilePath)
  const updatePath = assertRegularTempFile(join(rootPath, 'fixtures', 'plugin-runtime-update.wtplugin'),
    'plugin-runtime-update.wtplugin', rootPath, profilePath)
  const isolationPath = assertRegularTempFile(join(rootPath, 'fixtures', 'plugin-runtime-isolation.wtplugin'),
    'plugin-runtime-isolation.wtplugin', rootPath, profilePath)
  const debugPort = Number(env.WEBTOOLS_PLUGIN_RUNTIME_TEST_DEBUG_PORT)
  if (!Number.isInteger(debugPort) || debugPort < 1024 || debugPort > 65535) throw new Error('Plugin Runtime remote-debugging port is invalid.')
  const options = Object.freeze({ rootPath, profilePath, fixturePath, updatePath, isolationPath, debugPort })
  validatedOptions.add(options)
  return options
}
