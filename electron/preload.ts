import { contextBridge, ipcRenderer } from 'electron'
import { parseNativeManagerIntent } from '../src/shared/native-manager-intent'
import { IPC_CHANNELS, type DesktopApi } from '../src/shared/ipc'
import { parseSuperPanelSettingsStatus } from '../src/shared/super-panel-settings.ts'

const desktopApi: DesktopApi = {
  superPanel: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.superPanelGet),
    update: settings => ipcRenderer.invoke(IPC_CHANNELS.superPanelUpdate, settings),
    onChanged: handler => {
      const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
        const status = parseSuperPanelSettingsStatus(value)
        if (status) handler(status)
      }
      ipcRenderer.on(IPC_CHANNELS.superPanelChanged, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.superPanelChanged, listener)
    },
  },
  pluginDevelopment: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.pluginDevelopmentGet),
    setEnabled: enabled => ipcRenderer.invoke(IPC_CHANNELS.pluginDevelopmentSetEnabled, enabled),
    connectFromDialog: () => ipcRenderer.invoke(IPC_CHANNELS.pluginDevelopmentConnect),
    disconnect: () => ipcRenderer.invoke(IPC_CHANNELS.pluginDevelopmentDisconnect),
    openFeature: featureId => ipcRenderer.invoke(IPC_CHANNELS.pluginDevelopmentOpen, featureId),
    copyDiagnostics: (pluginId, featureId) => ipcRenderer.invoke(IPC_CHANNELS.pluginDevelopmentCopy, pluginId, featureId),
    onChanged: handler => {
      const listener = (_event: Electron.IpcRendererEvent, value: Parameters<typeof handler>[0]) => handler(value)
      ipcRenderer.on(IPC_CHANNELS.pluginDevelopmentChanged, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.pluginDevelopmentChanged, listener)
    },
  },
  pluginCatalog: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.pluginCatalogList),
    open: (ref) => ipcRenderer.invoke(IPC_CHANNELS.pluginCatalogOpen, ref),
    setEnabled: (ref, enabled) => ipcRenderer.invoke(IPC_CHANNELS.pluginCatalogSetEnabled, ref, enabled),
    recoverBuiltinTranslation: () => ipcRenderer.invoke(IPC_CHANNELS.pluginCatalogRecoverBuiltin),
  },

  plugins: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.pluginList),
    installFromUserDialog: () => ipcRenderer.invoke(IPC_CHANNELS.pluginInstall),
    setEnabled: (id, enabled) => ipcRenderer.invoke(IPC_CHANNELS.pluginSetEnabled, id, enabled),
    stopRuntime: id => ipcRenderer.invoke(IPC_CHANNELS.pluginStopRuntime, id),
    setGrants: (id, grants) => ipcRenderer.invoke(IPC_CHANNELS.pluginSetGrants, id, grants),
    getPages: (id) => ipcRenderer.invoke(IPC_CHANNELS.pluginGetPages, id),
    getConfiguration: identity => ipcRenderer.invoke(IPC_CHANNELS.pluginConfigurationGet, identity),
    updateConfiguration: request => ipcRenderer.invoke(IPC_CHANNELS.pluginConfigurationUpdate, request),
    resetConfiguration: request => ipcRenderer.invoke(IPC_CHANNELS.pluginConfigurationReset, request),
    invoke: (request) => ipcRenderer.invoke(IPC_CHANNELS.pluginInvoke, request),
    prepareAIReview: (request) => ipcRenderer.invoke(IPC_CHANNELS.pluginAIReviewPrepare, request),
    confirmAIReview: (reviewId) => ipcRenderer.invoke(IPC_CHANNELS.pluginAIReviewConfirm, reviewId),
    cancelAIReview: (reviewId) => ipcRenderer.invoke(IPC_CHANNELS.pluginAIReviewCancel, reviewId),
    uninstall: (id) => ipcRenderer.invoke(IPC_CHANNELS.pluginUninstall, id),
  },
  managerReady: () => ipcRenderer.send(IPC_CHANNELS.managerReady),
  managerWindow: {
    perform: action => ipcRenderer.invoke(IPC_CHANNELS.managerWindowAction, action),
  },
  onNativeManagerIntent: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const intent = parseNativeManagerIntent(value)
      if (intent) handler(intent)
    }
    ipcRenderer.on(IPC_CHANNELS.nativeManagerIntent, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.nativeManagerIntent, listener)
  },
  acknowledgeNativeManagerIntent: (requestId, outcome) => ipcRenderer.send(IPC_CHANNELS.acknowledgeNativeManagerIntent, requestId, outcome),
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
  testAIConnection: (providerId) => ipcRenderer.invoke(IPC_CHANNELS.testAIConnection, providerId) as ReturnType<DesktopApi['testAIConnection']>,
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
  webRuntime: {
    setBounds: (bounds) => ipcRenderer.send(IPC_CHANNELS.webRuntimeSetBounds, bounds),
    close: (generation) => ipcRenderer.send(IPC_CHANNELS.webRuntimeClose, generation),
    onState: handler => {
      const listener = (_event: Electron.IpcRendererEvent, value: unknown): void => {
        if (!value || typeof value !== 'object' || !('state' in value) || typeof value.state !== 'string'
          || !('generation' in value) || typeof value.generation !== 'number') return
        handler(value as Parameters<typeof handler>[0])
      }
      ipcRenderer.on(IPC_CHANNELS.webRuntimeState, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.webRuntimeState, listener)
    },
  },
}

contextBridge.exposeInMainWorld('desktop', desktopApi)
