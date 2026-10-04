import { lstat, unlink } from 'node:fs/promises'

function sameFileIdentity(current, owned) {
  return current.isFile() && !current.isSymbolicLink()
    && Number.isFinite(current.ino) && current.ino !== 0
    && current.dev === owned.dev && current.ino === owned.ino
}

export async function cleanupOwnedTempFile(tempPath, ownedIdentity) {
  if (!ownedIdentity || !Number.isFinite(ownedIdentity.ino) || ownedIdentity.ino === 0) return false
  try {
    const current = await lstat(tempPath)
    if (!sameFileIdentity(current, ownedIdentity)) return false
    await unlink(tempPath)
    return true
  } catch {
    return false
  }
}
