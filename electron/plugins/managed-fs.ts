import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readdir, realpath, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
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
    for (const dir of ['packages', 'config', 'data', 'cache', 'logs', 'staging']) await this.mkdir(dir)
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
    const logical = parts.join('/'); validateArchivePath(logical)
    const target = resolve(this.root, ...parts); await this.assertSafe(target); return target
  }
  async mkdir(logical: string): Promise<void> {
    validateArchivePath(logical); const parts = logical.split('/'); let cursor = this.root
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
      await this.assertSafe(target); if (!mayCommit()) fail('SESSION_EXPIRED'); await rename(temporary, target)
    }
    finally { await this.assertSafe(temporary); await rm(temporary, { force: true }) }
  }
  async remove(target: string): Promise<void> {
    await this.assertSafe(target); if (resolve(target) === this.root) fail('UNSAFE_PATH')
    try {
      const stat = await lstat(target)
      if (stat.isDirectory()) for (const child of await readdir(target)) await this.remove(join(target, child))
      await this.assertSafe(target); await rm(target, { force: true, recursive: stat.isDirectory() })
    } catch (error) { if (!missing(error)) throw error }
  }
}
