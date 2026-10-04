/** Closed v1 data contracts. Nothing in a plugin is executable code. */
export const PLUGIN_CAPABILITIES = ['manager.page', 'plugin.config.read', 'plugin.config.write', 'plugin.storage.read', 'plugin.storage.write', 'external.open', 'clipboard.write', 'sharedAI.complete'] as const
export type PluginCapability = typeof PLUGIN_CAPABILITIES[number]
export type PluginJson = null | boolean | number | string | PluginJson[] | { [key: string]: PluginJson }
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
}
/** Sanitized presentation, not a raw manifest or package/secret/configuration path. */
export interface PluginPageDTO {
  pluginId: string; version: string; hash: string
  entry: { pageId: string; label: string; iconDataUrl?: string }
  pages: PluginPage[]; settings: PluginSetting[]
  actions: Array<{ id: string; type: PluginAction['type'] }>
}
export interface PluginInvokeRequest { pluginId: string; version: string; hash: string; actionId: string; input: PluginJson }
export type PluginActionResult = { status: 'success'; value: PluginJson } | { status: 'cancelled' }
export interface PluginInstallResult { outcome: 'installed' | 'already-installed' | 'cancelled'; plugin?: PluginSummary }
export interface PluginApi {
  list(): Promise<import('./ipc').IpcResult<PluginSummary[]>>
  installFromUserDialog(): Promise<import('./ipc').IpcResult<PluginInstallResult>>
  setEnabled(pluginId: string, enabled: boolean): Promise<import('./ipc').IpcResult<PluginSummary>>
  setGrants(pluginId: string, grants: PluginCapability[]): Promise<import('./ipc').IpcResult<PluginSummary>>
  getPages(pluginId: string): Promise<import('./ipc').IpcResult<PluginPageDTO>>
  invoke(request: PluginInvokeRequest): Promise<import('./ipc').IpcResult<PluginActionResult>>
  uninstall(pluginId: string): Promise<import('./ipc').IpcResult<{ removed: boolean }>>
}
