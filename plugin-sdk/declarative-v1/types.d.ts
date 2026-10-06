/** Public authoring contract for WebTools declarative Manifest v1/API major 1. */
export type PluginCapabilityV1 =
  | 'manager.page'
  | 'plugin.config.read'
  | 'plugin.config.write'
  | 'plugin.storage.read'
  | 'plugin.storage.write'
  | 'external.open'
  | 'clipboard.write'
  | 'sharedAI.complete'

export type PluginSettingV1 =
  | { key: string; label: string; type: 'text'; minLength: number; maxLength: number; default: string }
  | { key: string; label: string; type: 'enum'; options: string[]; default: string }
  | { key: string; label: string; type: 'boolean'; default: boolean }
  | { key: string; label: string; type: 'number'; min: number; max: number; default: number }

export type PluginBlockV1 =
  | { type: 'heading' | 'paragraph'; text: string }
  | { type: 'text-input' | 'select' | 'checkbox'; settingKey: string }
  | { type: 'divider' }
  | { type: 'button'; label: string; actionId: string }

export type PluginActionV1 =
  | { id: string; type: 'plugin.config.read' | 'plugin.config.write' | 'plugin.storage.read' | 'plugin.storage.write'; key: string }
  | { id: string; type: 'external.open'; url: string }
  | { id: string; type: 'clipboard.write' | 'sharedAI.complete' }

export interface PluginPageV1 { id: string; title: string; blocks: PluginBlockV1[] }

export interface PluginManifestV1 {
  manifestVersion: 1
  id: string
  name: string
  description: string
  author: { name: string; url?: string }
  version: string
  api: { apiMajor: 1; minHostVersion: string }
  type: 'declarative-manager'
  entry: { pageId: string; label: string; icon?: string }
  requestedCapabilities: PluginCapabilityV1[]
  settings: PluginSettingV1[]
  pages: PluginPageV1[]
  actions: PluginActionV1[]
  assets: Array<{ path: string; type: 'image/png' }>
}

export type PluginDiagnosticCodeV1 =
  | 'INVALID_INPUT' | 'INVALID_MANIFEST' | 'INCOMPATIBLE_PLUGIN' | 'INVALID_PACKAGE'
  | 'SOURCE_IO' | 'SENSITIVE_CONTENT' | 'OUTPUT_EXISTS' | 'OUTPUT_IO'
  | 'CLI_USAGE' | 'GENERIC_ICON'

export interface PluginDiagnosticV1 {
  code: PluginDiagnosticCodeV1
  path: string
  field?: string
  message: string
  suggestion: string
}

export interface PluginValidationResultV1 {
  valid: true
  manifest: PluginManifestV1
  warnings: PluginDiagnosticV1[]
}

export interface PluginArchiveSummaryV1 {
  valid: true
  manifest: PluginManifestV1
  size: number
  sha256: string
}

export interface PluginPackResultV1 extends PluginArchiveSummaryV1 {}

export declare class PluginValidationError extends Error {
  readonly code: PluginDiagnosticCodeV1
  readonly path: string
  readonly field?: string
  readonly suggestion: string
}

export declare function validatePluginSourceV1(sourceDirectory: string, hostVersion: string): Promise<PluginValidationResultV1>
export declare function validatePluginArchiveV1(bytes: Uint8Array, hostVersion: string): Promise<PluginArchiveSummaryV1>
export declare function packPluginV1(sourceDirectory: string, outputFile: string, hostVersion: string): Promise<PluginPackResultV1>

export declare const MANIFEST_VERSION_V1: 1
export declare const API_MAJOR_V1: 1
export declare const CAPABILITIES_V1: readonly PluginCapabilityV1[]
export declare const BLOCK_TYPES_V1: readonly PluginBlockV1['type'][]
export declare const ACTION_TYPES_V1: readonly PluginActionV1['type'][]
export declare const LIMITS_V1: Readonly<{
  archive: 20971520; entries: 256; expanded: 52428800; png: 262144; manifest: 65536; ratio: 100; depth: 16
  pages: 8; blocks: 64; actions: 32; settings: 64; value: 524288; keys: 200; data: 5242880
}>
