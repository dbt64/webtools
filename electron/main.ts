import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray, screen, dialog, type OpenDialogOptions } from 'electron'
import { basename, isAbsolute, join } from 'node:path'
import { DataStore } from './services/data-store'
import { SecretStore } from './services/secret-store'
import { AppCatalogService } from './services/app-catalog'
import { AppLauncher } from './services/app-launcher'
import type { IpcResult } from '../src/shared/ipc'
import type { AppSettings } from '../src/shared/domain'
import { buildSearchUrl, normalizeSearchEngines } from '../src/shared/search-providers'
import { openExternalUrl } from './services/external-opener'
import { BookmarkService } from './services/bookmark-service'
import { AiTranslationService } from './services/ai-translation'
import { buildGoogleTranslateUrl } from './services/google-translate'
import { GlobalHotkeyService } from './services/global-hotkey'
import { WebsiteService } from './services/website-service'
import { WebsiteMetadataService } from './services/website-metadata'
import { EverythingClient } from './services/everything-client'

const isDevelopment = !app.isPackaged
let dataStore: DataStore
let secretStore: SecretStore
let managerWindow: BrowserWindow | null = null
let launcherWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let hotkeyService: GlobalHotkeyService | null = null

function fail<T>(code: string, message: string): IpcResult<T> {
  return { ok: false, error: { code, message } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function createWindow(): void {
  if (managerWindow && !managerWindow.isDestroyed()) { managerWindow.show(); managerWindow.focus(); return }
  const window = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 840,
    minHeight: 600,
    backgroundColor: '#10151c',
    title: 'WebTools',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  managerWindow = window
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:') && !url.startsWith('http://localhost:')) event.preventDefault()
  })
  window.on('closed', () => { if (managerWindow === window) managerWindow = null })
  window.on('close', (event) => {
    if (!quitting) { event.preventDefault(); window.hide() }
  })

  window.once('ready-to-show', () => window.show())

  if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showManager(): void {
  if (!managerWindow || managerWindow.isDestroyed()) createWindow()
  else { managerWindow.show(); managerWindow.focus() }
}

function createLauncherWindow(): BrowserWindow {
  if (launcherWindow && !launcherWindow.isDestroyed()) return launcherWindow
  const window = new BrowserWindow({
    width: 850,
    height: 88,
    frame: false,
    resizable: false,
    show: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    title: 'WebTools 快速搜索',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  launcherWindow = window
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('file:') && !url.startsWith('http://localhost:')) event.preventDefault() })
  window.on('closed', () => { if (launcherWindow === window) launcherWindow = null })
  if (isDevelopment && process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/launcher.html`)
  else void window.loadFile(join(__dirname, '../renderer/launcher.html'))
  return window
}

function showLauncher(): void {
  const window = createLauncherWindow()
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const bounds = display.workArea
  window.setBounds({ x: Math.round(bounds.x + (bounds.width - 850) / 2), y: Math.round(bounds.y + bounds.height * 0.22), width: 850, height: 88 })
  window.show()
  window.focus()
  if (window.webContents.isLoading()) window.webContents.once('did-finish-load', () => void window.webContents.executeJavaScript("window.dispatchEvent(new Event('webtools-launcher-show'))"))
  else void window.webContents.executeJavaScript("window.dispatchEvent(new Event('webtools-launcher-show'))")
}

function resizeLauncher(expanded: boolean): void {
  if (!launcherWindow || launcherWindow.isDestroyed()) return
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const bounds = display.workArea
  const height = expanded ? 440 : 88
  launcherWindow.setBounds({ x: Math.round(bounds.x + (bounds.width - 850) / 2), y: Math.round(bounds.y + bounds.height * 0.22), width: 850, height })
}

function createTray(): void {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect x="1" y="1" width="30" height="30" rx="8" fill="#9fdfc3"/><path d="M11 10h10M11 16h10M11 22h10" stroke="#15261f" stroke-width="2" stroke-linecap="round"/></svg>'
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
  tray = new Tray(image)
  tray.setToolTip('WebTools')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 WebTools', click: showManager },
    { label: '退出', click: () => { quitting = true; hotkeyService?.dispose(); app.quit() } },
  ]))
  tray.on('double-click', showManager)
}

ipcMain.handle('app:get-version', () => app.getVersion())

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()
else app.on('second-instance', () => showManager())

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  app.setAppUserModelId('dev.nook.launcher')
  dataStore = new DataStore(join(app.getPath('userData'), 'nook-data.json'))
  secretStore = new SecretStore(join(app.getPath('userData'), 'secrets.json'))
  await dataStore.load()
  const aiTranslationService = new AiTranslationService(dataStore, secretStore)
  const appCatalog = new AppCatalogService()
  const appLauncher = new AppLauncher(appCatalog)
  const bookmarkService = new BookmarkService(dataStore)
  const websiteService = new WebsiteService(dataStore)
  const websiteMetadata = new WebsiteMetadataService()
  const everything = new EverythingClient(() => dataStore.snapshot().settings.everythingEsPath)
  await appCatalog.refresh()
  hotkeyService = new GlobalHotkeyService()
  const shortcutResult = hotkeyService.register(dataStore.snapshot().settings.quickSearchShortcut, showLauncher)
  if (!shortcutResult.ok) console.warn(shortcutResult.error.message)
  app.setLoginItemSettings({ openAtLogin: dataStore.snapshot().settings.launchOnStartup })
  createTray()
  ipcMain.handle('window:show-launcher', () => showLauncher())
  ipcMain.handle('window:hide-launcher', () => launcherWindow?.hide())
  ipcMain.handle('window:set-launcher-expanded', (_event, expanded: unknown) => resizeLauncher(expanded === true))
  ipcMain.handle('websites:list', (_event, folderId: unknown) => websiteService.list(typeof folderId === 'string' ? folderId : undefined))
  ipcMain.handle('websites:save', async (_event, input: unknown) => {
    if (!isRecord(input) || typeof input.name !== 'string' || typeof input.url !== 'string' || (input.id !== undefined && typeof input.id !== 'string') || (input.description !== undefined && typeof input.description !== 'string')) return fail('INVALID_ENTRY', '网址信息无效。')
    return websiteService.save({ id: input.id as string | undefined, name: input.name, url: input.url, description: input.description as string | undefined })
  })
  ipcMain.handle('websites:delete', async (_event, id: unknown) => typeof id === 'string' ? websiteService.delete(id) : fail('INVALID_ID', '网址编号无效。'))
  ipcMain.handle('websites:add-to-folders', async (_event, id: unknown, folderIds: unknown) => typeof id === 'string' && Array.isArray(folderIds) && folderIds.every((value) => typeof value === 'string') ? websiteService.addWebsiteToFolders(id, folderIds) : fail('INVALID_FOLDER', '收藏夹编号无效。'))
  ipcMain.handle('websites:cache-metadata', async (_event, id: unknown, metadata: unknown) => typeof id === 'string' && isRecord(metadata) && (metadata.title === undefined || typeof metadata.title === 'string') && (metadata.favicon === undefined || typeof metadata.favicon === 'string') ? websiteService.cacheMetadata(id, { title: metadata.title as string | undefined, favicon: metadata.favicon as string | undefined }) : fail('INVALID_METADATA', '网站信息无效。'))
  ipcMain.handle('websites:fetch-metadata', async (_event, url: unknown) => {
    if (typeof url !== 'string') return fail('INVALID_URL', '网址格式不正确。')
    try { return { ok: true, data: await websiteMetadata.fetch(url) } } catch (error) { return fail('FETCH_METADATA_FAILED', error instanceof Error ? error.message : '无法获取网站信息。') }
  })
  ipcMain.handle('everything:detect', () => everything.detect())
  ipcMain.handle('everything:choose-path', async () => {
    const options: OpenDialogOptions = { title: '选择 Everything ES 命令行工具', properties: ['openFile'], filters: [{ name: 'ES 命令行工具', extensions: ['exe'] }] }
    const result = managerWindow ? await dialog.showOpenDialog(managerWindow, options) : await dialog.showOpenDialog(options)
    const path = result.canceled ? undefined : result.filePaths[0]
    return path && basename(path).toLocaleLowerCase() === 'es.exe' ? path : null
  })
  ipcMain.handle('everything:search', async (_event, query: unknown): Promise<IpcResult<Awaited<ReturnType<EverythingClient['search']>>>> => {
    if (typeof query !== 'string' || !query.trim()) return { ok: true, data: [] }
    if (!dataStore.snapshot().settings.everythingEnabled) return fail('EVERYTHING_DISABLED', '请先在设置中启用 Everything 搜索。')
    try { return { ok: true, data: await everything.search(query, 20) } }
    catch (error) { return fail('EVERYTHING_SEARCH_FAILED', error instanceof Error ? error.message : 'Everything 搜索失败。') }
  })
  ipcMain.handle('everything:open', async (_event, id: unknown): Promise<IpcResult<void>> => {
    if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) return fail('INVALID_RESULT', '文件搜索结果无效。')
    try { await everything.open(id); return { ok: true, data: undefined } }
    catch (error) { return fail('EVERYTHING_OPEN_FAILED', error instanceof Error ? error.message : '无法打开这个搜索结果。') }
  })
  ipcMain.handle('window:show-manager', () => showManager())
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
  ipcMain.handle('websites:open', async (_event, id: unknown) => typeof id === 'string' ? websiteService.open(id) : fail('INVALID_ID', '网址编号无效。'))
  ipcMain.handle('settings:get', () => dataStore.snapshot().settings)
  ipcMain.handle('settings:update', async (_event, settings: unknown): Promise<IpcResult<AppSettings>> => {
    if (!isRecord(settings)) return fail('INVALID_SETTINGS', '设置内容无效。')
    if (settings.aiBaseUrl !== undefined && (typeof settings.aiBaseUrl !== 'string' || settings.aiBaseUrl.length > 500)) return fail('INVALID_SETTINGS', 'AI 服务地址无效。')
    if (settings.aiModel !== undefined && (typeof settings.aiModel !== 'string' || settings.aiModel.length > 120)) return fail('INVALID_SETTINGS', 'AI 模型名称无效。')
    if (settings.quickSearchShortcut !== undefined && (typeof settings.quickSearchShortcut !== 'string' || settings.quickSearchShortcut.length > 80)) return fail('INVALID_SETTINGS', '快捷键格式无效。')
    if (settings.launchOnStartup !== undefined && typeof settings.launchOnStartup !== 'boolean') return fail('INVALID_SETTINGS', '开机启动设置无效。')
    if (settings.websiteLayout !== undefined && !['grid', 'list'].includes(String(settings.websiteLayout))) return fail('INVALID_SETTINGS', '网址排布模式无效。')
    if (settings.everythingEnabled !== undefined && typeof settings.everythingEnabled !== 'boolean') return fail('INVALID_SETTINGS', 'Everything 启用状态无效。')
    if (settings.everythingEsPath !== undefined && (typeof settings.everythingEsPath !== 'string' || settings.everythingEsPath.length > 1000 || (settings.everythingEsPath && (!isAbsolute(settings.everythingEsPath) || basename(settings.everythingEsPath).toLocaleLowerCase() !== 'es.exe')))) return fail('INVALID_SETTINGS', 'ES 路径必须指向绝对路径下的 es.exe。')
    let searchEngines = dataStore.snapshot().settings.searchEngines
    if (settings.searchEngines !== undefined) {
      try { searchEngines = normalizeSearchEngines(settings.searchEngines) } catch (error) { return fail('INVALID_SEARCH_ENGINES', error instanceof Error ? error.message : '搜索引擎配置无效。') }
    }
    const requestedEngineId = typeof settings.defaultSearchEngineId === 'string' ? settings.defaultSearchEngineId : dataStore.snapshot().settings.defaultSearchEngineId
    const defaultSearchEngineId = searchEngines.some((engine) => engine.id === requestedEngineId && engine.enabled)
      ? requestedEngineId
      : searchEngines.find((engine) => engine.enabled)!.id
    const currentShortcut = dataStore.snapshot().settings.quickSearchShortcut
    const nextShortcut = typeof settings.quickSearchShortcut === 'string' ? settings.quickSearchShortcut : currentShortcut
    if (nextShortcut !== currentShortcut) {
      const registration = hotkeyService?.replace(nextShortcut)
      if (!registration?.ok) return registration ?? fail('SHORTCUT_NOT_INITIALIZED', '快捷键服务尚未初始化。')
    }
    let next
    try {
      next = await dataStore.update((data) => ({
        ...data,
        settings: {
          ...data.settings,
          searchEngines,
          defaultSearchEngineId,
          quickSearchShortcut: nextShortcut,
          launchOnStartup: typeof settings.launchOnStartup === 'boolean' ? settings.launchOnStartup : data.settings.launchOnStartup,
          websiteLayout: settings.websiteLayout === 'list' ? 'list' : settings.websiteLayout === 'grid' ? 'grid' : data.settings.websiteLayout,
          everythingEnabled: typeof settings.everythingEnabled === 'boolean' ? settings.everythingEnabled : data.settings.everythingEnabled,
          everythingEsPath: typeof settings.everythingEsPath === 'string' ? settings.everythingEsPath : data.settings.everythingEsPath,
          aiBaseUrl: typeof settings.aiBaseUrl === 'string' ? settings.aiBaseUrl : data.settings.aiBaseUrl,
          aiModel: typeof settings.aiModel === 'string' ? settings.aiModel : data.settings.aiModel,
        },
      }))
    } catch (error) {
      if (nextShortcut !== currentShortcut) hotkeyService?.replace(currentShortcut)
      return fail('SAVE_SETTINGS_FAILED', error instanceof Error ? error.message : '无法保存设置。')
    }
    app.setLoginItemSettings({ openAtLogin: next.settings.launchOnStartup })
    return { ok: true, data: next.settings }
  })
  ipcMain.handle('search:open-web', async (_event, query: unknown): Promise<IpcResult<void>> => {
    if (typeof query !== 'string' || !query.trim()) return fail('EMPTY_QUERY', '请输入要搜索的内容。')
    try {
      const settings = dataStore.snapshot().settings
      const engine = settings.searchEngines.find((item) => item.id === settings.defaultSearchEngineId && item.enabled)
      if (!engine) throw new Error('没有可用的网页搜索引擎，请前往设置添加。')
      const url = buildSearchUrl(engine, query)
      await openExternalUrl(url.toString())
      return { ok: true, data: undefined }
    } catch (error) {
      return fail('WEB_SEARCH_FAILED', error instanceof Error ? error.message : '无法打开搜索页面。')
    }
  })
  ipcMain.handle('bookmarks:list-folders', () => bookmarkService.listFolders())
  ipcMain.handle('bookmarks:save-folder', async (_event, input: unknown): Promise<IpcResult<Awaited<ReturnType<BookmarkService['saveFolder']>>>> => {
    if (!isRecord(input) || typeof input.name !== 'string' || input.name.length > 80 || (input.id !== undefined && typeof input.id !== 'string')) return fail('INVALID_FOLDER', '收藏夹信息无效。')
    try { return { ok: true, data: await bookmarkService.saveFolder({ id: input.id as string | undefined, name: input.name }) } } catch (error) {
      return fail('SAVE_FOLDER_FAILED', error instanceof Error ? error.message : '无法保存收藏夹。')
    }
  })
  ipcMain.handle('bookmarks:delete-folder', async (_event, folderId: unknown): Promise<IpcResult<void>> => {
    if (typeof folderId !== 'string') return fail('INVALID_FOLDER', '收藏夹编号无效。')
    try { await bookmarkService.deleteFolder(folderId); return { ok: true, data: undefined } } catch (error) {
      return fail('DELETE_FOLDER_FAILED', error instanceof Error ? error.message : '无法删除收藏夹。')
    }
  })
  ipcMain.handle('ai:has-key', async () => {
    try { return await secretStore.hasSecret('ai-api-key') } catch { return false }
  })
  ipcMain.handle('ai:save-key', async (_event, apiKey: unknown): Promise<IpcResult<void>> => {
    if (typeof apiKey !== 'string' || apiKey.length > 1000) return fail('INVALID_API_KEY', 'API Key 无效。')
    if (!apiKey.trim()) return fail('INVALID_API_KEY', '请输入 API Key。')
    try { await secretStore.setSecret('ai-api-key', apiKey.trim()); return { ok: true, data: undefined } } catch (error) {
      return fail('SAVE_API_KEY_FAILED', error instanceof Error ? error.message : '无法安全保存 API Key。')
    }
  })
  ipcMain.handle('ai:clear-key', async (): Promise<IpcResult<void>> => {
    try { await secretStore.deleteSecret('ai-api-key'); return { ok: true, data: undefined } } catch (error) {
      return fail('CLEAR_API_KEY_FAILED', error instanceof Error ? error.message : '无法删除 API Key。')
    }
  })
  ipcMain.handle('ai:translate', async (_event, input: unknown): Promise<IpcResult<{ translation: string }>> => {
    if (!isRecord(input) || typeof input.text !== 'string' || typeof input.targetLanguage !== 'string') return fail('INVALID_TRANSLATION', '翻译输入无效。')
    try { return { ok: true, data: { translation: await aiTranslationService.translate(input.text, input.targetLanguage) } } } catch (error) {
      return fail('TRANSLATION_FAILED', error instanceof Error ? error.message : '翻译失败，请稍后再试。')
    }
  })
  ipcMain.handle('ai:test-connection', async (): Promise<IpcResult<{ model: string }>> => {
    try { return { ok: true, data: { model: await aiTranslationService.testConnection() } } } catch (error) {
      return fail('AI_CONNECTION_FAILED', error instanceof Error ? error.message : '无法连接 AI 服务。')
    }
  })
  ipcMain.handle('translate:open-google', async (_event, input: unknown): Promise<IpcResult<void>> => {
    if (!isRecord(input) || typeof input.text !== 'string' || typeof input.targetLanguage !== 'string') return fail('INVALID_TRANSLATION', '翻译输入无效。')
    try { await openExternalUrl(buildGoogleTranslateUrl(input.text, input.targetLanguage)); return { ok: true, data: undefined } } catch (error) {
      return fail('GOOGLE_TRANSLATE_FAILED', error instanceof Error ? error.message : '无法打开 Google Translate。')
    }
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // The app remains resident in the Windows tray.
})

app.on('before-quit', () => {
  quitting = true
  hotkeyService?.dispose()
  tray?.destroy()
  tray = null
})
