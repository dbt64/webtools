import type { AppEntry, AppSettings, Bookmark, BookmarkFolder, SearchProvider, ToolEntry, WebEntry } from './domain'

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } }

export interface DesktopApi {
  getVersion(): Promise<string>
  getApps(): Promise<AppEntry[]>
  refreshApps(): Promise<AppEntry[]>
  launchApp(id: string): Promise<IpcResult<void>>
  getEntries(): Promise<{ webEntries: WebEntry[]; tools: ToolEntry[] }>
  saveWebEntry(input: Omit<WebEntry, 'id'> & { id?: string }): Promise<IpcResult<WebEntry>>
  deleteWebEntry(id: string): Promise<IpcResult<void>>
  saveToolEntry(input: Omit<ToolEntry, 'id'> & { id?: string }): Promise<IpcResult<ToolEntry>>
  deleteToolEntry(id: string): Promise<IpcResult<void>>
  openWebEntry(id: string): Promise<IpcResult<void>>
  openToolEntry(id: string): Promise<IpcResult<void>>
  getSettings(): Promise<AppSettings>
  updateSettings(settings: Partial<AppSettings>): Promise<IpcResult<AppSettings>>
  openSearch(query: string): Promise<IpcResult<void>>
  listBookmarkFolders(): Promise<BookmarkFolder[]>
  saveBookmarkFolder(input: { id?: string; name: string }): Promise<IpcResult<BookmarkFolder>>
  deleteBookmarkFolder(folderId: string): Promise<IpcResult<void>>
  listBookmarks(folderId: string): Promise<Bookmark[]>
  addBookmark(input: { folderId: string; title?: string; url: string }): Promise<IpcResult<Bookmark>>
  deleteBookmark(bookmarkId: string): Promise<IpcResult<void>>
  moveBookmark(bookmarkId: string, folderId: string): Promise<IpcResult<void>>
  openBookmark(bookmarkId: string): Promise<IpcResult<void>>
  hasAiApiKey(): Promise<boolean>
  saveAiApiKey(apiKey: string): Promise<IpcResult<void>>
  clearAiApiKey(): Promise<IpcResult<void>>
  translateWithAi(input: { text: string; targetLanguage: string }): Promise<IpcResult<{ translation: string }>>
  testAiConnection(): Promise<IpcResult<{ model: string }>>
  openGoogleTranslate(input: { text: string; targetLanguage: string }): Promise<IpcResult<void>>
}

export const IPC_CHANNELS = {
  getVersion: 'app:get-version',
  getApps: 'apps:list',
  refreshApps: 'apps:refresh',
  launchApp: 'apps:launch',
  getEntries: 'entries:list',
  saveWebEntry: 'entries:save-website',
  deleteWebEntry: 'entries:delete-website',
  saveToolEntry: 'entries:save-tool',
  deleteToolEntry: 'entries:delete-tool',
  openWebEntry: 'entries:open-website',
  openToolEntry: 'entries:open-tool',
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  openSearch: 'search:open-web',
  listBookmarkFolders: 'bookmarks:list-folders',
  saveBookmarkFolder: 'bookmarks:save-folder',
  deleteBookmarkFolder: 'bookmarks:delete-folder',
  listBookmarks: 'bookmarks:list',
  addBookmark: 'bookmarks:add',
  deleteBookmark: 'bookmarks:delete',
  moveBookmark: 'bookmarks:move',
  openBookmark: 'bookmarks:open',
  hasAiApiKey: 'ai:has-key',
  saveAiApiKey: 'ai:save-key',
  clearAiApiKey: 'ai:clear-key',
  translateWithAi: 'ai:translate',
  testAiConnection: 'ai:test-connection',
  openGoogleTranslate: 'translate:open-google',
} as const

export type { SearchProvider }
