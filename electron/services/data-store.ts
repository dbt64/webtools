import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createDefaultAppData, type AppData } from '../../src/shared/domain'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isValidData(value: unknown): value is AppData {
  if (!isRecord(value) || value.version !== 1) return false
  if (!Array.isArray(value.webEntries) || !Array.isArray(value.tools)) return false
  if (!Array.isArray(value.bookmarkFolders) || !Array.isArray(value.bookmarks)) return false
  if (!isRecord(value.settings)) return false

  const settings = value.settings
  if (!['google', 'baidu', 'bilibili'].includes(String(settings.defaultSearchProvider))) return false
  if (!isString(settings.aiBaseUrl) || !isString(settings.aiModel)) return false

  return value.webEntries.every((entry) => isRecord(entry) && isString(entry.id) && isString(entry.name) && isString(entry.url))
    && value.tools.every((entry) => isRecord(entry) && isString(entry.id) && isString(entry.name) && isString(entry.command))
    && value.bookmarkFolders.every((folder) => isRecord(folder) && isString(folder.id) && isString(folder.name) && typeof folder.createdAt === 'number')
    && value.bookmarks.every((bookmark) => isRecord(bookmark) && isString(bookmark.id) && isString(bookmark.folderId) && isString(bookmark.title) && isString(bookmark.url) && typeof bookmark.createdAt === 'number')
}

export class DataStore {
  private data: AppData = createDefaultAppData()
  private pendingWrite: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async load(): Promise<AppData> {
    try {
      const contents: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))
      if (!isValidData(contents)) throw new Error('Invalid local data format')
      this.data = contents
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        const backupPath = `${this.filePath}.corrupt-${Date.now()}`
        try {
          await copyFile(this.filePath, backupPath)
        } catch {
          // A missing or unreadable source still recovers to defaults.
        }
      }
      this.data = createDefaultAppData()
      await this.persist(this.data)
    }
    return this.snapshot()
  }

  snapshot(): AppData {
    return structuredClone(this.data)
  }

  async update(mutator: (current: AppData) => AppData): Promise<AppData> {
    const next = mutator(this.snapshot())
    this.data = next
    this.pendingWrite = this.pendingWrite.then(() => this.persist(next))
    await this.pendingWrite
    return this.snapshot()
  }

  private async persist(data: AppData): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp`
    await writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8')
    await rename(tempPath, this.filePath)
  }
}
