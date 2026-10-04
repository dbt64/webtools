import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises'
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { SerialQueue } from './managed-fs.ts'

export const BUILTIN_TRANSLATION_ID = 'webtools.translation' as const
export const BUILTIN_PLUGIN_STATE_VERSION = 1 as const
const STATE_FILE = 'state.json'
const MAX_STATE_BYTES = 16 * 1024
const MAX_BACKUP_BYTES = 1024 * 1024
const MAX_PLUGIN_RECORDS = 32
const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/

export type BuiltinPluginStateErrorCode =
  | 'STATE_INVALID'
  | 'STATE_UNSUPPORTED'
  | 'STATE_UNAVAILABLE'
  | 'STATE_WRITE_FAILED'
  | 'STATE_RECOVERY_FAILED'
  | 'UNSAFE_PATH'
  | 'SESSION_EXPIRED'

export class BuiltinPluginStateError extends Error {
  readonly code: BuiltinPluginStateErrorCode
  constructor(code: BuiltinPluginStateErrorCode) {
    super(code)
    this.code = code
  }
}

export type BuiltinPluginStateLoad =
  | { status: 'ready'; enabled: boolean; source: 'default' | 'stored' }
  | { status: 'unavailable'; errorCode: Extract<BuiltinPluginStateErrorCode, 'STATE_INVALID' | 'STATE_UNSUPPORTED' | 'STATE_UNAVAILABLE' | 'UNSAFE_PATH'> }

interface StateDocument {
  stateVersion: 1
  plugins: Record<string, { enabled: boolean }>
}

interface BuiltinPluginStateOptions {
  /** Narrow I/O seam used to prove that a failed atomic commit preserves the old state. */
  renameFile?: (source: string, target: string) => Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === expected.length && expected.every(key => Object.hasOwn(value, key))
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function contained(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}

function parseState(buffer: Buffer): StateDocument {
  if (buffer.byteLength > MAX_STATE_BYTES) throw new BuiltinPluginStateError('STATE_INVALID')
  let value: unknown
  try { value = JSON.parse(buffer.toString('utf8')) } catch { throw new BuiltinPluginStateError('STATE_INVALID') }
  if (!isRecord(value) || !hasExactKeys(value, ['stateVersion', 'plugins']) || !isRecord(value.plugins)) {
    throw new BuiltinPluginStateError('STATE_INVALID')
  }
  if (value.stateVersion !== BUILTIN_PLUGIN_STATE_VERSION) throw new BuiltinPluginStateError('STATE_UNSUPPORTED')
  const rows = Object.entries(value.plugins)
  if (rows.length > MAX_PLUGIN_RECORDS) throw new BuiltinPluginStateError('STATE_INVALID')
  const plugins: StateDocument['plugins'] = {}
  for (const [id, row] of rows) {
    if (id.length > 128 || !ID_PATTERN.test(id) || !isRecord(row) || !hasExactKeys(row, ['enabled']) || typeof row.enabled !== 'boolean') {
      throw new BuiltinPluginStateError('STATE_INVALID')
    }
    plugins[id] = { enabled: row.enabled }
  }
  return { stateVersion: BUILTIN_PLUGIN_STATE_VERSION, plugins }
}

/** Main-only, fixed-ID persistence for host-owned built-in plugin enabled state. */
export class BuiltinPluginStateStore {
  private readonly root: string
  private readonly directory: string
  private readonly statePath: string
  private readonly queue = new SerialQueue()
  private readonly renameFile: (source: string, target: string) => Promise<void>
  private loaded = false
  private document: StateDocument | null = null
  private current: BuiltinPluginStateLoad | null = null

  constructor(userDataPath: string, options: BuiltinPluginStateOptions = {}) {
    if (!isAbsolute(userDataPath)) throw new BuiltinPluginStateError('UNSAFE_PATH')
    this.root = resolve(userDataPath)
    this.directory = join(this.root, 'builtin-plugins')
    this.statePath = join(this.directory, STATE_FILE)
    this.renameFile = options.renameFile ?? rename
  }

  async load(): Promise<BuiltinPluginStateLoad> {
    if (this.current) return structuredClone(this.current)
    try {
      await this.assertSafeRoot()
      const directoryExists = await this.assertSafeDirectory(false)
      if (!directoryExists) return this.setLoaded({ stateVersion: 1, plugins: {} }, { status: 'ready', enabled: true, source: 'default' })
      const bytes = await this.readStateBytes()
      if (bytes === null) return this.setLoaded({ stateVersion: 1, plugins: {} }, { status: 'ready', enabled: true, source: 'default' })
      const parsed = parseState(bytes)
      return this.setLoaded(parsed, { status: 'ready', enabled: parsed.plugins[BUILTIN_TRANSLATION_ID]?.enabled ?? true, source: 'stored' })
    } catch (error) {
      const code = this.safeLoadCode(error)
      this.loaded = true
      this.document = null
      this.current = { status: 'unavailable', errorCode: code }
      return structuredClone(this.current)
    }
  }

  async setEnabled(id: typeof BUILTIN_TRANSLATION_ID, enabled: boolean, mayCommit: () => boolean = () => true): Promise<BuiltinPluginStateLoad> {
    if (id !== BUILTIN_TRANSLATION_ID || typeof enabled !== 'boolean') throw new BuiltinPluginStateError('STATE_INVALID')
    return this.queue.run(async () => {
      if (!this.loaded || !this.current || this.current.status !== 'ready' || !this.document) throw new BuiltinPluginStateError('STATE_UNAVAILABLE')
      if (!mayCommit()) throw new BuiltinPluginStateError('SESSION_EXPIRED')
      const next: StateDocument = structuredClone(this.document)
      next.plugins[id] = { enabled }
      try {
        await this.writeAtomically(next, mayCommit)
      } catch (error) {
        if (error instanceof BuiltinPluginStateError) throw error
        throw new BuiltinPluginStateError('STATE_WRITE_FAILED')
      }
      this.document = next
      this.current = { status: 'ready', enabled, source: 'stored' }
      return structuredClone(this.current)
    })
  }

  async recoverToDefault(mayCommit: () => boolean = () => true): Promise<BuiltinPluginStateLoad> {
    return this.queue.run(async () => {
      if (!this.loaded || !this.current || this.current.status !== 'unavailable') throw new BuiltinPluginStateError('STATE_UNAVAILABLE')
      if (!mayCommit()) throw new BuiltinPluginStateError('SESSION_EXPIRED')
      try {
        await this.assertSafeRoot()
        const directoryExists = await this.assertSafeDirectory(false)
        if (!directoryExists) throw new BuiltinPluginStateError('STATE_RECOVERY_FAILED')
        const bytes = await this.readStateBytes()
        if (bytes === null || bytes.byteLength > MAX_BACKUP_BYTES) throw new BuiltinPluginStateError('STATE_RECOVERY_FAILED')
        await this.writeBackup(bytes)
        const next: StateDocument = { stateVersion: 1, plugins: { [BUILTIN_TRANSLATION_ID]: { enabled: true } } }
        await this.writeAtomically(next, mayCommit)
        return this.setLoaded(next, { status: 'ready', enabled: true, source: 'stored' })
      } catch (error) {
        if (error instanceof BuiltinPluginStateError) throw error
        throw new BuiltinPluginStateError('STATE_RECOVERY_FAILED')
      }
    })
  }

  private setLoaded(document: StateDocument, value: BuiltinPluginStateLoad): BuiltinPluginStateLoad {
    this.loaded = true
    this.document = document
    this.current = value
    return structuredClone(value)
  }

  private safeLoadCode(error: unknown): Extract<BuiltinPluginStateErrorCode, 'STATE_INVALID' | 'STATE_UNSUPPORTED' | 'STATE_UNAVAILABLE' | 'UNSAFE_PATH'> {
    if (error instanceof BuiltinPluginStateError && ['STATE_INVALID', 'STATE_UNSUPPORTED', 'STATE_UNAVAILABLE', 'UNSAFE_PATH'].includes(error.code)) {
      return error.code as Extract<BuiltinPluginStateErrorCode, 'STATE_INVALID' | 'STATE_UNSUPPORTED' | 'STATE_UNAVAILABLE' | 'UNSAFE_PATH'>
    }
    return 'STATE_UNAVAILABLE'
  }

  private async assertSafeRoot(): Promise<void> {
    const volume = parse(this.root).root
    let cursor = volume
    for (const part of this.root.slice(volume.length).split(sep).filter(Boolean)) {
      cursor = join(cursor, part)
      let stat
      try { stat = await lstat(cursor) } catch { throw new BuiltinPluginStateError('STATE_UNAVAILABLE') }
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new BuiltinPluginStateError('UNSAFE_PATH')
      if (await realpath(cursor) !== cursor) throw new BuiltinPluginStateError('UNSAFE_PATH')
    }
  }

  private async assertSafeDirectory(create: boolean): Promise<boolean> {
    await this.assertSafeRoot()
    let stat
    try { stat = await lstat(this.directory) } catch (error) {
      if (!isMissing(error)) throw new BuiltinPluginStateError('STATE_UNAVAILABLE')
      if (!create) return false
      try { await mkdir(this.directory) } catch (mkdirError) {
        if (!mkdirError || typeof mkdirError !== 'object' || !('code' in mkdirError) || mkdirError.code !== 'EEXIST') throw new BuiltinPluginStateError('STATE_WRITE_FAILED')
      }
      try { stat = await lstat(this.directory) } catch { throw new BuiltinPluginStateError('STATE_WRITE_FAILED') }
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new BuiltinPluginStateError('UNSAFE_PATH')
    const canonicalRoot = await realpath(this.root)
    const canonicalDirectory = await realpath(this.directory)
    if (!contained(canonicalRoot, canonicalDirectory)) throw new BuiltinPluginStateError('UNSAFE_PATH')
    return true
  }

  private async assertSafeStateFile(allowMissing: boolean): Promise<boolean> {
    await this.assertSafeDirectory(false)
    try {
      const stat = await lstat(this.statePath)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new BuiltinPluginStateError('UNSAFE_PATH')
      const canonicalRoot = await realpath(this.root)
      if (!contained(canonicalRoot, await realpath(this.statePath))) throw new BuiltinPluginStateError('UNSAFE_PATH')
      return true
    } catch (error) {
      if (isMissing(error) && allowMissing) return false
      if (error instanceof BuiltinPluginStateError) throw error
      throw new BuiltinPluginStateError('STATE_UNAVAILABLE')
    }
  }

  private async readStateBytes(): Promise<Buffer | null> {
    if (!await this.assertSafeStateFile(true)) return null
    let file
    try { file = await open(this.statePath, 'r') } catch { throw new BuiltinPluginStateError('STATE_UNAVAILABLE') }
    try {
      const stat = await file.stat()
      if (!stat.isFile()) throw new BuiltinPluginStateError('UNSAFE_PATH')
      const limit = Math.min(MAX_BACKUP_BYTES, MAX_STATE_BYTES)
      if (stat.size > MAX_BACKUP_BYTES) {
        // Keep oversized corrupt bytes recoverable without allocating them into memory.
        return await this.readOversizedFileForBackup(file, stat.size)
      }
      const bytes = await file.readFile()
      await this.assertSafeStateFile(false)
      if (bytes.byteLength > limit && bytes.byteLength <= MAX_BACKUP_BYTES) return bytes
      return bytes
    } catch (error) {
      if (error instanceof BuiltinPluginStateError) throw error
      throw new BuiltinPluginStateError('STATE_UNAVAILABLE')
    } finally { await file.close() }
  }

  private async readOversizedFileForBackup(file: Awaited<ReturnType<typeof open>>, size: number): Promise<Buffer> {
    if (size > MAX_BACKUP_BYTES) throw new BuiltinPluginStateError('STATE_INVALID')
    const buffer = Buffer.alloc(size)
    let offset = 0
    while (offset < size) {
      const { bytesRead } = await file.read(buffer, offset, Math.min(64 * 1024, size - offset), offset)
      if (bytesRead === 0) throw new BuiltinPluginStateError('STATE_UNAVAILABLE')
      offset += bytesRead
    }
    return buffer
  }

  private async writeAtomically(document: StateDocument, mayCommit: () => boolean): Promise<void> {
    await this.assertSafeDirectory(true)
    const temporary = join(this.directory, `.builtin-state-${randomUUID()}.tmp`)
    if (await this.assertSafeStateFile(true)) await this.assertSafeStateFile(false)
    let handle
    try {
      handle = await open(temporary, 'wx')
      await handle.writeFile(JSON.stringify(document))
      await handle.sync()
      await handle.close(); handle = undefined
      await this.assertSafeDirectory(false)
      if (await this.assertSafeStateFile(true)) await this.assertSafeStateFile(false)
      if (!mayCommit()) throw new BuiltinPluginStateError('SESSION_EXPIRED')
      await this.renameFile(temporary, this.statePath)
      await this.assertSafeStateFile(false)
    } catch (error) {
      if (error instanceof BuiltinPluginStateError) throw error
      throw error
    } finally {
      if (handle) await handle.close().catch(() => undefined)
      try { await rm(temporary, { force: true }) } catch { /* Remove only this operation's unique temporary file. */ }
    }
  }

  private async writeBackup(bytes: Buffer): Promise<void> {
    const backup = join(this.directory, `.state-invalid-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.bak`)
    let handle
    try {
      handle = await open(backup, 'wx')
      await handle.writeFile(bytes)
      await handle.sync()
      await handle.close()
      handle = undefined
      const stat = await lstat(backup)
      if (!stat.isFile() || stat.isSymbolicLink() || !contained(await realpath(this.root), await realpath(backup))) throw new BuiltinPluginStateError('UNSAFE_PATH')
    } catch (error) {
      if (error instanceof BuiltinPluginStateError) throw error
      throw new BuiltinPluginStateError('STATE_RECOVERY_FAILED')
    } finally { if (handle) await handle.close().catch(() => undefined) }
  }
}
