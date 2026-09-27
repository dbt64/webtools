import { dirname, isAbsolute, resolve } from 'node:path'

export interface ShortcutIconTarget {
  shortcutPath: string
  targetPath: string
  cwd: string
}

export async function resolveShortcutIcon(
  target: ShortcutIconTarget,
  declaredIcon: string | undefined,
  readIcon: (path: string) => Promise<string | null>,
): Promise<string | null> {
  const declared = declaredIcon?.trim()
  const declaredPath = declared
    ? isAbsolute(declared) ? declared : resolve(target.cwd || dirname(target.shortcutPath), declared)
    : undefined
  const candidates = [...new Set([declaredPath, target.targetPath, target.shortcutPath].filter((path): path is string => Boolean(path)))]

  for (const path of candidates) {
    try {
      const icon = await readIcon(path)
      if (icon) return icon
    } catch { /* Continue to the next icon source. */ }
  }
  return null
}
