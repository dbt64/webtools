import type { AppSearchEntry, AppSettings, BookmarkFolder, WebsiteEntry, WebsiteSaveInput, EverythingResult, TranslationPrefillRequest, ThemePreference, LauncherDataChanges, LauncherDataVersions } from './domain'
import type { AIProviderId } from './ai-config.ts'
import type { TranslationProviderInfo, TranslationRequest, TranslationResult } from './translation-contracts.ts'
import type { LauncherVisibilityEvent } from './launcher-visibility.ts'

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
  showLauncher(): Promise<void>
  launcherReady(): void
  onLauncherVisibility(handler: (event: LauncherVisibilityEvent) => void): () => void
  acknowledgeLauncherVisibility(generation: number): void
  hideLauncher(): Promise<void>
  setLauncherExpanded(expanded: boolean, expandedSectionExtraHeight?: number, hasSearchResults?: boolean, generation?: number): Promise<void>
  moveLauncherBy(deltaX: number, deltaY: number): void
  showManager(): Promise<void>
  openTranslation(text: string): Promise<IpcResult<void>>
  managerReady(): void
  onTranslationPrefill(handler: (request: TranslationPrefillRequest) => void): () => void
  acknowledgeTranslationPrefill(id: string): void
  onNativeManagerIntent(handler: (intent: NativeManagerIntent) => void): () => void
  acknowledgeNativeManagerIntent(requestId: string): void
  getVersion(): Promise<string>
  getApps(): Promise<AppSearchEntry[]>
  getLauncherData(knownVersions: LauncherDataVersions): Promise<LauncherDataChanges>
  getWebsiteIcons(ids: string[]): Promise<Record<string, string | null>>
  refreshApps(): Promise<AppSearchEntry[]>
  onAppsCatalogUpdated(handler: () => void): () => void
  getAppIcon(id: string): Promise<IpcResult<{ dataUrl: string | null }>>
  launchApp(id: string): Promise<IpcResult<void>>
  getRememberedAppSearchAppId(query: string): Promise<string | null>
  rememberAppSearchResult(query: string, appId: string): Promise<IpcResult<void>>
  openWebsite(id: string): Promise<IpcResult<void>>
  getSettings(): Promise<AppSettings>
  getThemePreference(): Promise<ThemePreference>
  updateSettings(settings: Partial<AppSettings>): Promise<IpcResult<AppSettings>>
  openSearch(query: string): Promise<IpcResult<void>>
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
  fetchWebsiteMetadata(url: string): Promise<IpcResult<{ title?: string; favicon?: string }>>
  searchEverything(query: string): Promise<IpcResult<EverythingResult[]>>
  openEverythingResult(id: string): Promise<IpcResult<void>>
  detectEverything(): Promise<{ executablePath?: string; running: boolean; version?: string }>
  chooseEverythingPath(): Promise<string | null>
}

export type NativeManagerIntent =
  | { requestId: string; kind: 'open-page'; section: 'search' | 'entries' | 'settings' | 'translate' }
  | { requestId: string; kind: 'translation-prefill'; text: string }

export const IPC_CHANNELS = {
  showLauncher: 'window:show-launcher',
  launcherReady: 'window:launcher-ready',
  launcherVisibility: 'window:launcher-visibility',
  acknowledgeLauncherVisibility: 'window:acknowledge-launcher-visibility',
  hideLauncher: 'window:hide-launcher',
  setLauncherExpanded: 'window:set-launcher-expanded',
  moveLauncherBy: 'window:move-launcher-by',
  showManager: 'window:show-manager',
  openTranslation: 'window:open-translation',
  managerReady: 'window:manager-ready',
  translationPrefill: 'window:translation-prefill',
  acknowledgeTranslationPrefill: 'window:acknowledge-translation-prefill',
  nativeManagerIntent: 'native-manager:intent',
  acknowledgeNativeManagerIntent: 'native-manager:acknowledge-intent',
  getVersion: 'app:get-version',
  getApps: 'apps:list',
  getLauncherData: 'launcher:get-data',
  getWebsiteIcons: 'websites:get-icons',
  refreshApps: 'apps:refresh',
  appsCatalogUpdated: 'apps:catalog-updated',
  getAppIcon: 'apps:get-icon',
  launchApp: 'apps:launch',
  getRememberedAppSearchAppId: 'apps:get-remembered-search-result',
  rememberAppSearchResult: 'apps:remember-search-result',
  openWebsite: 'websites:open',
  getSettings: 'settings:get',
  getThemePreference: 'settings:get-theme',
  updateSettings: 'settings:update',
  openSearch: 'search:open-web',
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
  fetchWebsiteMetadata: 'websites:fetch-metadata',
  searchEverything: 'everything:search',
  openEverythingResult: 'everything:open',
  detectEverything: 'everything:detect',
  chooseEverythingPath: 'everything:choose-path',
} as const
