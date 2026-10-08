import { lstatSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'

export interface WebRuntimeAcceptanceGuards { userProfilePath: string; installRoot?: string }
export interface WebRuntimeAcceptanceOptions { profilePath: string; packagePath: string }

function sameOrChild(root: string, candidate: string): boolean {
  const fromRoot = relative(resolve(root), resolve(candidate))
  return fromRoot === '' || (fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))
}
function overlaps(left: string, right: string): boolean { return sameOrChild(left, right) || sameOrChild(right, left) }
function realOrAbsolute(path: string): string { try { return realpathSync.native(path) } catch { return resolve(path) } }

function assertDirectoryWithoutReparsePoints(path: string): string {
  const resolved = resolve(path)
  const root = resolve(tmpdir())
  if (resolved === root || !sameOrChild(root, resolved)) throw new Error('Phase 6E-4B test profile must be a child of the system temporary directory.')
  const segments = relative(root, resolved).split(sep).filter(Boolean)
  let current = root
  for (const segment of segments) {
    current = join(current, segment)
    let stats
    try { stats = lstatSync(current) } catch { throw new Error('Phase 6E-4B test profile and every parent directory must already exist.') }
    if (stats.isSymbolicLink()) throw new Error('Phase 6E-4B test profile cannot contain a symbolic link or junction.')
    if (current !== resolved && !stats.isDirectory()) throw new Error('Phase 6E-4B test profile path contains a non-directory component.')
  }
  if (!lstatSync(resolved).isDirectory()) throw new Error('Phase 6E-4B test profile must be an existing directory.')
  return realpathSync.native(resolved)
}

export function resolveWebRuntimeAcceptanceOptions(argv: string[], env: NodeJS.ProcessEnv, guards: WebRuntimeAcceptanceGuards): WebRuntimeAcceptanceOptions | null {
  const enabled = argv.includes('--phase6e4b-web-runtime-acceptance') && env.WEBTOOLS_WEB_RUNTIME_ACCEPTANCE === '1'
  if (!enabled) return null
  const requestedProfile = env.WEBTOOLS_WEB_RUNTIME_TEST_PROFILE
  const requestedPackage = env.WEBTOOLS_WEB_RUNTIME_TEST_PACKAGE
  if (!requestedProfile || !isAbsolute(requestedProfile) || !requestedPackage || !isAbsolute(requestedPackage)) {
    throw new Error('Phase 6E-4B acceptance requires absolute disposable profile and fixture paths.')
  }
  if (basename(requestedPackage).toLowerCase() !== 'phase6e4b-runtime-fixture.wtplugin') {
    throw new Error('Phase 6E-4B acceptance only accepts the fixed runtime fixture filename.')
  }
  const profilePath = assertDirectoryWithoutReparsePoints(requestedProfile)
  const tempRoot = realOrAbsolute(tmpdir())
  const lexicalPackage = resolve(requestedPackage)
  if (!sameOrChild(tempRoot, lexicalPackage) || sameOrChild(profilePath, lexicalPackage)) {
    throw new Error('Phase 6E-4B runtime fixture must be outside the profile and inside the system temporary directory.')
  }
  const packageStats = lstatSync(lexicalPackage)
  if (!packageStats.isFile() || packageStats.isSymbolicLink()) throw new Error('Phase 6E-4B fixture must be a regular, non-linked file.')
  if (packageStats.size < 1 || packageStats.size > 20 * 1024 * 1024) throw new Error('Phase 6E-4B fixture exceeds the Host package validation size limit.')
  const packagePath = realpathSync.native(lexicalPackage)
  if (!sameOrChild(tempRoot, packagePath) || overlaps(profilePath, packagePath)) throw new Error('Phase 6E-4B fixture resolves outside the isolated temporary test root.')
  const protectedRoots = [guards.userProfilePath, guards.installRoot].filter((value): value is string => Boolean(value))
  for (const root of protectedRoots) {
    if (!isAbsolute(root) || overlaps(realOrAbsolute(resolve(root)), profilePath) || overlaps(resolve(root), resolve(requestedProfile))
      || overlaps(realOrAbsolute(resolve(root)), packagePath)) {
      throw new Error('Phase 6E-4B test paths must not overlap the real user profile or application install directory.')
    }
  }
  return Object.freeze({ profilePath, packagePath })
}
