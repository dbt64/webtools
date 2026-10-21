import { createHash, randomUUID } from 'node:crypto'
import { lstat, open, readdir, realpath, rename } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { RuntimeFileV3 } from '../../plugin-sdk/runtime-v3/manifest-v3.mjs'
import type { ValidatedRuntimeResourceV3 } from '../../plugin-sdk/runtime-v3/package-v3.mjs'
import { ManagedFs } from './managed-fs.ts'
import { fail } from './errors.ts'

function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }
function notFound(error: unknown): boolean { return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') }
function contained(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}
function samePath(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

export async function verifyMaterializedRuntimePackage(fs: ManagedFs, logicalRoot: string, inventory: readonly RuntimeFileV3[], resources: readonly ValidatedRuntimeResourceV3[]): Promise<void> {
  const expected = new Map(inventory.map(item => [item.path, item]))
  const bytesByPath = new Map(resources.map(resource => [resource.canonicalPath, resource.bytes]))
  if (expected.size !== inventory.length || bytesByPath.size !== resources.length || expected.size !== bytesByPath.size) fail('INTEGRITY_FAILED')
  const expectedDirectories = new Set<string>()
  for (const path of expected.keys()) {
    const parts = path.split('/')
    for (let index = 1; index < parts.length; index++) expectedDirectories.add(parts.slice(0, index).join('/'))
  }
  const seenFiles = new Set<string>()
  const seenDirectories = new Set<string>()
  const root = await fs.path(logicalRoot)
  const canonicalRoot = await realpath(root)
  const inspect = async (absolute: string): Promise<{ stat: Awaited<ReturnType<typeof lstat>>; canonical: string }> => {
    const stat = await lstat(absolute)
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) fail('UNSAFE_PATH')
    const canonical = await realpath(absolute)
    if (!contained(canonicalRoot, canonical)) fail('UNSAFE_PATH')
    return { stat, canonical }
  }
  const readVerifiedFile = async (absolute: string, expectedBytes: Buffer): Promise<Buffer> => {
    const file = await open(absolute, 'r')
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.size !== expectedBytes.length) fail('INTEGRITY_FAILED')
      const chunks: Buffer[] = []
      let total = 0
      for (;;) {
        const chunk = Buffer.alloc(Math.min(65_536, expectedBytes.length + 1 - total))
        const result = await file.read(chunk, 0, chunk.length, null)
        if (!result.bytesRead) break
        total += result.bytesRead
        if (total > expectedBytes.length) fail('INTEGRITY_FAILED')
        chunks.push(chunk.subarray(0, result.bytesRead))
      }
      return Buffer.concat(chunks, total)
    } finally { await file.close() }
  }
  const walk = async (absolute: string, logical: string, entry?: Awaited<ReturnType<typeof inspect>>): Promise<void> => {
    const current = entry ?? await inspect(absolute)
    if (!current.stat.isDirectory()) fail('UNSAFE_PATH')
    if (logical && !expectedDirectories.has(logical)) fail('INTEGRITY_FAILED')
    if (logical) seenDirectories.add(logical)
    for (const name of await readdir(absolute)) {
      const childLogical = logical ? `${logical}/${name}` : name
      const childAbsolute = join(absolute, name)
      const child = await inspect(childAbsolute)
      if (child.stat.isDirectory()) await walk(childAbsolute, childLogical, child)
      else {
        const item = expected.get(childLogical)
        const expectedBytes = bytesByPath.get(childLogical)
        if (!item || !expectedBytes || child.stat.size !== expectedBytes.length) fail('INTEGRITY_FAILED')
        const actual = await readVerifiedFile(childAbsolute, expectedBytes)
        const afterRead = await inspect(childAbsolute)
        if (!afterRead.stat.isFile() || !samePath(child.canonical, afterRead.canonical)
          || sha256(actual) !== sha256(expectedBytes)) fail('INTEGRITY_FAILED')
        seenFiles.add(childLogical)
      }
    }
  }
  await walk(root, '', await inspect(root))
  if (seenFiles.size !== expected.size || [...expected.keys()].some(path => !seenFiles.has(path))
    || seenDirectories.size !== expectedDirectories.size || [...expectedDirectories].some(path => !seenDirectories.has(path))) fail('INTEGRITY_FAILED')
}

export async function materializeRuntimePackage(fs: ManagedFs, logicalRoot: string, inventory: readonly RuntimeFileV3[], resources: readonly ValidatedRuntimeResourceV3[], mayCommit: () => boolean): Promise<{ created: boolean }> {
  const destination = await fs.path(logicalRoot)
  try {
    const stat = await lstat(destination)
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('UNSAFE_PATH')
    await verifyMaterializedRuntimePackage(fs, logicalRoot, inventory, resources)
    return { created: false }
  } catch (error) { if (!notFound(error)) throw error }

  const stageLogical = `staging/${randomUUID()}-runtime`
  const stage = await fs.path(stageLogical)
  let created = false
  try {
    await fs.mkdir(stageLogical)
    const resourcesByPath = new Map(resources.map(resource => [resource.canonicalPath, resource]))
    if (resourcesByPath.size !== inventory.length || inventory.some(item => !resourcesByPath.has(item.path))) fail('INVENTORY_MISMATCH')
    const directories = new Set<string>()
    for (const item of inventory) {
      const parts = item.path.split('/')
      for (let index = 1; index < parts.length; index++) directories.add(parts.slice(0, index).join('/'))
    }
    for (const directory of [...directories].sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right))) {
      await fs.mkdir(`${stageLogical}/${directory}`)
    }
    for (const item of inventory) {
      if (!mayCommit()) fail('INTENT_SUPERSEDED')
      const resource = resourcesByPath.get(item.path)!
      const targetLogical = `${stageLogical}/${item.path}`
      const target = await fs.path(targetLogical)
      const file = await open(target, 'wx')
      try { await file.writeFile(resource.bytes); await file.sync() } finally { await file.close() }
    }
    if (!mayCommit()) fail('INTENT_SUPERSEDED')
    const parent = logicalRoot.split('/').slice(0, -1).join('/')
    await fs.mkdir(parent)
    await fs.assertSafe(destination)
    try { await lstat(destination); fail('INTEGRITY_FAILED') }
    catch (error) { if (!notFound(error)) throw error }
    await rename(stage, destination)
    created = true
    await verifyMaterializedRuntimePackage(fs, logicalRoot, inventory, resources)
    return { created }
  } catch (error) {
    if (created) await fs.remove(destination)
    throw error
  } finally {
    await fs.remove(stage)
  }
}
