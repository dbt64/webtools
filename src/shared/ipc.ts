import type { AppSettings, BookmarkFolder, WebsiteCollection, WebsiteEntry, WebsiteOrderByCollection, WebsiteSaveInput, EverythingResult, ThemePreference } from './domain'
import type { AIProviderId } from './ai-config.ts'
import type { TranslationProviderInfo, TranslationRequest, TranslationResult } from './translation-contracts.ts'
import type { PluginApi } from './plugin-contracts.ts'
import type { PluginCatalogApi } from './plugin-catalog-contracts.ts'
import type { BuiltinTranslationHandoffProjection, ResolveTranslationHandoffRequest } from './builtin-translation-contracts.ts'

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
  pluginCatalog: PluginCatalogApi
  plugins: PluginApi
  builtinTranslationHandoff: {
    get(): Promise<IpcResult<BuiltinTranslationHandoffProjection>>
    resolve(request: ResolveTranslationHandoffRequest): Promise<IpcResult<BuiltinTranslationHandoffProjection>>
  }
  managerReady(): void
  onNativeManagerIntent(handler: (intent: NativeManagerIntent) => void): () => void
  acknowledgeNativeManagerIntent(requestId: string): void
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
  getTranslationProviderInfo(): Promise<IpcResult<TranslationProviderInfo>>
  translate(request: TranslationRequest): Promise<IpcResult<TranslationResult>>
  cancelTranslation(requestId: string): Promise<IpcResult<{ cancelled: boolean }>>
  testAIConnection(): Promise<IpcResult<{ providerName: string; model: string }>>
  openGoogleTranslate(input: { text: string; targetLanguage: string }): Promise<IpcResult<void>>
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
}

export type NativeManagerIntent =
  | { requestId: string; kind: 'open-plugin'; ref: import('./plugin-catalog-contracts.ts').PluginRef }
  | { requestId: string; kind: 'open-page'; section: 'favorites' | 'entries' | 'settings' }
  | { requestId: string; kind: 'translation-handoff' }

export const IPC_CHANNELS = {
  pluginCatalogList: 'plugin-catalog:list',
  pluginCatalogOpen: 'plugin-catalog:open',
  pluginCatalogSetEnabled: 'plugin-catalog:set-enabled',
  pluginCatalogRecoverBuiltin: 'plugin-catalog:recover-builtin-translation',
  builtinTranslationHandoffGet: 'builtin-translation-handoff:get',
  builtinTranslationHandoffResolve: 'builtin-translation-handoff:resolve',
  pluginList: 'plugins:list',
  pluginInstall: 'plugins:install-from-dialog',
  pluginSetEnabled: 'plugins:set-enabled',
  pluginSetGrants: 'plugins:set-grants',
  pluginGetPages: 'plugins:get-pages',
  pluginInvoke: 'plugins:invoke',
  pluginAIReviewPrepare: 'plugins:ai-review-prepare',
  pluginAIReviewConfirm: 'plugins:ai-review-confirm',
  pluginAIReviewCancel: 'plugins:ai-review-cancel',
  pluginUninstall: 'plugins:uninstall',
  managerReady: 'window:manager-ready',
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
  getTranslationProviderInfo: 'translate:provider-info',
  translate: 'translate:run',
  cancelTranslation: 'translate:cancel',
  testAIConnection: 'ai:test-connection',
  openGoogleTranslate: 'translate:open-google',
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
} as const
