import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, open, realpath, unlink } from 'node:fs/promises'
import path from 'node:path'
import { validatePackageV1 } from '../runtime/package-v1.mjs'
import { failValidation } from '../runtime/manifest-v1.mjs'
import { readPluginSource } from './source.mjs'
import { createDeterministicZip } from './zip-writer.mjs'
import { cleanupOwnedTempFile } from './owned-temp.mjs'
import { rejectCredentialLike } from './sensitive-content.mjs'

function sameIdentity(a, b) { return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs }

export async function packPlugin(sourceDirectory, outputFile, hostVersion) {
  const source = await readPluginSource(sourceDirectory, hostVersion)
  rejectCredentialLike(source.manifestBytes, 'manifest.json')
  for (const [relative, bytes] of source.assets) rejectCredentialLike(bytes, relative)
  const entries = [{ name: 'manifest.json', data: source.manifestBytes }, ...[...source.assets].map(([name, data]) => ({ name, data }))]
  const archive = createDeterministicZip(entries)
  const validated = await validatePackageV1(archive, hostVersion)
  const output = path.resolve(outputFile)
  if (!/\.wtplugin$/i.test(output)) failValidation('OUTPUT_IO', 'package.wtplugin')
  const parent = path.dirname(output)
  let parentStat
  try { parentStat = await lstat(parent) } catch { failValidation('OUTPUT_IO', 'package.wtplugin') }
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) failValidation('OUTPUT_IO', 'package.wtplugin')
  const parentReal = await realpath(parent).catch(() => failValidation('OUTPUT_IO', 'package.wtplugin'))
  const finalPath = path.join(parentReal, path.basename(output))
  try { await lstat(finalPath); failValidation('OUTPUT_EXISTS', 'package.wtplugin') }
  catch (error) { if (error?.code !== 'ENOENT') throw error }
  const tempPath = path.join(parentReal, `.webtools-plugin-${process.pid}-${randomUUID()}.tmp`)
  let ownTempIdentity
  let linkedFinal = false
  try {
    const handle = await open(tempPath, 'wx', 0o600).catch(() => failValidation('OUTPUT_IO', 'package.wtplugin'))
    try {
      ownTempIdentity = await handle.stat()
      await handle.writeFile(archive)
      await handle.sync()
      ownTempIdentity = await handle.stat()
    }
    finally { await handle.close() }
    try { await link(tempPath, finalPath); linkedFinal = true }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') failValidation('OUTPUT_EXISTS', 'package.wtplugin')
      failValidation('OUTPUT_IO', 'package.wtplugin')
    }
    const resultHandle = await open(finalPath, 'r').catch(() => failValidation('OUTPUT_IO', 'package.wtplugin'))
    let written
    try {
      const currentStat = await resultHandle.stat()
      if (!currentStat.isFile() || !sameIdentity(ownTempIdentity, currentStat)) failValidation('OUTPUT_IO', 'package.wtplugin')
      written = await resultHandle.readFile()
    } finally { await resultHandle.close() }
    if (!written.equals(archive)) failValidation('OUTPUT_IO', 'package.wtplugin')
    const checked = await validatePackageV1(written, hostVersion)
    if (checked.hash !== validated.hash) failValidation('INVALID_PACKAGE', 'package.wtplugin')
    return { id: checked.manifest.id, version: checked.manifest.version, apiMajor: checked.manifest.api.apiMajor, output: finalPath, size: written.length, sha256: createHash('sha256').update(written).digest('hex') }
  } catch (error) {
    if (linkedFinal && ownTempIdentity) {
      try { const finalStat = await lstat(finalPath); if (sameIdentity(ownTempIdentity, finalStat)) await unlink(finalPath) } catch { /* only the tool-owned result can be removed */ }
    }
    if (error?.code === 'OUTPUT_EXISTS' || error?.code === 'SENSITIVE_CONTENT' || error?.code === 'INVALID_PACKAGE' || error?.code === 'INVALID_MANIFEST' || error?.code === 'INCOMPATIBLE_PLUGIN' || error?.code === 'SOURCE_IO' || error?.code === 'INVALID_INPUT') throw error
    failValidation('OUTPUT_IO', 'package.wtplugin')
  } finally {
    await cleanupOwnedTempFile(tempPath, ownTempIdentity)
  }
}
