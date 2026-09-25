import type { SearchProvider } from './domain'

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } }

export interface DesktopApi {
  getVersion(): Promise<string>
}

export const IPC_CHANNELS = {
  getVersion: 'app:get-version',
} as const

export type { SearchProvider }
