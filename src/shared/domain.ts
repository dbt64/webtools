export type SearchProvider = 'google' | 'baidu' | 'bilibili'

export interface AppEntry {
  id: string
  name: string
  targetPath: string
  sourcePath: string
}

export interface WebEntry {
  id: string
  name: string
  url: string
  description?: string
}

export interface ToolEntry {
  id: string
  name: string
  command: string
  description?: string
}

export interface BookmarkFolder {
  id: string
  name: string
  createdAt: number
}

export interface Bookmark {
  id: string
  folderId: string
  title: string
  url: string
  favicon?: string
  createdAt: number
}

export interface AppSettings {
  defaultSearchProvider: SearchProvider
  aiBaseUrl: string
  aiModel: string
}

export interface AppData {
  version: 1
  webEntries: WebEntry[]
  tools: ToolEntry[]
  bookmarkFolders: BookmarkFolder[]
  bookmarks: Bookmark[]
  settings: AppSettings
}

export const DEFAULT_APP_DATA: AppData = {
  version: 1,
  webEntries: [],
  tools: [],
  bookmarkFolders: [],
  bookmarks: [],
  settings: {
    defaultSearchProvider: 'google',
    aiBaseUrl: '',
    aiModel: '',
  },
}

export function createDefaultAppData(): AppData {
  return structuredClone(DEFAULT_APP_DATA)
}
