/** Closed v1 data contracts. Nothing in a plugin is executable code. */
export const PLUGIN_CAPABILITIES = ['manager.page', 'plugin.config.read', 'plugin.config.write', 'plugin.storage.read', 'plugin.storage.write', 'external.open', 'clipboard.write', 'sharedAI.complete'] as const
export type PluginCapability = typeof PLUGIN_CAPABILITIES[number]
export type PluginJson = null | boolean | number | string | PluginJson[] | { [key: string]: PluginJson }
export type PluginSettingValue = string | boolean | number
interface SettingBase { key: string; label: string }
export type PluginSetting =
  | (SettingBase & { type: 'text'; minLength: number; maxLength: number; default: string })
  | (SettingBase & { type: 'enum'; options: string[]; default: string })
  | (SettingBase & { type: 'boolean'; default: boolean })
  | (SettingBase & { type: 'number'; min: number; max: number; default: number })
export type PluginBlock =
  | { type: 'heading' | 'paragraph'; text: string }
  | { type: 'text-input' | 'select' | 'checkbox'; settingKey: string }
  | { type: 'divider' }
  | { type: 'button'; label: string; actionId: string }
export type PluginAction =
  | { id: string; type: 'plugin.config.read' | 'plugin.config.write' | 'plugin.storage.read' | 'plugin.storage.write'; key: string }
  | { id: string; type: 'external.open'; url: string }
  | { id: string; type: 'clipboard.write' | 'sharedAI.complete' }
export interface PluginPage { id: string; title: string; blocks: PluginBlock[] }
export interface PluginManifest {
  manifestVersion: 1
  id: string
  name: string
  description: string
  author: { name: string; url?: string }
  version: string
  api: { apiMajor: 1; minHostVersion: string }
  type: 'declarative-manager'
  entry: { pageId: string; label: string; icon?: string }
  requestedCapabilities: PluginCapability[]
  settings: PluginSetting[]
  pages: PluginPage[]
  actions: PluginAction[]
  assets: Array<{ path: string; type: 'image/png' }>
}
export type PluginStatus = 'not-installed' | 'validating' | 'installed-disabled' | 'enabled' | 'active' | 'invoking' | 'stopping' | 'incompatible' | 'invalid' | 'needs-permission' | 'faulted'
export interface PluginSummary {
  id: string; name: string; version: string; hash: string; enabled: boolean; status: PluginStatus
  requested: PluginCapability[]; granted: PluginCapability[]; installedVersions: string[]; errorCode?: string
  description?: string; author?: { name: string; url?: string }; api?: { apiMajor: number; minHostVersion: string }
  source: 'local-unsigned'; iconDataUrl?: string
}
/** Sanitized presentation, not a raw manifest or package/secret/configuration path. */
export interface PluginPageDTO {
  pluginId: string; version: string; hash: string
  entry: { pageId: string; label: string; iconDataUrl?: string }
  pages: PluginPage[]; settings: PluginSetting[]
  config?: Record<string, PluginSettingValue>
  actions: Array<{ id: string; type: PluginAction['type']; key?: string }>
}
export interface PluginInvokeRequest { pluginId: string; version: string; hash: string; actionId: string; input: PluginJson }
export type PluginActionResult = { status: 'success'; value: PluginJson } | { status: 'cancelled' }
export interface PluginAIReviewDTO {
  reviewId: string; pluginId: string; pluginName: string; version: string; hash: string; actionId: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  providerName: string; model: string; messageCount: number; characterCount: number
}
export type PluginVersionChangeKind = 'new-install' | 'same-version-replacement' | 'upgrade' | 'downgrade'
/** Safe version and capability delta for the host-owned install confirmation/result UI. */
export interface PluginVersionChange {
  kind: PluginVersionChangeKind; currentVersion?: string; incomingVersion: string
  addedCapabilities: PluginCapability[]; removedCapabilities: PluginCapability[]; reauthorizationRequired: boolean
}
export interface PluginInstallResult { outcome: 'installed' | 'already-installed' | 'cancelled'; plugin?: PluginSummary; change?: PluginVersionChange }
export interface PluginApi {
  list(): Promise<import('./ipc').IpcResult<PluginSummary[]>>
  installFromUserDialog(): Promise<import('./ipc').IpcResult<PluginInstallResult>>
  setEnabled(pluginId: string, enabled: boolean): Promise<import('./ipc').IpcResult<PluginSummary>>
  setGrants(pluginId: string, grants: PluginCapability[]): Promise<import('./ipc').IpcResult<PluginSummary>>
  getPages(pluginId: string): Promise<import('./ipc').IpcResult<PluginPageDTO>>
  invoke(request: PluginInvokeRequest): Promise<import('./ipc').IpcResult<PluginActionResult>>
  prepareAIReview(request: PluginInvokeRequest): Promise<import('./ipc').IpcResult<PluginAIReviewDTO>>
  confirmAIReview(reviewId: string): Promise<import('./ipc').IpcResult<PluginActionResult>>
  cancelAIReview(reviewId: string): Promise<import('./ipc').IpcResult<{ cancelled: boolean }>>
  uninstall(pluginId: string): Promise<import('./ipc').IpcResult<{ removed: boolean }>>
}
