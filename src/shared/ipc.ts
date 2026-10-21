import type { AppSettings, BookmarkFolder, WebsiteCollection, WebsiteEntry, WebsiteOrderByCollection, WebsiteSaveInput, EverythingResult, ThemePreference } from './domain'
import type { AIProviderId } from './ai-config.ts'
import type { TranslationProviderInfo, TranslationRequest, TranslationResult } from './translation-contracts.ts'
import type { PluginApi } from './plugin-contracts.ts'
import type { PluginCatalogApi } from './plugin-catalog-contracts.ts'
import type { PluginDevelopmentApi } from './plugin-development-contracts.ts'
import type { SuperPanelSettings, SuperPanelSettingsStatus } from './super-panel-settings.ts'

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } }

export interface AIProviderDescriptor {
  id: AIProviderId
  name: string
  defaultModel: string
  documentationUrl: string
  modelHint: string
  requiresQwenWorkspace: boolean
}

export interface AIProviderStatus {
  providerId: AIProviderId
  providerName: string
  model: string
  hasApiKey: boolean
  configured: boolean
  documentationUrl: string
  requiresQwenWorkspace: boolean
}

export interface DesktopApi {
  superPanel: {
    get(): Promise<IpcResult<SuperPanelSettingsStatus>>
    update(settings: SuperPanelSettings): Promise<IpcResult<SuperPanelSettingsStatus>>
    onChanged(handler: (status: SuperPanelSettingsStatus) => void): () => void
  }
  pluginCatalog: PluginCatalogApi
  plugins: PluginApi
  pluginDevelopment: PluginDevelopmentApi

  managerReady(): void
  managerWindow: {
    perform(action: ManagerWindowAction): Promise<IpcResult<{ maximized: boolean }>>
  }
  onNativeManagerIntent(handler: (intent: NativeManagerIntent) => void): () => void
  acknowledgeNativeManagerIntent(requestId: string, outcome?: 'accepted' | 'rejected'): void
  getVersion(): Promise<string>
  openWebsite(id: string): Promise<IpcResult<void>>
  getSettings(): Promise<AppSettings>
  getThemePreference(): Promise<ThemePreference>
  updateSettings(settings: Partial<AppSettings>): Promise<IpcResult<AppSettings>>
  listBookmarkFolders(): Promise<BookmarkFolder[]>
  saveBookmarkFolder(input: { id?: string; name: string }): Promise<IpcResult<BookmarkFolder>>
  deleteBookmarkFolder(folderId: string): Promise<IpcResult<void>>
  getAIProviderDescriptors(): Promise<IpcResult<AIProviderDescriptor[]>>
  getAIProviderStatus(providerId: AIProviderId): Promise<IpcResult<AIProviderStatus>>
  saveAIProviderKey(providerId: AIProviderId, apiKey: string): Promise<IpcResult<void>>
  clearAIProviderKey(providerId: AIProviderId): Promise<IpcResult<void>>
  getQwenRegions(): Promise<IpcResult<Array<{ id: string; label: string }>>>
  testAIConnection(providerId?: AIProviderId): Promise<IpcResult<{ providerName: string; model: string }>>
  listWebsites(folderId?: string): Promise<WebsiteEntry[]>
  saveWebsite(input: WebsiteSaveInput): Promise<IpcResult<WebsiteEntry>>
  deleteWebsite(id: string): Promise<IpcResult<void>>
  addWebsiteToFolders(id: string, folderIds: string[]): Promise<IpcResult<WebsiteEntry>>
  getWebsiteOrder(): Promise<WebsiteOrderByCollection>
  reorderWebsites(collection: WebsiteCollection, orderedIds: string[]): Promise<IpcResult<WebsiteOrderByCollection>>
  fetchWebsiteMetadata(url: string): Promise<IpcResult<{ title?: string; favicon?: string }>>
  searchEverything(query: string): Promise<IpcResult<EverythingResult[]>>
  openEverythingResult(id: string): Promise<IpcResult<void>>
  detectEverything(): Promise<{ executablePath?: string; running: boolean; version?: string }>
  chooseEverythingPath(): Promise<string | null>
  webRuntime: {
    setBounds(bounds: { x: number; y: number; width: number; height: number }): void
    close(generation: number): void
    onState(handler: (state: { state: string; featureId?: string; pluginId?: string; pluginName?: string; errorCode?: string; generation: number }) => void): () => void
  }
}

export type ManagerWindowAction = 'minimize' | 'toggle-maximize' | 'close'

export type NativeManagerIntent =
  | { requestId: string; kind: 'open-plugin'; ref: import('./plugin-catalog-contracts.ts').PluginRef }
  | { requestId: string; kind: 'select-plugin'; ref: import('./plugin-catalog-contracts.ts').PluginRef; section?: 'about' | 'settings' }
  | { requestId: string; kind: 'open-feature'; ref: import('./feature-contracts.ts').FeatureRef }
  | { requestId: string; kind: 'open-page'; section: 'favorites' | 'entries' | 'settings'; settingsSection?: 'super-panel' }

export const IPC_CHANNELS = {
  superPanelGet: 'settings:super-panel-get',
  superPanelUpdate: 'settings:super-panel-update',
  superPanelChanged: 'settings:super-panel-changed',
  pluginDevelopmentGet: 'plugin-development:get',
  pluginDevelopmentSetEnabled: 'plugin-development:set-enabled',
  pluginDevelopmentConnect: 'plugin-development:connect-project',
  pluginDevelopmentDisconnect: 'plugin-development:disconnect',
  pluginDevelopmentOpen: 'plugin-development:open-feature',
  pluginDevelopmentCopy: 'plugin-development:copy-diagnostics',
  pluginDevelopmentChanged: 'plugin-development:changed',
  pluginCatalogList: 'plugin-catalog:list',
  pluginCatalogOpen: 'plugin-catalog:open',
  pluginCatalogSetEnabled: 'plugin-catalog:set-enabled',
  pluginCatalogRecoverBuiltin: 'plugin-catalog:recover-builtin-translation',
  pluginList: 'plugins:list',
  pluginInstall: 'plugins:install-from-dialog',
  pluginSetEnabled: 'plugins:set-enabled',
  pluginStopRuntime: 'plugins:stop-runtime',
  pluginSetGrants: 'plugins:set-grants',
  pluginGetPages: 'plugins:get-pages',
  pluginConfigurationGet: 'plugins:configuration-get',
  pluginConfigurationUpdate: 'plugins:configuration-update',
  pluginConfigurationReset: 'plugins:configuration-reset',
  pluginInvoke: 'plugins:invoke',
  pluginAIReviewPrepare: 'plugins:ai-review-prepare',
  pluginAIReviewConfirm: 'plugins:ai-review-confirm',
  pluginAIReviewCancel: 'plugins:ai-review-cancel',
  pluginUninstall: 'plugins:uninstall',
  managerReady: 'window:manager-ready',
  managerWindowAction: 'window:manager-action',
  nativeManagerIntent: 'native-manager:intent',
  acknowledgeNativeManagerIntent: 'native-manager:acknowledge-intent',
  getVersion: 'app:get-version',
  openWebsite: 'websites:open',
  getSettings: 'settings:get',
  getThemePreference: 'settings:get-theme',
  updateSettings: 'settings:update',
  listBookmarkFolders: 'bookmarks:list-folders',
  saveBookmarkFolder: 'bookmarks:save-folder',
  deleteBookmarkFolder: 'bookmarks:delete-folder',
  getAIProviderDescriptors: 'ai:list-providers',
  getAIProviderStatus: 'ai:provider-status',
  saveAIProviderKey: 'ai:save-provider-key',
  clearAIProviderKey: 'ai:clear-provider-key',
  getQwenRegions: 'ai:qwen-regions',
  testAIConnection: 'ai:test-connection',
  listWebsites: 'websites:list',
  saveWebsite: 'websites:save',
  deleteWebsite: 'websites:delete',
  addWebsiteToFolders: 'websites:add-to-folders',
  getWebsiteOrder: 'websites:get-order',
  reorderWebsites: 'websites:reorder',
  fetchWebsiteMetadata: 'websites:fetch-metadata',
  searchEverything: 'everything:search',
  openEverythingResult: 'everything:open',
  detectEverything: 'everything:detect',
  chooseEverythingPath: 'everything:choose-path',
  webRuntimeSetBounds: 'web-runtime:set-bounds',
  webRuntimeClose: 'web-runtime:close',
  webRuntimeState: 'web-runtime:state',
} as const
