import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createDefaultAppData, DEFAULT_SEARCH_ENGINES, type AppData, type Bookmark, type BookmarkFolder, type SearchProvider, type WebsiteEntry } from '../../src/shared/domain'

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
const isString = (value: unknown): value is string => typeof value === 'string'

function validV1(value: unknown): value is Record<string, any> {
  return isRecord(value) && value.version === 1 && Array.isArray(value.webEntries) && Array.isArray(value.tools)
    && Array.isArray(value.bookmarkFolders) && Array.isArray(value.bookmarks) && isRecord(value.settings)
    && (value.settings.defaultSearchProvider === undefined || ['google', 'baidu', 'bilibili'].includes(String(value.settings.defaultSearchProvider)))
    && (value.settings.aiBaseUrl === undefined || isString(value.settings.aiBaseUrl))
    && (value.settings.aiModel === undefined || isString(value.settings.aiModel))
    && value.webEntries.every((x: unknown) => isRecord(x) && isString(x.id) && isString(x.name) && isString(x.url))
    && value.bookmarkFolders.every((x: unknown) => isRecord(x) && isString(x.id) && isString(x.name) && typeof x.createdAt === 'number')
    && value.bookmarks.every((x: unknown) => isRecord(x) && isString(x.id) && isString(x.folderId) && isString(x.title) && isString(x.url) && typeof x.createdAt === 'number')
}

function validV2(value: unknown): value is AppData {
  if (!isRecord(value) || value.version !== 2 || !Array.isArray(value.webEntries) || !Array.isArray(value.bookmarkFolders) || !isRecord(value.settings)) return false
  const s = value.settings
  return Array.isArray(s.searchEngines) && s.searchEngines.every((x: unknown) => isRecord(x) && isString(x.id) && isString(x.name) && isString(x.template) && typeof x.enabled === 'boolean' && typeof x.builtIn === 'boolean' && typeof x.order === 'number')
    && isString(s.defaultSearchEngineId) && isString(s.quickSearchShortcut) && typeof s.launchOnStartup === 'boolean'
    && ['grid', 'list'].includes(String(s.websiteLayout)) && typeof s.everythingEnabled === 'boolean' && isString(s.everythingEsPath)
    && isString(s.aiBaseUrl) && isString(s.aiModel)
    && value.webEntries.every((x: unknown) => isRecord(x) && isString(x.id) && isString(x.name) && isString(x.url) && Array.isArray(x.folderIds) && x.folderIds.every(isString) && typeof x.createdAt === 'number')
    && value.bookmarkFolders.every((x: unknown) => isRecord(x) && isString(x.id) && isString(x.name) && typeof x.createdAt === 'number')
}

function canonicalUrl(raw: string): string {
  try { return new URL(raw).toString() } catch { return raw.trim() }
}

export function migrateV1ToV2(input: unknown): AppData {
  if (!validV1(input)) throw new Error('Invalid v1 local data format')
  const result = createDefaultAppData()
  const byUrl = new Map<string, WebsiteEntry>()
  const add = (url: string, incoming: Partial<WebsiteEntry>) => {
    const key = canonicalUrl(url)
    const current = byUrl.get(key)
    if (!current) {
      byUrl.set(key, { id: incoming.id ?? crypto.randomUUID(), name: incoming.name ?? key, url: key, description: incoming.description, favicon: incoming.favicon, folderIds: incoming.folderIds ?? [], createdAt: incoming.createdAt ?? Date.now() })
      return
    }
    byUrl.set(key, {
      ...current,
      name: incoming.name || current.name,
      description: incoming.description || current.description,
      favicon: current.favicon || incoming.favicon,
      folderIds: [...new Set([...current.folderIds, ...(incoming.folderIds ?? [])])],
      createdAt: Math.min(current.createdAt, incoming.createdAt ?? current.createdAt),
    })
  }

  for (const entry of input.webEntries) add(entry.url, { id: entry.id, name: entry.name, description: entry.description, folderIds: [], createdAt: entry.createdAt })
  for (const bookmark of input.bookmarks as Bookmark[]) add(bookmark.url, { id: bookmark.id, name: bookmark.title, favicon: bookmark.favicon, folderIds: [bookmark.folderId], createdAt: bookmark.createdAt })
  result.webEntries = [...byUrl.values()]
  result.bookmarkFolders = (input.bookmarkFolders as BookmarkFolder[]).map((f) => ({ ...f }))
  const provider = (input.settings.defaultSearchProvider ?? 'google') as SearchProvider
  result.settings = {
    ...result.settings,
    searchEngines: DEFAULT_SEARCH_ENGINES.map((engine) => ({ ...engine })),
    defaultSearchEngineId: provider,
    defaultSearchProvider: provider,
    aiBaseUrl: typeof input.settings.aiBaseUrl === 'string' ? input.settings.aiBaseUrl : '',
    aiModel: typeof input.settings.aiModel === 'string' ? input.settings.aiModel : '',
  }
  return result
}

export class DataStore {
  private data: AppData = createDefaultAppData()
  private pendingWrite: Promise<void> = Promise.resolve()
  private recoveryMessage: string | null = null
  constructor(private readonly filePath: string) {}

  async load(): Promise<AppData> {
    let bytes: Buffer
    try { bytes = await readFile(this.filePath) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.data = createDefaultAppData()
      await this.persist(this.data)
      return this.snapshot()
    }
    let parsed: unknown
    try { parsed = JSON.parse(bytes.toString('utf8')) } catch { return this.recoverCorrupt() }
    if (validV2(parsed)) { this.data = parsed; return this.snapshot() }
    if (validV1(parsed)) {
      const backupPath = `${this.filePath}.v1.bak`
      try {
        await mkdir(dirname(this.filePath), { recursive: true })
        try { await readFile(backupPath) } catch { await writeFile(backupPath, bytes) }
        this.data = migrateV1ToV2(parsed)
        await this.persist(this.data)
        this.recoveryMessage = `旧版数据已迁移；原始数据备份位于 ${backupPath}`
        return this.snapshot()
      } catch (error) {
        this.recoveryMessage = `数据迁移失败，原始文件已保留：${error instanceof Error ? error.message : '未知错误'}`
        throw new Error(this.recoveryMessage)
      }
    }
    return this.recoverCorrupt()
  }

  getRecoveryMessage(): string | null { return this.recoveryMessage }
  snapshot(): AppData { return structuredClone(this.data) }
  async update(mutator: (current: AppData) => AppData): Promise<AppData> {
    const operation = this.pendingWrite.then(async () => { const next = mutator(this.snapshot()); await this.persist(next); this.data = next; return structuredClone(next) })
    this.pendingWrite = operation.then(() => undefined, () => undefined)
    try { return await operation } catch { throw new Error('无法保存本机数据，请检查磁盘空间和文件权限。') }
  }
  private async recoverCorrupt(): Promise<AppData> {
    const backupPath = `${this.filePath}.corrupt-${Date.now()}`
    try { await copyFile(this.filePath, backupPath) } catch { /* preserve original when copying is unavailable */ }
    this.recoveryMessage = `本地数据格式损坏，已尝试保留原文件副本：${backupPath}`
    this.data = createDefaultAppData()
    // Do not overwrite the only recoverable source when a backup could not be made.
    try { await readFile(backupPath); await this.persist(this.data) } catch { throw new Error(this.recoveryMessage) }
    return this.snapshot()
  }
  private async persist(data: AppData): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp`
    await writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8')
    await rename(tempPath, this.filePath)
  }
}
