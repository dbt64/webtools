import type { AppSearchEntry, AppSettings, BookmarkFolder, WebsiteEntry, WebsiteSaveInput, EverythingResult, TranslationPrefillRequest } from './domain'

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } }

export interface DesktopApi {
  showLauncher(): Promise<void>
  launcherReady(): void
  hideLauncher(): Promise<void>
  setLauncherExpanded(expanded: boolean, expandedSectionExtraHeight?: number, hasSearchResults?: boolean): Promise<void>
  moveLauncherBy(deltaX: number, deltaY: number): void
  showManager(): Promise<void>
  openTranslation(text: string): Promise<IpcResult<void>>
  managerReady(): void
  onTranslationPrefill(handler: (request: TranslationPrefillRequest) => void): () => void
  acknowledgeTranslationPrefill(id: string): void
  getVersion(): Promise<string>
  getApps(): Promise<AppSearchEntry[]>
  refreshApps(): Promise<AppSearchEntry[]>
  getAppIcon(id: string): Promise<IpcResult<{ dataUrl: string | null }>>
  launchApp(id: string): Promise<IpcResult<void>>
  openWebsite(id: string): Promise<IpcResult<void>>
  getSettings(): Promise<AppSettings>
  updateSettings(settings: Partial<AppSettings>): Promise<IpcResult<AppSettings>>
  openSearch(query: string): Promise<IpcResult<void>>
  listBookmarkFolders(): Promise<BookmarkFolder[]>
  saveBookmarkFolder(input: { id?: string; name: string }): Promise<IpcResult<BookmarkFolder>>
  deleteBookmarkFolder(folderId: string): Promise<IpcResult<void>>
  hasAiApiKey(): Promise<boolean>
  saveAiApiKey(apiKey: string): Promise<IpcResult<void>>
  clearAiApiKey(): Promise<IpcResult<void>>
  translateWithAi(input: { text: string; targetLanguage: string }): Promise<IpcResult<{ translation: string }>>
  testAiConnection(): Promise<IpcResult<{ model: string }>>
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

export const IPC_CHANNELS = {
  showLauncher: 'window:show-launcher',
  launcherReady: 'window:launcher-ready',
  hideLauncher: 'window:hide-launcher',
  setLauncherExpanded: 'window:set-launcher-expanded',
  moveLauncherBy: 'window:move-launcher-by',
  showManager: 'window:show-manager',
  openTranslation: 'window:open-translation',
  managerReady: 'window:manager-ready',
  translationPrefill: 'window:translation-prefill',
  acknowledgeTranslationPrefill: 'window:acknowledge-translation-prefill',
  getVersion: 'app:get-version',
  getApps: 'apps:list',
  refreshApps: 'apps:refresh',
  getAppIcon: 'apps:get-icon',
  launchApp: 'apps:launch',
  openWebsite: 'websites:open',
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  openSearch: 'search:open-web',
  listBookmarkFolders: 'bookmarks:list-folders',
  saveBookmarkFolder: 'bookmarks:save-folder',
  deleteBookmarkFolder: 'bookmarks:delete-folder',
  hasAiApiKey: 'ai:has-key',
  saveAiApiKey: 'ai:save-key',
  clearAiApiKey: 'ai:clear-key',
  translateWithAi: 'ai:translate',
  testAiConnection: 'ai:test-connection',
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
