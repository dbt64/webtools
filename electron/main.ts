import { app, BrowserWindow, ipcMain } from 'electron'
import { isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DataStore } from './services/data-store'
import { SecretStore } from './services/secret-store'
import { AppCatalogService } from './services/app-catalog'
import { AppLauncher } from './services/app-launcher'
import type { IpcResult } from '../src/shared/ipc'
import type { AppSettings, ToolEntry, WebEntry } from '../src/shared/domain'
import { buildSearchUrl } from '../src/shared/search-providers'
import { openExternalUrl, validateExternalUrl } from './services/external-opener'

const isDevelopment = !app.isPackaged
let dataStore: DataStore

function fail<T>(code: string, message: string): IpcResult<T> {
  return { ok: false, error: { code, message } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  return name.length > 0 && name.length <= 120 ? name : null
}

function normalizeDescription(value: unknown): string | undefined | null {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string' || value.length > 1000) return null
  return value.trim() || undefined
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 840,
    minHeight: 600,
    backgroundColor: '#10151c',
    title: 'Nook',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.once('ready-to-show', () => window.show())

  if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('app:get-version', () => app.getVersion())

app.whenReady().then(async () => {
  dataStore = new DataStore(join(app.getPath('userData'), 'nook-data.json'))
  const secretStore = new SecretStore(join(app.getPath('userData'), 'secrets.json'))
  await dataStore.load()
  void secretStore
  const appCatalog = new AppCatalogService()
  const appLauncher = new AppLauncher(appCatalog)
  await appCatalog.refresh()
  ipcMain.handle('apps:list', () => appCatalog.list())
  ipcMain.handle('apps:refresh', () => appCatalog.refresh())
  ipcMain.handle('apps:launch', async (_event, id: unknown): Promise<IpcResult<void>> => {
    if (typeof id !== 'string' || !/^[a-f0-9]{16}$/.test(id)) {
      return { ok: false, error: { code: 'INVALID_APP_ID', message: '应用信息无效，请刷新后重试。' } }
    }
    try {
      await appLauncher.launchApp(id)
      return { ok: true, data: undefined }
    } catch (error) {
      return { ok: false, error: { code: 'APP_LAUNCH_FAILED', message: error instanceof Error ? error.message : '应用启动失败。' } }
    }
  })
  ipcMain.handle('entries:list', () => {
    const data = dataStore.snapshot()
    return { webEntries: data.webEntries, tools: data.tools }
  })
  ipcMain.handle('entries:save-website', async (_event, input: unknown): Promise<IpcResult<WebEntry>> => {
    if (!isRecord(input)) return fail('INVALID_ENTRY', '网址信息无效。')
    const name = normalizeName(input.name)
    const description = normalizeDescription(input.description)
    if (!name || description === null || typeof input.url !== 'string') return fail('INVALID_ENTRY', '请填写有效的网址名称和网址。')
    let url: string
    try { url = validateExternalUrl(input.url.trim()).toString() } catch (error) {
      return fail('INVALID_URL', error instanceof Error ? error.message : '网址格式不正确。')
    }
    if (input.id !== undefined && (typeof input.id !== 'string' || !/^[\da-f-]{36}$/i.test(input.id))) return fail('INVALID_ID', '网址编号无效。')
    const next: WebEntry = { id: input.id as string | undefined ?? randomUUID(), name, url, description }
    const existing = dataStore.snapshot().webEntries.some((entry) => entry.id === next.id)
    if (input.id && !existing) return fail('NOT_FOUND', '找不到要编辑的网址。')
    await dataStore.update((data) => ({ ...data, webEntries: existing ? data.webEntries.map((entry) => entry.id === next.id ? next : entry) : [...data.webEntries, next] }))
    return { ok: true, data: next }
  })
  ipcMain.handle('entries:delete-website', async (_event, id: unknown): Promise<IpcResult<void>> => {
    if (typeof id !== 'string') return fail('INVALID_ID', '网址编号无效。')
    const current = dataStore.snapshot()
    if (!current.webEntries.some((entry) => entry.id === id)) return fail('NOT_FOUND', '找不到要删除的网址。')
    await dataStore.update((data) => ({ ...data, webEntries: data.webEntries.filter((entry) => entry.id !== id) }))
    return { ok: true, data: undefined }
  })
  ipcMain.handle('entries:save-tool', async (_event, input: unknown): Promise<IpcResult<ToolEntry>> => {
    if (!isRecord(input)) return fail('INVALID_ENTRY', '工具信息无效。')
    const name = normalizeName(input.name)
    const description = normalizeDescription(input.description)
    if (!name || description === null || typeof input.command !== 'string' || !isAbsolute(input.command.trim())) return fail('INVALID_TOOL_PATH', '请填写名称和有效的程序绝对路径。')
    if (input.id !== undefined && (typeof input.id !== 'string' || !/^[\da-f-]{36}$/i.test(input.id))) return fail('INVALID_ID', '工具编号无效。')
    const next: ToolEntry = { id: input.id as string | undefined ?? randomUUID(), name, command: input.command.trim(), description }
    const existing = dataStore.snapshot().tools.some((entry) => entry.id === next.id)
    if (input.id && !existing) return fail('NOT_FOUND', '找不到要编辑的工具。')
    await dataStore.update((data) => ({ ...data, tools: existing ? data.tools.map((entry) => entry.id === next.id ? next : entry) : [...data.tools, next] }))
    return { ok: true, data: next }
  })
  ipcMain.handle('entries:delete-tool', async (_event, id: unknown): Promise<IpcResult<void>> => {
    if (typeof id !== 'string') return fail('INVALID_ID', '工具编号无效。')
    const current = dataStore.snapshot()
    if (!current.tools.some((entry) => entry.id === id)) return fail('NOT_FOUND', '找不到要删除的工具。')
    await dataStore.update((data) => ({ ...data, tools: data.tools.filter((entry) => entry.id !== id) }))
    return { ok: true, data: undefined }
  })
  ipcMain.handle('entries:open-website', async (_event, id: unknown): Promise<IpcResult<void>> => {
    if (typeof id !== 'string') return fail('INVALID_ID', '网址编号无效。')
    const entry = dataStore.snapshot().webEntries.find((item) => item.id === id)
    if (!entry) return fail('NOT_FOUND', '找不到这个网址。')
    try { await openExternalUrl(entry.url); return { ok: true, data: undefined } } catch (error) {
      return fail('OPEN_URL_FAILED', error instanceof Error ? error.message : '无法打开这个网址。')
    }
  })
  ipcMain.handle('entries:open-tool', async (_event, id: unknown): Promise<IpcResult<void>> => {
    if (typeof id !== 'string') return fail('INVALID_ID', '工具编号无效。')
    const entry = dataStore.snapshot().tools.find((item) => item.id === id)
    if (!entry) return fail('NOT_FOUND', '找不到这个工具。')
    const error = await import('electron').then(({ shell }) => shell.openPath(entry.command))
    return error ? fail('OPEN_TOOL_FAILED', error) : { ok: true, data: undefined }
  })
  ipcMain.handle('settings:get', () => dataStore.snapshot().settings)
  ipcMain.handle('settings:update', async (_event, settings: unknown): Promise<IpcResult<AppSettings>> => {
    if (!isRecord(settings)) return fail('INVALID_SETTINGS', '设置内容无效。')
    if (settings.defaultSearchProvider !== undefined && !['google', 'baidu', 'bilibili'].includes(String(settings.defaultSearchProvider))) return fail('INVALID_PROVIDER', '不支持的搜索平台。')
    if (settings.aiBaseUrl !== undefined && (typeof settings.aiBaseUrl !== 'string' || settings.aiBaseUrl.length > 500)) return fail('INVALID_SETTINGS', 'AI 服务地址无效。')
    if (settings.aiModel !== undefined && (typeof settings.aiModel !== 'string' || settings.aiModel.length > 120)) return fail('INVALID_SETTINGS', 'AI 模型名称无效。')
    const next = await dataStore.update((data) => ({
      ...data,
      settings: {
        defaultSearchProvider: typeof settings.defaultSearchProvider === 'string' ? settings.defaultSearchProvider as AppSettings['defaultSearchProvider'] : data.settings.defaultSearchProvider,
        aiBaseUrl: typeof settings.aiBaseUrl === 'string' ? settings.aiBaseUrl : data.settings.aiBaseUrl,
        aiModel: typeof settings.aiModel === 'string' ? settings.aiModel : data.settings.aiModel,
      },
    }))
    return { ok: true, data: next.settings }
  })
  ipcMain.handle('search:open-web', async (_event, query: unknown): Promise<IpcResult<void>> => {
    if (typeof query !== 'string' || !query.trim()) return fail('EMPTY_QUERY', '请输入要搜索的内容。')
    try {
      const url = buildSearchUrl(dataStore.snapshot().settings.defaultSearchProvider, query)
      await openExternalUrl(url)
      return { ok: true, data: undefined }
    } catch (error) {
      return fail('WEB_SEARCH_FAILED', error instanceof Error ? error.message : '无法打开搜索页面。')
    }
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
