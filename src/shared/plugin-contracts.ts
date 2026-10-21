/** Closed v1 data contracts. Nothing in a plugin is executable code. */
export const PLUGIN_CAPABILITIES = ['manager.page', 'plugin.config.read', 'plugin.config.write', 'plugin.storage.read', 'plugin.storage.write', 'external.open', 'clipboard.write', 'sharedAI.complete'] as const
export type PluginCapability = typeof PLUGIN_CAPABILITIES[number]
/** Manager install/grant controls cover both formats; the v1 Manifest allowlist remains unchanged. */
export const INSTALLED_PLUGIN_CAPABILITIES = [...PLUGIN_CAPABILITIES, 'clipboard.read', 'network.domains'] as const
export type InstalledPluginCapability = typeof INSTALLED_PLUGIN_CAPABILITIES[number]
export type PluginJson = null | boolean | number | string | PluginJson[] | { [key: string]: PluginJson }
export type PluginSettingValue = string | boolean | number
export interface PluginConfigurationIdentity { pluginId: string; version: string; hash: string }
export type PluginConfigurationDTO =
  | { identity: PluginConfigurationIdentity; status: 'unavailable' }
  | { identity: PluginConfigurationIdentity; status: 'ready' | 'incompatible'; schemaVersion: number; settings: PluginSetting[]; revision: string; values: Record<string, PluginSettingValue>; errorCode?: 'CONFIG_INCOMPATIBLE' }
export interface PluginConfigurationUpdate extends PluginConfigurationIdentity { revision: string; values: Record<string, PluginSettingValue> }
export interface PluginConfigurationReset extends PluginConfigurationIdentity { revision: string }
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
/** Safe, validated discovery metadata; no entry paths, raw manifest or runtime authority. */
export interface PluginFeatureSummary {
  id: string; title: string; description?: string; available: boolean
  presentation?: import('./feature-contracts.ts').FeaturePresentation
  invocationSurfaces?: readonly import('./feature-contracts.ts').FeatureInvocationSurface[]
  acceptedContexts?: readonly import('./feature-contracts.ts').FeatureProjectionAcceptedContextV2[]
}
export interface PluginSummary {
  id: string; name: string; version: string; hash: string; enabled: boolean; status: PluginStatus
  requested: InstalledPluginCapability[]; granted: InstalledPluginCapability[]; installedVersions: string[]; errorCode?: string; manifestVersion?: 1 | 2 | 3
  runtimeKind?: 'web' | 'node'
  description?: string; author?: { name: string; url?: string }; api?: { apiMajor: number; minHostVersion: string }
  source: 'local-unsigned'; iconDataUrl?: string
  webFeatures?: PluginFeatureSummary[]
  /** Presentation only: grants remain controlled by Host, independently of implementation support. */
  unsupportedCapabilities?: InstalledPluginCapability[]
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
  addedCapabilities: InstalledPluginCapability[]; removedCapabilities: InstalledPluginCapability[]; reauthorizationRequired: boolean
}
export interface PluginInstallResult { outcome: 'installed' | 'already-installed' | 'cancelled'; plugin?: PluginSummary; change?: PluginVersionChange }
export interface PluginApi {
  list(): Promise<import('./ipc').IpcResult<PluginSummary[]>>
  installFromUserDialog(): Promise<import('./ipc').IpcResult<PluginInstallResult>>
  setEnabled(pluginId: string, enabled: boolean): Promise<import('./ipc').IpcResult<PluginSummary>>
  stopRuntime(pluginId: string): Promise<import('./ipc').IpcResult<{ stopped: true }>>
  setGrants(pluginId: string, grants: InstalledPluginCapability[]): Promise<import('./ipc').IpcResult<PluginSummary>>
  getPages(pluginId: string): Promise<import('./ipc').IpcResult<PluginPageDTO>>
  getConfiguration(identity: PluginConfigurationIdentity): Promise<import('./ipc').IpcResult<PluginConfigurationDTO>>
  updateConfiguration(request: PluginConfigurationUpdate): Promise<import('./ipc').IpcResult<PluginConfigurationDTO>>
  resetConfiguration(request: PluginConfigurationReset): Promise<import('./ipc').IpcResult<PluginConfigurationDTO>>
  invoke(request: PluginInvokeRequest): Promise<import('./ipc').IpcResult<PluginActionResult>>
  prepareAIReview(request: PluginInvokeRequest): Promise<import('./ipc').IpcResult<PluginAIReviewDTO>>
  confirmAIReview(reviewId: string): Promise<import('./ipc').IpcResult<PluginActionResult>>
  cancelAIReview(reviewId: string): Promise<import('./ipc').IpcResult<{ cancelled: boolean }>>
  uninstall(pluginId: string): Promise<import('./ipc').IpcResult<{ removed: boolean }>>
}
