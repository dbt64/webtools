import { lstatSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

export interface ManagerTestProfileGuards {
  userProfilePath: string
  installRoot?: string
}

function isSameOrChild(root: string, candidate: string): boolean {
  const pathFromRoot = relative(resolve(root), resolve(candidate))
  return pathFromRoot === ''
    || (pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot))
}

function overlaps(left: string, right: string): boolean {
  return isSameOrChild(left, right) || isSameOrChild(right, left)
}

function resolveForGuard(path: string): string {
  const absolutePath = resolve(path)
  try {
    return realpathSync.native(absolutePath)
  } catch {
    // Protected roots can legitimately be absent on a fresh install. The
    // absolute lexical path still prevents opting into that reserved location.
    return absolutePath
  }
}

function assertNoReparsePoints(tempRoot: string, profilePath: string): void {
  const pathFromTemp = relative(tempRoot, profilePath)
  let current = tempRoot
  for (const part of pathFromTemp.split(sep).filter(Boolean)) {
    current = join(current, part)
    const stats = lstatSync(current)
    if (stats.isSymbolicLink()) {
      throw new Error('Manager acceptance profile cannot contain a symbolic link, junction, or reparse point.')
    }
    if (current !== profilePath && !stats.isDirectory()) {
      throw new Error('Manager acceptance profile path contains a non-directory component.')
    }
  }
}

/** Explicit, fail-closed isolation for the real packaged Manager acceptance driver. */
export function resolveManagerTestProfile(
  argv: string[],
  env: NodeJS.ProcessEnv,
  guards?: ManagerTestProfileGuards,
): string | undefined {
  if (!argv.includes('--phase4g-manager-test')) return undefined

  const profile = env.WEBTOOLS_MANAGER_TEST_PROFILE
  const pipe = env.WEBTOOLS_NATIVE_PIPE ?? ''
  if ((!argv.includes('--manager-only') && env.WEBTOOLS_MANAGER_ONLY !== '1')
    || !profile || !isAbsolute(profile) || !guards?.userProfilePath || !isAbsolute(guards.userProfilePath)) {
    throw new Error('Manager acceptance requires Manager-only mode, an absolute disposable profile, and the real user-profile guard.')
  }
  if (!/^WebTools\.NativeHost\.Manager\.v1\.Phase4E\.[A-Za-z0-9_-]{8,80}$/.test(pipe)) {
    throw new Error('Manager acceptance requires a valid isolated Native pipe.')
  }
  if (guards.installRoot && !isAbsolute(guards.installRoot)) {
    throw new Error('Manager acceptance requires an absolute install-directory guard.')
  }

  const requestedPath = resolve(profile)
  const protectedRoots = [guards.userProfilePath, guards.installRoot].filter((path): path is string => Boolean(path))
  for (const protectedRoot of protectedRoots) {
    if (overlaps(resolveForGuard(protectedRoot), requestedPath) || overlaps(resolve(protectedRoot), requestedPath)) {
      throw new Error('Manager acceptance profile overlaps the real user profile or application install directory.')
    }
  }

  const temporaryRoots = [...new Set([resolve(tmpdir()), resolveForGuard(tmpdir())])]
  const containingTempRoot = temporaryRoots.find(root => isSameOrChild(root, requestedPath) && resolve(root) !== requestedPath)
  if (!containingTempRoot) {
    throw new Error('Manager acceptance profile must be a descendant of the current user temporary directory.')
  }

  let resolvedProfile: string
  try {
    const stats = lstatSync(requestedPath)
    if (!stats.isDirectory()) throw new Error('not a directory')
    assertNoReparsePoints(containingTempRoot, requestedPath)
    resolvedProfile = realpathSync.native(requestedPath)
  } catch (error) {
    throw new Error(`Manager acceptance profile must be an existing, resolvable directory without reparse points: ${String(error)}`)
  }

  const resolvedTemp = resolveForGuard(tmpdir())
  if (!isSameOrChild(resolvedTemp, resolvedProfile) || resolvedTemp === resolvedProfile) {
    throw new Error('Manager acceptance profile resolves outside the current user temporary directory.')
  }

  for (const protectedRoot of protectedRoots) {
    if (overlaps(resolveForGuard(protectedRoot), resolvedProfile) || overlaps(resolve(protectedRoot), requestedPath)) {
      throw new Error('Manager acceptance profile overlaps the real user profile or application install directory.')
    }
  }

  return resolvedProfile
}
