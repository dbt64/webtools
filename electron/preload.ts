import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type DesktopApi } from '../src/shared/ipc'

const desktopApi: DesktopApi = {
  showLauncher: () => ipcRenderer.invoke(IPC_CHANNELS.showLauncher) as Promise<void>,
  launcherReady: () => ipcRenderer.send(IPC_CHANNELS.launcherReady),
  hideLauncher: () => ipcRenderer.invoke(IPC_CHANNELS.hideLauncher) as Promise<void>,
  setLauncherExpanded: (expanded, expandedSectionExtraHeight, hasSearchResults) => ipcRenderer.invoke(IPC_CHANNELS.setLauncherExpanded, expanded, expandedSectionExtraHeight, hasSearchResults) as Promise<void>,
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
  getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.getVersion) as Promise<string>,
  getApps: () => ipcRenderer.invoke(IPC_CHANNELS.getApps) as Promise<Awaited<ReturnType<DesktopApi['getApps']>>>,
  refreshApps: () => ipcRenderer.invoke(IPC_CHANNELS.refreshApps) as Promise<Awaited<ReturnType<DesktopApi['refreshApps']>>>,
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
