import type { AppSearchEntry, AppSettings, BookmarkFolder, WebsiteEntry } from './domain'

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } }

export interface DesktopApi {
  showLauncher(): Promise<void>
  hideLauncher(): Promise<void>
  setLauncherExpanded(expanded: boolean): Promise<void>
  showManager(): Promise<void>
  getVersion(): Promise<string>
  getApps(): Promise<AppSearchEntry[]>
  refreshApps(): Promise<AppSearchEntry[]>
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
  saveWebsite(input: Omit<WebsiteEntry, 'id' | 'createdAt' | 'favicon' | 'folderIds'> & { id?: string }): Promise<IpcResult<WebsiteEntry>>
  deleteWebsite(id: string): Promise<IpcResult<void>>
  addWebsiteToFolders(id: string, folderIds: string[]): Promise<IpcResult<WebsiteEntry>>
  fetchWebsiteMetadata(url: string): Promise<IpcResult<{ title?: string; favicon?: string }>>
  cacheWebsiteMetadata(id: string, metadata: { title?: string; favicon?: string }): Promise<IpcResult<WebsiteEntry>>
  searchEverything(query: string): Promise<IpcResult<import('./domain').EverythingResult[]>>
  openEverythingResult(id: string): Promise<IpcResult<void>>
}

export const IPC_CHANNELS = {
  showLauncher: 'window:show-launcher',
  hideLauncher: 'window:hide-launcher',
  setLauncherExpanded: 'window:set-launcher-expanded',
  showManager: 'window:show-manager',
  getVersion: 'app:get-version',
  getApps: 'apps:list',
  refreshApps: 'apps:refresh',
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
  cacheWebsiteMetadata: 'websites:cache-metadata',
  searchEverything: 'everything:search',
  openEverythingResult: 'everything:open',
} as const
