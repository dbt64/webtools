import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type DesktopApi } from '../src/shared/ipc'

const desktopApi: DesktopApi = {
  getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.getVersion) as Promise<string>,
  getApps: () => ipcRenderer.invoke(IPC_CHANNELS.getApps) as Promise<Awaited<ReturnType<DesktopApi['getApps']>>>,
  refreshApps: () => ipcRenderer.invoke(IPC_CHANNELS.refreshApps) as Promise<Awaited<ReturnType<DesktopApi['refreshApps']>>>,
  launchApp: (id) => ipcRenderer.invoke(IPC_CHANNELS.launchApp, id) as ReturnType<DesktopApi['launchApp']>,
  getEntries: () => ipcRenderer.invoke(IPC_CHANNELS.getEntries) as ReturnType<DesktopApi['getEntries']>,
  saveWebEntry: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveWebEntry, input) as ReturnType<DesktopApi['saveWebEntry']>,
  deleteWebEntry: (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteWebEntry, id) as ReturnType<DesktopApi['deleteWebEntry']>,
  saveToolEntry: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveToolEntry, input) as ReturnType<DesktopApi['saveToolEntry']>,
  deleteToolEntry: (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteToolEntry, id) as ReturnType<DesktopApi['deleteToolEntry']>,
  openWebEntry: (id) => ipcRenderer.invoke(IPC_CHANNELS.openWebEntry, id) as ReturnType<DesktopApi['openWebEntry']>,
  openToolEntry: (id) => ipcRenderer.invoke(IPC_CHANNELS.openToolEntry, id) as ReturnType<DesktopApi['openToolEntry']>,
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getSettings) as ReturnType<DesktopApi['getSettings']>,
  updateSettings: (settings) => ipcRenderer.invoke(IPC_CHANNELS.updateSettings, settings) as ReturnType<DesktopApi['updateSettings']>,
  openSearch: (query) => ipcRenderer.invoke(IPC_CHANNELS.openSearch, query) as ReturnType<DesktopApi['openSearch']>,
  listBookmarkFolders: () => ipcRenderer.invoke(IPC_CHANNELS.listBookmarkFolders) as ReturnType<DesktopApi['listBookmarkFolders']>,
  saveBookmarkFolder: (input) => ipcRenderer.invoke(IPC_CHANNELS.saveBookmarkFolder, input) as ReturnType<DesktopApi['saveBookmarkFolder']>,
  deleteBookmarkFolder: (folderId) => ipcRenderer.invoke(IPC_CHANNELS.deleteBookmarkFolder, folderId) as ReturnType<DesktopApi['deleteBookmarkFolder']>,
  listBookmarks: (folderId) => ipcRenderer.invoke(IPC_CHANNELS.listBookmarks, folderId) as ReturnType<DesktopApi['listBookmarks']>,
  addBookmark: (input) => ipcRenderer.invoke(IPC_CHANNELS.addBookmark, input) as ReturnType<DesktopApi['addBookmark']>,
  deleteBookmark: (bookmarkId) => ipcRenderer.invoke(IPC_CHANNELS.deleteBookmark, bookmarkId) as ReturnType<DesktopApi['deleteBookmark']>,
  moveBookmark: (bookmarkId, folderId) => ipcRenderer.invoke(IPC_CHANNELS.moveBookmark, bookmarkId, folderId) as ReturnType<DesktopApi['moveBookmark']>,
  openBookmark: (bookmarkId) => ipcRenderer.invoke(IPC_CHANNELS.openBookmark, bookmarkId) as ReturnType<DesktopApi['openBookmark']>,
  hasAiApiKey: () => ipcRenderer.invoke(IPC_CHANNELS.hasAiApiKey) as ReturnType<DesktopApi['hasAiApiKey']>,
  saveAiApiKey: (apiKey) => ipcRenderer.invoke(IPC_CHANNELS.saveAiApiKey, apiKey) as ReturnType<DesktopApi['saveAiApiKey']>,
  clearAiApiKey: () => ipcRenderer.invoke(IPC_CHANNELS.clearAiApiKey) as ReturnType<DesktopApi['clearAiApiKey']>,
  translateWithAi: (input) => ipcRenderer.invoke(IPC_CHANNELS.translateWithAi, input) as ReturnType<DesktopApi['translateWithAi']>,
  testAiConnection: () => ipcRenderer.invoke(IPC_CHANNELS.testAiConnection) as ReturnType<DesktopApi['testAiConnection']>,
  openGoogleTranslate: (input) => ipcRenderer.invoke(IPC_CHANNELS.openGoogleTranslate, input) as ReturnType<DesktopApi['openGoogleTranslate']>,
}

contextBridge.exposeInMainWorld('desktop', desktopApi)
