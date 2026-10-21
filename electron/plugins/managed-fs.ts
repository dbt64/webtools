import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readdir, realpath, rename, rm, rmdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fail } from './errors.ts'
import { validateArchivePath } from './manifest.ts'

export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve()
  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation); this.tail = result.catch(() => undefined); return result
  }
}
function missing(error: unknown): boolean { return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') }
export function isMissing(error: unknown): boolean { return missing(error) }
function contained(root: string, target: string): boolean { const r = relative(root, target); return r === '' || (!isAbsolute(r) && r !== '..' && !r.startsWith(`..${sep}`)) }

const MAX_MANAGED_LOGICAL_PATH = 640
function validateManagedLogicalPath(value: string): void {
  if (value.length <= 240) { validateArchivePath(value); return }
  if (!value || value.length > MAX_MANAGED_LOGICAL_PATH || /[\\:\x00-\x1f\x7f<>"|?*]/.test(value) || value.startsWith('/')) fail('UNSAFE_PATH')
  const parts = value.replace(/\/$/, '').split('/')
  if (parts.some(part => !part || part.length > 240 || part === '.' || part === '..' || /[. ]$/.test(part)
    || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) fail('UNSAFE_PATH')
}

/** Only host-derived paths. Fail closed on any symlink/junction ancestor. */
export class ManagedFs {
  readonly root: string
  private canonicalRoot = ''
  constructor(root: string) { if (!isAbsolute(root)) fail('UNSAFE_PATH'); this.root = resolve(root) }
  async initialize(): Promise<void> {
    const volume = parse(this.root).root; let cursor = volume
    for (const part of this.root.slice(volume.length).split(sep).filter(Boolean)) {
      cursor = join(cursor, part)
      try { const stat = await lstat(cursor); if (stat.isSymbolicLink() || !stat.isDirectory()) fail('UNSAFE_PATH') }
      catch (error) { if (!missing(error)) throw error; await mkdir(cursor) }
    }
    this.canonicalRoot = await realpath(this.root)
    for (const dir of ['packages', 'runtime', 'local-data', 'config', 'data', 'cache', 'logs', 'staging']) await this.mkdir(dir)
  }
  async assertSafe(target: string): Promise<void> {
    const absolute = resolve(target); if (!this.canonicalRoot || !contained(this.root, absolute)) fail('UNSAFE_PATH')
    const rootStat = await lstat(this.root)
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || await realpath(this.root) !== this.canonicalRoot) fail('UNSAFE_PATH')
    let cursor = this.root
    for (const part of relative(this.root, absolute).split(sep).filter(Boolean)) {
      cursor = join(cursor, part)
      try {
        const stat = await lstat(cursor)
        if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || !contained(this.canonicalRoot, await realpath(cursor))) fail('UNSAFE_PATH')
        if (cursor !== absolute && !stat.isDirectory()) fail('UNSAFE_PATH')
      } catch (error) { if (!missing(error)) throw error; break }
    }
  }
  async path(...parts: string[]): Promise<string> {
    const logical = parts.join('/'); validateManagedLogicalPath(logical)
    const target = resolve(this.root, ...parts); await this.assertSafe(target); return target
  }
  async mkdir(logical: string): Promise<void> {
    validateManagedLogicalPath(logical); const parts = logical.split('/'); let cursor = this.root
    for (const part of parts) {
      cursor = join(cursor, part); await this.assertSafe(cursor)
      try { await mkdir(cursor) } catch (error) { if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') throw error }
      const stat = await lstat(cursor); if (!stat.isDirectory() || stat.isSymbolicLink()) fail('UNSAFE_PATH')
    }
  }
  async read(logical: string, limit: number): Promise<Buffer> {
    const path = await this.path(logical); const file = await open(path, 'r')
    try {
      const stat = await file.stat(); if (!stat.isFile() || stat.size > limit) fail('STORAGE_LIMIT')
      const chunks: Buffer[] = []; let total = 0
      for (;;) { const chunk = Buffer.alloc(Math.min(65536, limit + 1 - total)); const read = await file.read(chunk); if (!read.bytesRead) break; total += read.bytesRead; if (total > limit) fail('STORAGE_LIMIT'); chunks.push(chunk.subarray(0, read.bytesRead)) }
      await this.assertSafe(path); return Buffer.concat(chunks)
    } finally { await file.close() }
  }
  async atomicJson(logical: string, value: unknown, mayCommit: () => boolean = () => true): Promise<void> {
    const target = await this.path(logical); const temporary = join(dirname(target), `.write-${randomUUID()}.tmp`)
    await this.assertSafe(temporary)
    try {
      const file = await open(temporary, 'wx')
      try { await file.writeFile(JSON.stringify(value)); await file.sync() } finally { await file.close() }
      // Windows readers may briefly deny replacement. Keep the flushed file and
      // original target intact, and revalidate authority before every attempt.
      const retryDelays = [10, 20, 40, 80, 100]
      for (let attempt = 0; ; attempt++) {
        await this.assertSafe(temporary); await this.assertSafe(target)
        if (!mayCommit()) fail('SESSION_EXPIRED')
        try { await rename(temporary, target); break }
        catch (error) {
          const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
          if (process.platform !== 'win32' || (code !== 'EPERM' && code !== 'EBUSY') || attempt >= retryDelays.length) throw error
          await delay(retryDelays[attempt])
        }
      }
    }
    finally { await this.assertSafe(temporary); await rm(temporary, { force: true }) }
  }
  async remove(target: string): Promise<void> {
    const absolute = resolve(target)
    await this.assertSafe(absolute); if (absolute === this.root) fail('UNSAFE_PATH')
    try {
      const canonicalTarget = await realpath(absolute)
      if (!contained(this.canonicalRoot, canonicalTarget)) fail('UNSAFE_PATH')
      await this.removeEntry(absolute, canonicalTarget)
    } catch (error) { if (!missing(error)) throw error }
  }
  private async removeEntry(target: string, expectedCanonicalPath: string): Promise<void> {
    const stat = await lstat(target)
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) fail('UNSAFE_PATH')
    const canonicalPath = await realpath(target)
    if (canonicalPath !== expectedCanonicalPath || !contained(this.canonicalRoot, canonicalPath)) fail('UNSAFE_PATH')

    if (stat.isDirectory()) {
      for (const child of await readdir(target)) {
        await this.removeEntry(join(target, child), join(canonicalPath, child))
      }
      const current = await lstat(target)
      if (current.isSymbolicLink() || !current.isDirectory() || await realpath(target) !== expectedCanonicalPath) fail('UNSAFE_PATH')
      await rmdir(target)
      return
    }

    const current = await lstat(target)
    if (current.isSymbolicLink() || !current.isFile() || await realpath(target) !== expectedCanonicalPath) fail('UNSAFE_PATH')
    await rm(target, { force: true })
  }
}
