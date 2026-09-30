import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type DesktopApi } from '../src/shared/ipc'

const desktopApi: DesktopApi = {
  managerReady: () => ipcRenderer.send(IPC_CHANNELS.managerReady),
  onNativeManagerIntent: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return
      const intent = value as Record<string, unknown>
      if (typeof intent.requestId !== 'string' || intent.requestId.length === 0 || intent.requestId.length > 128) return
      if (intent.kind === 'open-page'
        && (intent.section === 'favorites' || intent.section === 'entries' || intent.section === 'settings' || intent.section === 'translate')) {
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
  openWebsite: (id) => ipcRenderer.invoke(IPC_CHANNELS.openWebsite, id) as ReturnType<DesktopApi['openWebsite']>,
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getSettings) as ReturnType<DesktopApi['getSettings']>,
  getThemePreference: () => ipcRenderer.invoke(IPC_CHANNELS.getThemePreference) as ReturnType<DesktopApi['getThemePreference']>,
  updateSettings: (settings) => ipcRenderer.invoke(IPC_CHANNELS.updateSettings, settings) as ReturnType<DesktopApi['updateSettings']>,
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
  getWebsiteOrder: () => ipcRenderer.invoke(IPC_CHANNELS.getWebsiteOrder) as ReturnType<DesktopApi['getWebsiteOrder']>,
  reorderWebsites: (collection, orderedIds) => ipcRenderer.invoke(IPC_CHANNELS.reorderWebsites, collection, orderedIds) as ReturnType<DesktopApi['reorderWebsites']>,
  fetchWebsiteMetadata: (url) => ipcRenderer.invoke(IPC_CHANNELS.fetchWebsiteMetadata, url) as ReturnType<DesktopApi['fetchWebsiteMetadata']>,
  searchEverything: (query) => ipcRenderer.invoke(IPC_CHANNELS.searchEverything, query) as ReturnType<DesktopApi['searchEverything']>,
  openEverythingResult: (id) => ipcRenderer.invoke(IPC_CHANNELS.openEverythingResult, id) as ReturnType<DesktopApi['openEverythingResult']>,
  detectEverything: () => ipcRenderer.invoke(IPC_CHANNELS.detectEverything) as ReturnType<DesktopApi['detectEverything']>,
  chooseEverythingPath: () => ipcRenderer.invoke(IPC_CHANNELS.chooseEverythingPath) as ReturnType<DesktopApi['chooseEverythingPath']>,
}

contextBridge.exposeInMainWorld('desktop', desktopApi)
