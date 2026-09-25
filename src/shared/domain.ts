export type SearchProvider = 'google' | 'baidu' | 'bilibili'

export interface BookmarkFolder { id: string; name: string; createdAt: number }

export interface WebsiteEntry {
  id: string
  name: string
  url: string
  description?: string
  favicon?: string
  folderIds: string[]
  createdAt: number
}

export interface SearchEngine {
  id: string
  name: string
  template: string
  builtIn: boolean
  enabled: boolean
  order: number
}

export interface AppSearchEntry { id: string; name: string; aliases: string[]; source: 'desktop' | 'packaged'; icon?: string }
export interface EverythingResult { id: string; name: string; locationLabel: string; kind: 'file' | 'folder' }

export interface AppSettings {
  searchEngines: SearchEngine[]
  defaultSearchEngineId: string
  quickSearchShortcut: string
  launchOnStartup: boolean
  websiteLayout: 'grid' | 'list'
  everythingEnabled: boolean
  everythingEsPath: string
  aiBaseUrl: string
  aiModel: string
  // Transitional renderer compatibility; removed after settings UI migration.
  defaultSearchProvider: SearchProvider
}

export interface AppData {
  version: 2
  webEntries: WebsiteEntry[]
  bookmarkFolders: BookmarkFolder[]
  settings: AppSettings
}

export const DEFAULT_SEARCH_ENGINES: SearchEngine[] = [
  { id: 'google', name: 'Google', template: 'https://www.google.com/search?q=%s', builtIn: true, enabled: true, order: 0 },
  { id: 'baidu', name: '百度', template: 'https://www.baidu.com/s?wd=%s', builtIn: true, enabled: true, order: 1 },
  { id: 'bilibili', name: 'Bilibili', template: 'https://search.bilibili.com/all?keyword=%s', builtIn: true, enabled: true, order: 2 },
]

export const DEFAULT_APP_DATA: AppData = {
  version: 2,
  webEntries: [],
  bookmarkFolders: [],
  settings: {
    searchEngines: DEFAULT_SEARCH_ENGINES,
    defaultSearchEngineId: 'google',
    quickSearchShortcut: 'Control+Alt+Space',
    launchOnStartup: false,
    websiteLayout: 'grid',
    everythingEnabled: false,
    everythingEsPath: '',
    aiBaseUrl: '',
    aiModel: '',
    defaultSearchProvider: 'google',
  },
}

export function createDefaultAppData(): AppData { return structuredClone(DEFAULT_APP_DATA) }
