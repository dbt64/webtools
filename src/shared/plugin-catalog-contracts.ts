import type { IpcResult } from './ipc.ts'
import type { PluginPageDTO, PluginSummary } from './plugin-contracts.ts'

/** Host-internal presentation contract; never a package manifest or author SDK. */
export type PluginRef = { kind: 'builtin'; id: 'webtools.translation' } | { kind: 'declarative'; id: string }
export type PluginIcon = { kind: 'host'; key: 'translation' } | { kind: 'png'; dataUrl: string } | { kind: 'fallback' }
export type BuiltinPluginStateDTO =
  | { status: 'ready'; enabled: true }
  | { status: 'disabled'; enabled: false }
  | { status: 'enabling' | 'stopping'; enabled: false; targetEnabled: boolean }
  | { status: 'faulted'; enabled: false; errorCode: string; retryEnabled: boolean }
  | { status: 'unavailable'; enabled: false; errorCode: string }
export interface BuiltinEntryDTO {
  kind: 'builtin'; id: 'webtools.translation'; source: 'bundled'
  name: string; description: string; version: string; icon: PluginIcon
  compatibility: { status: 'compatible' }
  state: BuiltinPluginStateDTO
  entry: { kind: 'builtin-page'; key: 'translation' }
  hostUsage: readonly ('translation' | 'shared-ai' | 'external-open' | 'clipboard')[]
  management: { canToggle: boolean; canRecover: boolean; canManageGrants: false; canUninstall: false; canReplacePackage: false }
}
export interface DeclarativeEntryDTO {
  kind: 'declarative'; id: string; source: 'local-unsigned'; package: PluginSummary
  icon: PluginIcon; entry: { kind: 'declarative-page' }
  management: { canToggle: boolean; canManageGrants: true; canUninstall: true; canReplacePackage: true }
}
export type CatalogEntryDTO = BuiltinEntryDTO | DeclarativeEntryDTO
export interface CatalogSnapshot {
  revision: number; entries: CatalogEntryDTO[]
  declarativeAvailability: { status: 'available' } | { status: 'unavailable'; errorCode: string }
}
export type CatalogOpenDTO =
  | { kind: 'builtin'; id: 'webtools.translation'; key: 'translation'; generation: number }
  | { kind: 'declarative'; page: PluginPageDTO }
export interface PluginCatalogApi {
  list(): Promise<IpcResult<CatalogSnapshot>>
  open(ref: PluginRef): Promise<IpcResult<CatalogOpenDTO>>
  setEnabled(ref: PluginRef, enabled: boolean): Promise<IpcResult<CatalogEntryDTO>>
  recoverBuiltinTranslation(): Promise<IpcResult<{ recovered: false } | { recovered: true; entry: BuiltinEntryDTO }>>
}
