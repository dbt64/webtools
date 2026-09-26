import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type DesktopApi } from '../src/shared/ipc'

const desktopApi: DesktopApi = {
  showLauncher: () => ipcRenderer.invoke(IPC_CHANNELS.showLauncher) as Promise<void>,
  hideLauncher: () => ipcRenderer.invoke(IPC_CHANNELS.hideLauncher) as Promise<void>,
  setLauncherExpanded: (expanded, expandedSections, hasSearchResults) => ipcRenderer.invoke(IPC_CHANNELS.setLauncherExpanded, expanded, expandedSections, hasSearchResults) as Promise<void>,
  moveLauncherBy: (deltaX, deltaY) => ipcRenderer.send(IPC_CHANNELS.moveLauncherBy, deltaX, deltaY),
  showManager: () => ipcRenderer.invoke(IPC_CHANNELS.showManager) as Promise<void>,
  getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.getVersion) as Promise<string>,
  getApps: () => ipcRenderer.invoke(IPC_CHANNELS.getApps) as Promise<Awaited<ReturnType<DesktopApi['getApps']>>>,
  refreshApps: () => ipcRenderer.invoke(IPC_CHANNELS.refreshApps) as Promise<Awaited<ReturnType<DesktopApi['refreshApps']>>>,
  launchApp: (id) => ipcRenderer.invoke(IPC_CHANNELS.launchApp, id) as ReturnType<DesktopApi['launchApp']>,
  openWebsite: (id) => ipcRenderer.invoke(IPC_CHANNELS.openWebsite, id) as ReturnType<DesktopApi['openWebsite']>,
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getSettings) as ReturnType<DesktopApi['getSettings']>,
  updateSettings: (settings) => ipcRenderer.invoke(IPC_CHANNELS.updateSettings, settings) as ReturnType<DesktopApi['updateSettings']>,
  openSearch: (query) => ipcRenderer.invoke(IPC_CHANNELS.openSearch, query) as ReturnType<DesktopApi['openSearch']>,
  listBookmarkFolders: () => ipcRenderer.invoke(IPC_CHANNELS.listBookmarkFolders) as ReturnType<DesktopApi['listBookmarkFolders']>,
  saveBookmarkFolder: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveBookmarkFolder, input) as ReturnType<DesktopApi['saveBookmarkFolder']>,
  deleteBookmarkFolder: (folderId) => ipcRenderer.invoke(IPC_CHANNELS.deleteBookmarkFolder, folderId) as ReturnType<DesktopApi['deleteBookmarkFolder']>,
  hasAiApiKey: () => ipcRenderer.invoke(IPC_CHANNELS.hasAiApiKey) as ReturnType<DesktopApi['hasAiApiKey']>,
  saveAiApiKey: (apiKey) => ipcRenderer.invoke(IPC_CHANNELS.saveAiApiKey, apiKey) as ReturnType<DesktopApi['saveAiApiKey']>,
  clearAiApiKey: () => ipcRenderer.invoke(IPC_CHANNELS.clearAiApiKey) as ReturnType<DesktopApi['clearAiApiKey']>,
  translateWithAi: (input) => ipcRenderer.invoke(IPC_CHANNELS.translateWithAi, input) as ReturnType<DesktopApi['translateWithAi']>,
  testAiConnection: () => ipcRenderer.invoke(IPC_CHANNELS.testAiConnection) as ReturnType<DesktopApi['testAiConnection']>,
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
