import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { basename, isAbsolute } from 'node:path'
import type { DataStore } from '../services/data-store'
import type { GlobalHotkeyService } from '../services/global-hotkey'
import { isValidSharedAISettings } from '../../src/shared/ai-config.ts'
import { isValidTranslationSettings, type TranslationSettings } from '../../src/shared/translation-contracts.ts'
import { buildSearchUrl, normalizeSearchEngines } from '../../src/shared/search-providers'
import type { AppSettings, ThemePreference } from '../../src/shared/domain'
import type { IpcResult } from '../../src/shared/ipc'
import type { IpcSenderContext } from './window-security'

function fail<T>(code: string, message: string): IpcResult<T> { return { ok: false, error: { code, message } } }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

export function registerSettingsIpcHandlers(deps: {
  dataStore: DataStore
  hotkeyService: GlobalHotkeyService | null
  setOpenAtLogin: (enabled: boolean) => void
  openExternal: (url: string) => Promise<void>
  isManagerMainFrame: (event: IpcSenderContext) => boolean
  isAppMainFrame: (event: IpcSenderContext) => boolean
  cancelTranslations: () => void
}): void {
  const { dataStore, hotkeyService } = deps
  let pendingSettingsUpdate: Promise<void> = Promise.resolve()

  ipcMain.handle('settings:get', (event: IpcMainInvokeEvent) => {
    if (!deps.isManagerMainFrame(event)) throw new Error('当前窗口无权读取完整设置。')
    return dataStore.snapshot().settings
  })
  ipcMain.handle('settings:get-theme', (event: IpcMainInvokeEvent): ThemePreference => {
    if (!deps.isAppMainFrame(event)) throw new Error('当前窗口无权读取主题设置。')
    return dataStore.snapshot().settings.theme
  })
  ipcMain.handle('settings:update', (event: IpcMainInvokeEvent, settings: unknown) => {
    if (!deps.isManagerMainFrame(event)) return fail<AppSettings>('UNAUTHORIZED', '当前窗口无权修改设置。')

    const operation = pendingSettingsUpdate.then(async (): Promise<IpcResult<AppSettings>> => {
      if (!isRecord(settings)) return fail('INVALID_SETTINGS', '设置内容无效。')
      if (settings.aiBaseUrl !== undefined && (typeof settings.aiBaseUrl !== 'string' || settings.aiBaseUrl.length > 500)) return fail('INVALID_SETTINGS', 'AI 服务地址无效。')
      if (settings.aiModel !== undefined && (typeof settings.aiModel !== 'string' || settings.aiModel.length > 120)) return fail('INVALID_SETTINGS', 'AI 模型名称无效。')
      if (settings.quickSearchShortcut !== undefined && (typeof settings.quickSearchShortcut !== 'string' || settings.quickSearchShortcut.length > 80)) return fail('INVALID_SETTINGS', '快捷键格式无效。')
      if (settings.launchOnStartup !== undefined && typeof settings.launchOnStartup !== 'boolean') return fail('INVALID_SETTINGS', '开机启动设置无效。')
      if (settings.theme !== undefined && (typeof settings.theme !== 'string' || !['light', 'dark', 'system'].includes(settings.theme))) return fail('INVALID_SETTINGS', '主题设置无效。')
      if (settings.launcherDisplayMode !== undefined && (typeof settings.launcherDisplayMode !== 'string' || !['compact', 'expanded'].includes(settings.launcherDisplayMode))) return fail('INVALID_SETTINGS', '启动器显示模式无效。')
      if (settings.websiteLayout !== undefined && !['grid', 'list'].includes(String(settings.websiteLayout))) return fail('INVALID_SETTINGS', '网址排布模式无效。')
      if (settings.everythingEnabled !== undefined && typeof settings.everythingEnabled !== 'boolean') return fail('INVALID_SETTINGS', 'Everything 启用状态无效。')
      if (settings.everythingEsPath !== undefined && (typeof settings.everythingEsPath !== 'string' || settings.everythingEsPath.length > 1000 || (settings.everythingEsPath && (!isAbsolute(settings.everythingEsPath) || basename(settings.everythingEsPath).toLocaleLowerCase() !== 'es.exe')))) return fail('INVALID_SETTINGS', 'ES 路径必须指向绝对路径下的 es.exe。')
      if (settings.sharedAI !== undefined && !isValidSharedAISettings(settings.sharedAI)) return fail('INVALID_AI_SETTINGS', 'AI 提供方配置无效。')
      if (settings.translation !== undefined && !isValidTranslationSettings(settings.translation)) return fail('INVALID_TRANSLATION_SETTINGS', '翻译设置无效。')

      const currentSettings = dataStore.snapshot().settings
      let searchEngines = currentSettings.searchEngines
      if (settings.searchEngines !== undefined) {
        try { searchEngines = normalizeSearchEngines(settings.searchEngines) }
        catch (error) { return fail('INVALID_SEARCH_ENGINES', error instanceof Error ? error.message : '搜索引擎配置无效。') }
      }
      const requestedEngineId = typeof settings.defaultSearchEngineId === 'string' ? settings.defaultSearchEngineId : currentSettings.defaultSearchEngineId
      const defaultSearchEngineId = searchEngines.some((engine) => engine.id === requestedEngineId && engine.enabled) ? requestedEngineId : searchEngines.find((engine) => engine.enabled)?.id
      if (!defaultSearchEngineId) return fail('INVALID_SEARCH_ENGINES', '至少需要启用一个搜索引擎。')

      const nextShortcut = typeof settings.quickSearchShortcut === 'string' ? settings.quickSearchShortcut : currentSettings.quickSearchShortcut
      const shortcutChanged = nextShortcut !== currentSettings.quickSearchShortcut
      if (shortcutChanged) {
        const registration = hotkeyService?.replace(nextShortcut)
        if (!registration?.ok) return registration ?? fail('SHORTCUT_NOT_INITIALIZED', '快捷键服务尚未初始化。')
      }

      const nextLaunchOnStartup = typeof settings.launchOnStartup === 'boolean' ? settings.launchOnStartup : currentSettings.launchOnStartup
      const startupChanged = nextLaunchOnStartup !== currentSettings.launchOnStartup
      if (startupChanged) {
        try { deps.setOpenAtLogin(nextLaunchOnStartup) }
        catch (error) {
          if (shortcutChanged) hotkeyService?.replace(currentSettings.quickSearchShortcut)
          return fail('UPDATE_STARTUP_FAILED', error instanceof Error ? error.message : '无法更新 Windows 登录启动设置。')
        }
      }

      const sharedAI = settings.sharedAI === undefined ? currentSettings.sharedAI : structuredClone(settings.sharedAI)
      const customAI = sharedAI.providers.custom
      let next: Awaited<ReturnType<DataStore['update']>>
      try {
        next = await dataStore.update((data) => ({
          ...data,
          settings: {
            ...data.settings,
            searchEngines,
            defaultSearchEngineId,
            quickSearchShortcut: nextShortcut,
            launchOnStartup: nextLaunchOnStartup,
            theme: settings.theme === 'light' || settings.theme === 'dark' || settings.theme === 'system' ? settings.theme : data.settings.theme,
            launcherDisplayMode: settings.launcherDisplayMode === 'compact' || settings.launcherDisplayMode === 'expanded' ? settings.launcherDisplayMode : data.settings.launcherDisplayMode,
            websiteLayout: settings.websiteLayout === 'list' ? 'list' : settings.websiteLayout === 'grid' ? 'grid' : data.settings.websiteLayout,
            everythingEnabled: typeof settings.everythingEnabled === 'boolean' ? settings.everythingEnabled : data.settings.everythingEnabled,
            everythingEsPath: typeof settings.everythingEsPath === 'string' ? settings.everythingEsPath : data.settings.everythingEsPath,
            sharedAI,
            translation: settings.translation === undefined ? data.settings.translation : structuredClone(settings.translation as TranslationSettings),
            aiBaseUrl: customAI?.baseUrl ?? (settings.sharedAI === undefined && typeof settings.aiBaseUrl === 'string' ? settings.aiBaseUrl : data.settings.aiBaseUrl),
            aiModel: customAI?.model ?? (settings.sharedAI === undefined && typeof settings.aiModel === 'string' ? settings.aiModel : data.settings.aiModel),
          },
        }))
      } catch (error) {
        if (shortcutChanged) hotkeyService?.replace(currentSettings.quickSearchShortcut)
        if (startupChanged) {
          try { deps.setOpenAtLogin(currentSettings.launchOnStartup) }
          catch (rollbackError) { console.warn('[settings:update] failed to restore Windows login startup setting', rollbackError) }
        }
        return fail('SAVE_SETTINGS_FAILED', error instanceof Error ? error.message : '无法保存设置。')
      }

      if (settings.sharedAI !== undefined || settings.translation !== undefined) deps.cancelTranslations()
      return { ok: true, data: next.settings }
    })

    pendingSettingsUpdate = operation.then(() => undefined, () => undefined)
    return operation
  })

  ipcMain.handle('search:open-web', async (event: IpcMainInvokeEvent, query: unknown): Promise<IpcResult<void>> => {
    if (!deps.isAppMainFrame(event)) return fail('UNAUTHORIZED', '当前窗口无权发起网页搜索。')
    if (typeof query !== 'string' || !query.trim()) return fail('EMPTY_QUERY', '请输入要搜索的内容。')
    try {
      const settings = dataStore.snapshot().settings
      const engine = settings.searchEngines.find((item) => item.id === settings.defaultSearchEngineId && item.enabled)
      if (!engine) throw new Error('没有可用的网页搜索引擎，请前往设置添加。')
      await deps.openExternal(buildSearchUrl(engine, query).toString())
      return { ok: true, data: undefined }
    } catch (error) { return fail('WEB_SEARCH_FAILED', error instanceof Error ? error.message : '无法打开搜索页面。') }
  })
}
