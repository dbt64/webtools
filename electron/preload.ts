import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type DesktopApi } from '../src/shared/ipc'

const desktopApi: DesktopApi = {
  showLauncher: () => ipcRenderer.invoke(IPC_CHANNELS.showLauncher) as Promise<void>,
  launcherReady: () => ipcRenderer.send(IPC_CHANNELS.launcherReady),
  onLauncherVisibility: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      if (!value || typeof value !== 'object') return
      const payload = value as Record<string, unknown>
      if (!Number.isSafeInteger(payload.generation) || (payload.generation as number) < 1) return
      if (payload.kind === 'hidden') handler({ kind: 'hidden', generation: payload.generation as number })
      else if (payload.kind === 'shown'
        && (payload.launcherDisplayMode === 'compact' || payload.launcherDisplayMode === 'expanded')
        && (payload.theme === 'light' || payload.theme === 'dark' || payload.theme === 'system')) {
        handler({ kind: 'shown', generation: payload.generation as number, launcherDisplayMode: payload.launcherDisplayMode, theme: payload.theme })
      }
    }
    ipcRenderer.on(IPC_CHANNELS.launcherVisibility, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.launcherVisibility, listener)
  },
  acknowledgeLauncherVisibility: (generation) => ipcRenderer.send(IPC_CHANNELS.acknowledgeLauncherVisibility, generation),
  hideLauncher: () => ipcRenderer.invoke(IPC_CHANNELS.hideLauncher) as Promise<void>,
  setLauncherExpanded: (expanded, expandedSectionExtraHeight, hasSearchResults, generation) => ipcRenderer.invoke(IPC_CHANNELS.setLauncherExpanded, expanded, expandedSectionExtraHeight, hasSearchResults, generation) as Promise<void>,
  moveLauncherBy: (deltaX, deltaY) => ipcRenderer.send(IPC_CHANNELS.moveLauncherBy, deltaX, deltaY),
  showManager: () => ipcRenderer.invoke(IPC_CHANNELS.showManager) as Promise<void>,
  openTranslation: (text) => ipcRenderer.invoke(IPC_CHANNELS.openTranslation, text) as ReturnType<DesktopApi['openTranslation']>,
  managerReady: () => ipcRenderer.send(IPC_CHANNELS.managerReady),
  onTranslationPrefill: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, request: unknown): void => {
      if (typeof request !== 'object' || request === null) return
      const payload = request as Record<string, unknown>
      if (typeof payload.id !== 'string' || typeof payload.text !== 'string') return
      handler({ id: payload.id, text: payload.text })
    }
    ipcRenderer.on(IPC_CHANNELS.translationPrefill, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.translationPrefill, listener)
  },
  acknowledgeTranslationPrefill: (id) => ipcRenderer.send(IPC_CHANNELS.acknowledgeTranslationPrefill, id),
  onNativeManagerIntent: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return
      const intent = value as Record<string, unknown>
      if (typeof intent.requestId !== 'string' || intent.requestId.length === 0 || intent.requestId.length > 128) return
      if (intent.kind === 'open-page'
        && (intent.section === 'search' || intent.section === 'entries' || intent.section === 'settings' || intent.section === 'translate')) {
        handler({ requestId: intent.requestId, kind: 'open-page', section: intent.section })
      } else if (intent.kind === 'translation-prefill' && typeof intent.text === 'string' && intent.text.length > 0 && intent.text.length <= 20_000) {
        handler({ requestId: intent.requestId, kind: 'translation-prefill', text: intent.text })
      }
    }
    ipcRenderer.on(IPC_CHANNELS.nativeManagerIntent, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.nativeManagerIntent, listener)
  },
  acknowledgeNativeManagerIntent: (requestId) => ipcRenderer.send(IPC_CHANNELS.acknowledgeNativeManagerIntent, requestId),
  getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.getVersion) as Promise<string>,
  getApps: () => ipcRenderer.invoke(IPC_CHANNELS.getApps) as Promise<Awaited<ReturnType<DesktopApi['getApps']>>>,
  getLauncherData: (knownVersions) => ipcRenderer.invoke(IPC_CHANNELS.getLauncherData, knownVersions) as ReturnType<DesktopApi['getLauncherData']>,
  getWebsiteIcons: (ids) => ipcRenderer.invoke(IPC_CHANNELS.getWebsiteIcons, ids) as ReturnType<DesktopApi['getWebsiteIcons']>,
  refreshApps: () => ipcRenderer.invoke(IPC_CHANNELS.refreshApps) as Promise<Awaited<ReturnType<DesktopApi['refreshApps']>>>,
  onAppsCatalogUpdated: (handler) => {
    const listener = (): void => handler()
    ipcRenderer.on(IPC_CHANNELS.appsCatalogUpdated, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.appsCatalogUpdated, listener)
  },
  getAppIcon: (id) => ipcRenderer.invoke(IPC_CHANNELS.getAppIcon, id) as ReturnType<DesktopApi['getAppIcon']>,
  launchApp: (id) => ipcRenderer.invoke(IPC_CHANNELS.launchApp, id) as ReturnType<DesktopApi['launchApp']>,
  getRememberedAppSearchAppId: (query) => ipcRenderer.invoke(IPC_CHANNELS.getRememberedAppSearchAppId, query) as ReturnType<DesktopApi['getRememberedAppSearchAppId']>,
  rememberAppSearchResult: (query, appId) => ipcRenderer.invoke(IPC_CHANNELS.rememberAppSearchResult, query, appId) as ReturnType<DesktopApi['rememberAppSearchResult']>,
  openWebsite: (id) => ipcRenderer.invoke(IPC_CHANNELS.openWebsite, id) as ReturnType<DesktopApi['openWebsite']>,
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getSettings) as ReturnType<DesktopApi['getSettings']>,
  getThemePreference: () => ipcRenderer.invoke(IPC_CHANNELS.getThemePreference) as ReturnType<DesktopApi['getThemePreference']>,
  updateSettings: (settings) => ipcRenderer.invoke(IPC_CHANNELS.updateSettings, settings) as ReturnType<DesktopApi['updateSettings']>,
  openSearch: (query) => ipcRenderer.invoke(IPC_CHANNELS.openSearch, query) as ReturnType<DesktopApi['openSearch']>,
  listBookmarkFolders: () => ipcRenderer.invoke(IPC_CHANNELS.listBookmarkFolders) as ReturnType<DesktopApi['listBookmarkFolders']>,
  saveBookmarkFolder: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveBookmarkFolder, input) as ReturnType<DesktopApi['saveBookmarkFolder']>,
  deleteBookmarkFolder: (folderId) => ipcRenderer.invoke(IPC_CHANNELS.deleteBookmarkFolder, folderId) as ReturnType<DesktopApi['deleteBookmarkFolder']>,
  getAIProviderDescriptors: () => ipcRenderer.invoke(IPC_CHANNELS.getAIProviderDescriptors) as ReturnType<DesktopApi['getAIProviderDescriptors']>,
  getAIProviderStatus: (providerId) => ipcRenderer.invoke(IPC_CHANNELS.getAIProviderStatus, providerId) as ReturnType<DesktopApi['getAIProviderStatus']>,
  saveAIProviderKey: (providerId, apiKey) => ipcRenderer.invoke(IPC_CHANNELS.saveAIProviderKey, providerId, apiKey) as ReturnType<DesktopApi['saveAIProviderKey']>,
  clearAIProviderKey: (providerId) => ipcRenderer.invoke(IPC_CHANNELS.clearAIProviderKey, providerId) as ReturnType<DesktopApi['clearAIProviderKey']>,
  getQwenRegions: () => ipcRenderer.invoke(IPC_CHANNELS.getQwenRegions) as ReturnType<DesktopApi['getQwenRegions']>,
  getTranslationProviderInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getTranslationProviderInfo) as ReturnType<DesktopApi['getTranslationProviderInfo']>,
  translate: (request) => ipcRenderer.invoke(IPC_CHANNELS.translate, request) as ReturnType<DesktopApi['translate']>,
  cancelTranslation: (requestId) => ipcRenderer.invoke(IPC_CHANNELS.cancelTranslation, requestId) as ReturnType<DesktopApi['cancelTranslation']>,
  testAIConnection: () => ipcRenderer.invoke(IPC_CHANNELS.testAIConnection) as ReturnType<DesktopApi['testAIConnection']>,
  openGoogleTranslate: (input) => ipcRenderer.invoke(IPC_CHANNELS.openGoogleTranslate, input) as ReturnType<DesktopApi['openGoogleTranslate']>,
  listWebsites: (folderId) => ipcRenderer.invoke(IPC_CHANNELS.listWebsites, folderId) as ReturnType<DesktopApi['listWebsites']>,
  saveWebsite: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveWebsite, input) as ReturnType<DesktopApi['saveWebsite']>,
  deleteWebsite: (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteWebsite, id) as ReturnType<DesktopApi['deleteWebsite']>,
  addWebsiteToFolders: (id, folderIds) => ipcRenderer.invoke(IPC_CHANNELS.addWebsiteToFolders, id, folderIds) as ReturnType<DesktopApi['addWebsiteToFolders']>,
  fetchWebsiteMetadata: (url) => ipcRenderer.invoke(IPC_CHANNELS.fetchWebsiteMetadata, url) as ReturnType<DesktopApi['fetchWebsiteMetadata']>,
  searchEverything: (query) => ipcRenderer.invoke(IPC_CHANNELS.searchEverything, query) as ReturnType<DesktopApi['searchEverything']>,
  openEverythingResult: (id) => ipcRenderer.invoke(IPC_CHANNELS.openEverythingResult, id) as ReturnType<DesktopApi['openEverythingResult']>,
  detectEverything: () => ipcRenderer.invoke(IPC_CHANNELS.detectEverything) as ReturnType<DesktopApi['detectEverything']>,
  chooseEverythingPath: () => ipcRenderer.invoke(IPC_CHANNELS.chooseEverythingPath) as ReturnType<DesktopApi['chooseEverythingPath']>,
}

contextBridge.exposeInMainWorld('desktop', desktopApi)
