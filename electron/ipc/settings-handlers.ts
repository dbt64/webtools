import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { basename, isAbsolute } from 'node:path'
import type { DataStore } from '../services/data-store'
import type { NativeLauncherSettingsUpdate } from '../services/native-manager-client'
import { isValidSharedAISettings } from '../../src/shared/ai-config.ts'
import { isValidTranslationSettings, type TranslationSettings } from '../../src/shared/translation-contracts.ts'
import { normalizeSearchEngines } from '../../src/shared/search-providers'
import type { AppSettings, ThemePreference } from '../../src/shared/domain'
import type { IpcResult } from '../../src/shared/ipc'
import type { IpcSenderContext } from './window-security'

function fail<T>(code: string, message: string): IpcResult<T> { return { ok: false, error: { code, message } } }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

export function registerSettingsIpcHandlers(deps: {
  dataStore: DataStore
  isManagerMainFrame: (event: IpcSenderContext) => boolean
  cancelTranslations: () => void
  getSettings?: () => AppSettings
  updateNativeLauncherSettings?: (settings: NativeLauncherSettingsUpdate) => Promise<AppSettings>
}): void {
  const { dataStore } = deps
  let pendingSettingsUpdate: Promise<void> = Promise.resolve()

  ipcMain.handle('settings:get', (event: IpcMainInvokeEvent) => {
    if (!deps.isManagerMainFrame(event)) throw new Error('当前窗口无权读取完整设置。')
    return deps.getSettings?.() ?? dataStore.snapshot().settings
  })
  ipcMain.handle('settings:get-theme', (event: IpcMainInvokeEvent): ThemePreference => {
    if (!deps.isManagerMainFrame(event)) throw new Error('当前窗口无权读取主题设置。')
    return (deps.getSettings?.() ?? dataStore.snapshot().settings).theme
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

      const currentSettings = deps.getSettings?.() ?? dataStore.snapshot().settings
      let searchEngines = currentSettings.searchEngines
      if (settings.searchEngines !== undefined) {
        try { searchEngines = normalizeSearchEngines(settings.searchEngines) }
        catch (error) { return fail('INVALID_SEARCH_ENGINES', error instanceof Error ? error.message : '搜索引擎配置无效。') }
      }
      const requestedEngineId = typeof settings.defaultSearchEngineId === 'string' ? settings.defaultSearchEngineId : currentSettings.defaultSearchEngineId
      const defaultSearchEngineId = searchEngines.some((engine) => engine.id === requestedEngineId && engine.enabled) ? requestedEngineId : searchEngines.find((engine) => engine.enabled)?.id
      if (!defaultSearchEngineId) return fail('INVALID_SEARCH_ENGINES', '至少需要启用一个搜索引擎。')

      const nextShortcut = typeof settings.quickSearchShortcut === 'string' ? settings.quickSearchShortcut : currentSettings.quickSearchShortcut
      const nextLaunchOnStartup = typeof settings.launchOnStartup === 'boolean' ? settings.launchOnStartup : currentSettings.launchOnStartup

      const nativeUpdate: NativeLauncherSettingsUpdate = {}
      if (settings.quickSearchShortcut !== undefined) nativeUpdate.quickSearchShortcut = nextShortcut
      if (settings.launchOnStartup !== undefined) nativeUpdate.launchOnStartup = nextLaunchOnStartup
      if (settings.theme !== undefined) nativeUpdate.theme = settings.theme as ThemePreference
      if (settings.launcherDisplayMode !== undefined) nativeUpdate.launcherDisplayMode = settings.launcherDisplayMode as AppSettings['launcherDisplayMode']
      if (settings.searchEngines !== undefined) nativeUpdate.searchEngines = searchEngines
      if (settings.defaultSearchEngineId !== undefined || settings.searchEngines !== undefined) nativeUpdate.defaultSearchEngineId = defaultSearchEngineId
      if (settings.everythingEnabled !== undefined) nativeUpdate.everythingEnabled = settings.everythingEnabled as boolean
      if (settings.everythingEsPath !== undefined) nativeUpdate.everythingEsPath = settings.everythingEsPath as string

      const sharedAI = settings.sharedAI === undefined ? currentSettings.sharedAI : structuredClone(settings.sharedAI)
      const customAI = sharedAI.providers.custom
      let nativeSettingsUpdated = false
      let next: Awaited<ReturnType<DataStore['update']>> | null = null
      try {
        if (deps.updateNativeLauncherSettings && Object.keys(nativeUpdate).length > 0) {
          await deps.updateNativeLauncherSettings(nativeUpdate)
          nativeSettingsUpdated = true
        }

        const hasManagerSettings = settings.websiteLayout !== undefined || settings.sharedAI !== undefined || settings.translation !== undefined || settings.aiBaseUrl !== undefined || settings.aiModel !== undefined
        const persistStandaloneLauncherPreferences = !deps.updateNativeLauncherSettings && Object.keys(nativeUpdate).length > 0
        if (hasManagerSettings || persistStandaloneLauncherPreferences) {
          next = await dataStore.update((data) => ({
            ...data,
            settings: {
              ...data.settings,
              searchEngines: deps.updateNativeLauncherSettings ? data.settings.searchEngines : searchEngines,
              defaultSearchEngineId: deps.updateNativeLauncherSettings ? data.settings.defaultSearchEngineId : defaultSearchEngineId,
              quickSearchShortcut: deps.updateNativeLauncherSettings ? data.settings.quickSearchShortcut : nextShortcut,
              launchOnStartup: deps.updateNativeLauncherSettings ? data.settings.launchOnStartup : nextLaunchOnStartup,
              theme: deps.updateNativeLauncherSettings ? data.settings.theme : settings.theme === 'light' || settings.theme === 'dark' || settings.theme === 'system' ? settings.theme : data.settings.theme,
              launcherDisplayMode: deps.updateNativeLauncherSettings ? data.settings.launcherDisplayMode : settings.launcherDisplayMode === 'compact' || settings.launcherDisplayMode === 'expanded' ? settings.launcherDisplayMode : data.settings.launcherDisplayMode,
              websiteLayout: settings.websiteLayout === 'list' ? 'list' : settings.websiteLayout === 'grid' ? 'grid' : data.settings.websiteLayout,
              everythingEnabled: deps.updateNativeLauncherSettings ? data.settings.everythingEnabled : typeof settings.everythingEnabled === 'boolean' ? settings.everythingEnabled : data.settings.everythingEnabled,
              everythingEsPath: deps.updateNativeLauncherSettings ? data.settings.everythingEsPath : typeof settings.everythingEsPath === 'string' ? settings.everythingEsPath : data.settings.everythingEsPath,
              sharedAI,
              translation: settings.translation === undefined ? data.settings.translation : structuredClone(settings.translation as TranslationSettings),
              aiBaseUrl: customAI?.baseUrl ?? (settings.sharedAI === undefined && typeof settings.aiBaseUrl === 'string' ? settings.aiBaseUrl : data.settings.aiBaseUrl),
              aiModel: customAI?.model ?? (settings.sharedAI === undefined && typeof settings.aiModel === 'string' ? settings.aiModel : data.settings.aiModel),
            },
          }))
        }
      } catch (error) {
        if (nativeSettingsUpdated && deps.updateNativeLauncherSettings) {
          const previousNativeSettings: NativeLauncherSettingsUpdate = {
            ...(settings.quickSearchShortcut !== undefined ? { quickSearchShortcut: currentSettings.quickSearchShortcut } : {}),
            ...(settings.launchOnStartup !== undefined ? { launchOnStartup: currentSettings.launchOnStartup } : {}),
            ...(settings.theme !== undefined ? { theme: currentSettings.theme } : {}),
            ...(settings.launcherDisplayMode !== undefined ? { launcherDisplayMode: currentSettings.launcherDisplayMode } : {}),
            ...(settings.searchEngines !== undefined ? { searchEngines: currentSettings.searchEngines } : {}),
            ...((settings.defaultSearchEngineId !== undefined || settings.searchEngines !== undefined) ? { defaultSearchEngineId: currentSettings.defaultSearchEngineId } : {}),
            ...(settings.everythingEnabled !== undefined ? { everythingEnabled: currentSettings.everythingEnabled } : {}),
            ...(settings.everythingEsPath !== undefined ? { everythingEsPath: currentSettings.everythingEsPath } : {}),
          }
          try { await deps.updateNativeLauncherSettings(previousNativeSettings) }
          catch (rollbackError) { console.warn('[settings:update] Native Launcher settings rollback failed', rollbackError) }
        }
        return fail('SAVE_SETTINGS_FAILED', error instanceof Error ? error.message : '无法保存设置。')
      }

      if (settings.sharedAI !== undefined || settings.translation !== undefined) deps.cancelTranslations()
      return { ok: true, data: deps.getSettings?.() ?? next?.settings ?? dataStore.snapshot().settings }
    })

    pendingSettingsUpdate = operation.then(() => undefined, () => undefined)
    return operation
  })
}
