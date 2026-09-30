import { createDefaultSharedAISettings, type SharedAISettings } from './ai-config.ts'
import { createDefaultTranslationSettings, type TranslationSettings } from './translation-contracts.ts'

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

/** Reduced website data projected from Manager to the Native Launcher. */
export interface WebsiteSearchEntry {
  id: string
  name: string
  url: string
  description?: string
  folderIds: string[]
}

export interface WebsiteSaveInput {
  id?: string
  name: string
  url: string
  description?: string
  favicon?: string
  folderIds: string[]
}

export type WebsiteCollection =
  | { kind: 'unclassified' }
  | { kind: 'folder'; folderId: string }

export interface WebsiteOrderByCollection {
  unclassified: string[]
  folders: Record<string, string[]>
}

export interface SearchEngine {
  id: string
  name: string
  template: string
  builtIn: boolean
  enabled: boolean
  order: number
}

export interface EverythingResult { id: string; name: string; locationLabel: string; kind: 'file' | 'folder' }
export interface TranslationPrefillRequest { id: string; text: string }
export interface AppSearchMemoryEntry { appId: string; lastUsedAt: number }
export type AppSearchMemory = Record<string, AppSearchMemoryEntry>

export type ThemePreference = 'light' | 'dark' | 'system'
export type LauncherDisplayMode = 'compact' | 'expanded'

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
  sharedAI: SharedAISettings
  translation: TranslationSettings
  theme: ThemePreference
  launcherDisplayMode: LauncherDisplayMode
}

export interface AppData {
  version: 2
  webEntries: WebsiteEntry[]
  bookmarkFolders: BookmarkFolder[]
  websiteOrderByCollection: WebsiteOrderByCollection
  settings: AppSettings
  appSearchMemory: AppSearchMemory
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
  websiteOrderByCollection: { unclassified: [], folders: {} },
  appSearchMemory: {},
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
    sharedAI: createDefaultSharedAISettings(),
    translation: createDefaultTranslationSettings(),
    theme: 'dark',
    launcherDisplayMode: 'compact',
  },
}

export function createDefaultAppData(): AppData { return structuredClone(DEFAULT_APP_DATA) }
