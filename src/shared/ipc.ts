import type { AppEntry, AppSettings, SearchProvider, ToolEntry, WebEntry } from './domain'

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
} as const

export type { SearchProvider }
