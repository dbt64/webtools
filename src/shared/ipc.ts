import type { AppEntry, SearchProvider } from './domain'

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } }

export interface DesktopApi {
  getVersion(): Promise<string>
  getApps(): Promise<AppEntry[]>
  refreshApps(): Promise<AppEntry[]>
  launchApp(id: string): Promise<IpcResult<void>>
}

export const IPC_CHANNELS = {
  getVersion: 'app:get-version',
  getApps: 'apps:list',
  refreshApps: 'apps:refresh',
  launchApp: 'apps:launch',
} as const

export type { SearchProvider }
