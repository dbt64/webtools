import { ipcMain } from 'electron'
import { basename, isAbsolute } from 'node:path'
import type { DataStore } from '../services/data-store'
import type { GlobalHotkeyService } from '../services/global-hotkey'
import { buildSearchUrl, normalizeSearchEngines } from '../../src/shared/search-providers'
import type { AppSettings } from '../../src/shared/domain'
import type { IpcResult } from '../../src/shared/ipc'

function fail<T>(code: string, message: string): IpcResult<T> { return { ok: false, error: { code, message } } }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

export function registerSettingsIpcHandlers(deps: {
  dataStore: DataStore
  hotkeyService: GlobalHotkeyService | null
  setOpenAtLogin: (enabled: boolean) => void
  openExternal: (url: string) => Promise<void>
}): void {
  const { dataStore, hotkeyService } = deps
  let pendingSettingsUpdate: Promise<void> = Promise.resolve()
  ipcMain.handle('settings:get', () => dataStore.snapshot().settings)
  ipcMain.handle('settings:update', (_event, settings: unknown) => {
    const operation = pendingSettingsUpdate.then(async (): Promise<IpcResult<AppSettings>> => {
    if (!isRecord(settings)) return fail('INVALID_SETTINGS', '设置内容无效。')
    if (settings.aiBaseUrl !== undefined && (typeof settings.aiBaseUrl !== 'string' || settings.aiBaseUrl.length > 500)) return fail('INVALID_SETTINGS', 'AI 服务地址无效。')
    if (settings.aiModel !== undefined && (typeof settings.aiModel !== 'string' || settings.aiModel.length > 120)) return fail('INVALID_SETTINGS', 'AI 模型名称无效。')
    if (settings.quickSearchShortcut !== undefined && (typeof settings.quickSearchShortcut !== 'string' || settings.quickSearchShortcut.length > 80)) return fail('INVALID_SETTINGS', '快捷键格式无效。')
    if (settings.launchOnStartup !== undefined && typeof settings.launchOnStartup !== 'boolean') return fail('INVALID_SETTINGS', '开机启动设置无效。')
    if (settings.websiteLayout !== undefined && !['grid', 'list'].includes(String(settings.websiteLayout))) return fail('INVALID_SETTINGS', '网址排布模式无效。')
    if (settings.everythingEnabled !== undefined && typeof settings.everythingEnabled !== 'boolean') return fail('INVALID_SETTINGS', 'Everything 启用状态无效。')
    if (settings.everythingEsPath !== undefined && (typeof settings.everythingEsPath !== 'string' || settings.everythingEsPath.length > 1000 || (settings.everythingEsPath && (!isAbsolute(settings.everythingEsPath) || basename(settings.everythingEsPath).toLocaleLowerCase() !== 'es.exe')))) return fail('INVALID_SETTINGS', 'ES 路径必须指向绝对路径下的 es.exe。')
    const currentSettings = dataStore.snapshot().settings
    let searchEngines = currentSettings.searchEngines
    if (settings.searchEngines !== undefined) {
      try { searchEngines = normalizeSearchEngines(settings.searchEngines) } catch (error) { return fail('INVALID_SEARCH_ENGINES', error instanceof Error ? error.message : '搜索引擎配置无效。') }
    }
    const requestedEngineId = typeof settings.defaultSearchEngineId === 'string' ? settings.defaultSearchEngineId : currentSettings.defaultSearchEngineId
    const defaultSearchEngineId = searchEngines.some((engine) => engine.id === requestedEngineId && engine.enabled) ? requestedEngineId : searchEngines.find((engine) => engine.enabled)!.id
    const currentShortcut = currentSettings.quickSearchShortcut
    const nextShortcut = typeof settings.quickSearchShortcut === 'string' ? settings.quickSearchShortcut : currentShortcut
    if (nextShortcut !== currentShortcut) {
      const registration = hotkeyService?.replace(nextShortcut)
      if (!registration?.ok) return registration ?? fail('SHORTCUT_NOT_INITIALIZED', '快捷键服务尚未初始化。')
    }
    const nextLaunchOnStartup = typeof settings.launchOnStartup === 'boolean' ? settings.launchOnStartup : currentSettings.launchOnStartup
    const startupChanged = nextLaunchOnStartup !== currentSettings.launchOnStartup
    if (startupChanged) {
      try { deps.setOpenAtLogin(nextLaunchOnStartup) }
      catch (error) {
        if (nextShortcut !== currentShortcut) hotkeyService?.replace(currentShortcut)
        return fail('UPDATE_STARTUP_FAILED', error instanceof Error ? error.message : '无法更新 Windows 登录启动设置。')
      }
    }
    let next
    try {
      next = await dataStore.update((data) => ({
        ...data,
        settings: {
          ...data.settings, searchEngines, defaultSearchEngineId, quickSearchShortcut: nextShortcut,
          launchOnStartup: nextLaunchOnStartup,
          websiteLayout: settings.websiteLayout === 'list' ? 'list' : settings.websiteLayout === 'grid' ? 'grid' : data.settings.websiteLayout,
          everythingEnabled: typeof settings.everythingEnabled === 'boolean' ? settings.everythingEnabled : data.settings.everythingEnabl