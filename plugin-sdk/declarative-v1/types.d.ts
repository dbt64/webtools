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

/** Structural, non-executing Manifest v2 author preflight contract. Host install validation remains authoritative. */
export type PluginCapabilityV2 = Exclude<PluginCapabilityV1, 'manager.page'> | 'clipboard.read' | 'network.domains'
export type PluginDiagnosticCodeV2 =
  | 'INVALID_MANIFEST' | 'UNSUPPORTED_MANIFEST_VERSION' | 'INVALID_FIELD' | 'UNKNOWN_FIELD'
  | 'INVALID_PLUGIN_ID' | 'RESERVED_IDENTITY' | 'DUPLICATE_FEATURE' | 'INVALID_CAPABILITY'
  | 'INVALID_NETWORK_DECLARATION' | 'INVALID_PATH' | 'INVENTORY_MISMATCH' | 'UNSUPPORTED_FILE_TYPE'
  | 'PACKAGE_LIMIT_EXCEEDED' | 'UNSAFE_ARCHIVE' | 'INCOMPATIBLE_HOST'
export interface PluginManifestV2 {
  manifestVersion: 2
  id: string
  name: string
  description: string
  author: { name: string; url?: string }
  version: string
  api: { apiMajor: 1; minHostVersion: string }
  type: 'feature-bundle'
  requestedCapabilities: PluginCapabilityV2[]
  features: Array<{
    id: string; title: string; description?: string; commands?: string[]
    icon?: { kind: 'host'; key: 'sparkles' | 'document' | 'globe' | 'translate' } | { kind: 'asset'; path: string }
    acceptedContexts?: Array<{ type: 'text'; sources: Array<'launcher-input' | 'clipboard'> }>
    entry: { kind: 'web-bundle'; document: string }
    requiredCapabilities?: PluginCapabilityV2[]
    executionRequirements?: { wasm: boolean }
  }>
  webBundle: { files: Array<{ path: string; mediaType: string }> }
  assets?: Array<{ path: string; mediaType: string }>
  network: { mode: 'none'; domains: [] } | { mode: 'domains'; domains: Array<{ host: string; protocol: 'https' | 'wss' }> }
}

/** Manifest v3 is the production Web/Node package contract; Host install-time validation remains authoritative. */
export type PluginCapabilityV3 = Exclude<PluginCapabilityV2, 'network.domains'> | 'manager.page' | 'clipboard.read'
export type PluginRuntimeKindV3 = 'web' | 'node'
export interface PluginRuntimeCompatibilityV3 {
  platforms: Array<'win32' | 'darwin' | 'linux'>
  architectures: Array<'x64' | 'arm64' | 'ia32'>
  nodeAbi?: string
}
export type PluginRuntimeFileRoleV3 = 'web' | 'node-preload' | 'node-command' | 'dependency' | 'native-addon' | 'helper' | 'library' | 'resource'
export type PluginRuntimeMediaTypeV3 = 'text/html' | 'text/javascript' | 'text/css' | 'application/json' | 'application/wasm' | 'image/png' | 'image/jpeg' | 'image/webp' | 'font/woff2' | 'application/octet-stream'
export interface PluginRuntimeFileV3 { path: string; role: PluginRuntimeFileRoleV3; mediaType: PluginRuntimeMediaTypeV3; dependency?: string }
export interface PluginDependencyV3 { name: string; version: string; files: string[] }
export interface PluginManifestV3 {
  manifestVersion: 3
  id: string
  name: string
  description: string
  author: { name: string; url?: string }
  version: string
  api: { apiMajor: 1; minHostVersion: string }
  type: 'plugin'
  requestedCapabilities: PluginCapabilityV3[]
  configuration?: import('./runtime-v3/configuration.mjs').PluginConfiguration
  runtime: { kind: PluginRuntimeKindV3; preload?: string }
  compatibility: PluginRuntimeCompatibilityV3
  features: Array<{
    id: string; title: string; description?: string; commands?: string[]
    icon?: { kind: 'host'; key: 'sparkles' | 'document' | 'globe' | 'translate' } | { kind: 'asset'; path: string }
    acceptedContexts?: Array<import('./runtime-v3/manifest-v3.mjs').AcceptedContextV3>
    entry: { kind: 'web-bundle'; document: string } | { kind: 'node-command'; module: string }
    presentation?: import('./runtime-v3/manifest-v3.mjs').FeaturePresentationV3
    requiredCapabilities?: PluginCapabilityV3[]
  }>
  runtimeFiles: PluginRuntimeFileV3[]
  dependencies: PluginDependencyV3[]
  package: { format: 'wtplugin'; packageVersion: 1; metadata?: Record<string, never> }
}
export type ManifestV3 = PluginManifestV3
export interface PluginRuntimePaths {
  readonly packageDirectory: string
  readonly localDataDirectory: string
}
export declare function getPluginPaths(preloadDirectory: string): PluginRuntimePaths
export type PluginDiagnosticCodeV3 =
  | 'INVALID_PLUGIN_ID' | 'UNSUPPORTED_MANIFEST_VERSION' | 'INVALID_MANIFEST' | 'UNKNOWN_FIELD'
  | 'INVALID_FIELD' | 'INCOMPATIBLE_HOST' | 'INCOMPATIBLE_PLUGIN' | 'INVALID_CAPABILITY'
  | 'INVALID_PATH' | 'INVENTORY_MISMATCH' | 'UNSUPPORTED_FILE_TYPE' | 'PACKAGE_LIMIT_EXCEEDED'
  | 'UNSAFE_ARCHIVE' | 'SOURCE_IO' | 'INVALID_PACKAGE' | 'OUTPUT_EXISTS' | 'OUTPUT_IO'
  | 'DEPENDENCY_NOT_FOUND' | 'DEPENDENCY_INVALID' | 'UNSAFE_DEPENDENCY_LINK' | 'DEPENDENCY_COLLISION'
  | 'NATIVE_ABI_MISMATCH' | 'NATIVE_ARCH_MISMATCH'
  | 'BUILD_PROJECT_PATH' | 'BUILD_INPUT_MISSING' | 'BUILD_INPUT_INVALID' | 'BUILD_SYMLINK'
  | 'BUILD_SPECIAL_FILE' | 'BUILD_OUTPUT_PATH' | 'BUILD_VITE_MISSING' | 'BUILD_TYPESCRIPT_MISSING'
  | 'BUILD_PRELOAD_CONFIG' | 'BUILD_PRELOAD_FAILED' | 'BUILD_PRELOAD_MISSING' | 'BUILD_WEB_FAILED'
  | 'BUILD_MANIFEST_VERSION' | 'BUILD_MANIFEST_INVALID' | 'BUILD_MEDIA_TYPE' | 'BUILD_OUTPUT_UNEXPECTED'
  | 'BUILD_MISSING_PRELOAD' | 'BUILD_MISSING_ENTRY' | 'MISSING_PRELOAD' | 'MISSING_RUNTIME_ENTRY'
  | 'DEV_SERVER_FAILED' | 'DEV_JSON_UNSUPPORTED' | 'DEV_WATCH_UNAVAILABLE' | 'CLI_USAGE'
export type PluginDeveloperDiagnostic = {
  readonly code: PluginDiagnosticCodeV3
  readonly path?: string
  readonly field?: string
  readonly message: string
  readonly likelyCause?: string
  readonly suggestion: string
}
export interface PluginArchiveSummaryV3 {
  valid: true; manifest: DeepReadonly<PluginManifestV3>; size: number; sha256: string; runtimeSupport: 'runtime-v3'
}
export interface PluginValidationResultV3 { valid: true; manifest: DeepReadonly<PluginManifestV3>; warnings: readonly { code: string; dependency?: string }[] }
export interface PluginPackResultV3 extends PluginArchiveSummaryV3 { warnings: readonly { code: string; dependency?: string }[] }
export declare class ManifestV3ValidationError extends Error { readonly code: string }
export interface PluginPackageSourceOptions {
  /** Runtime dependencies are resolved from this project root while packaged files are read from sourceDirectory. */
  readonly projectRoot?: string
  /** Compatibility profile of the intended WebTools host. The Host checks independently during installation. */
  readonly host?: { readonly platform?: string; readonly architecture?: string; readonly nodeAbi?: string }
}
export declare const MANIFEST_VERSION_V3: 3
export declare const LIMITS_V3: Readonly<Record<string, number>>
export declare function parseManifestV3(source: Uint8Array, hostVersion: string, host?: { platform?: string; architecture?: string; nodeAbi?: string }): Readonly<{ manifest: PluginManifestV3 }>
/** Advisory package preflight. Electron Main remains the final validation and install authority. */
export declare function validatePluginArchiveV3(bytes: Uint8Array, hostVersion: string, host?: { platform?: string; architecture?: string; nodeAbi?: string }): Promise<PluginArchiveSummaryV3>
export declare function validatePluginSourceV3(sourceDirectory: string, hostVersion: string, options?: PluginPackageSourceOptions): Promise<PluginValidationResultV3>
export declare function packPluginV3(sourceDirectory: string, outputFile: string, hostVersion: string, options?: PluginPackageSourceOptions): Promise<PluginPackResultV3>

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

type DeepReadonly<T> = T extends (infer Value)[]
  ? readonly DeepReadonly<Value>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T

export interface PluginArchiveSummaryV2 {
  readonly valid: true
  readonly manifest: DeepReadonly<PluginManifestV2>
  readonly size: number
  readonly sha256: string
  readonly runtimeSupport: 'not-implemented'
  readonly networkRuntimeSupport: 'not-requested' | 'unavailable'
}

export declare class ManifestV2ValidationError extends Error {
  readonly code: PluginDiagnosticCodeV2
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
/** Advisory package preflight only. Electron Main always reruns Host validation before any state change. */
export declare function validatePluginArchiveV2(bytes: Uint8Array, hostVersion: string): Promise<PluginArchiveSummaryV2>
export declare function packPluginV1(sourceDirectory: string, outputFile: string, hostVersion: string): Promise<PluginPackResultV1>

export declare const MANIFEST_VERSION_V1: 1
export declare const MANIFEST_VERSION_V2: 2
export declare const API_MAJOR_V1: 1
export declare const CAPABILITIES_V1: readonly PluginCapabilityV1[]
export declare const BLOCK_TYPES_V1: readonly PluginBlockV1['type'][]
export declare const ACTION_TYPES_V1: readonly PluginActionV1['type'][]
export declare const LIMITS_V1: Readonly<{
  archive: 20971520; entries: 256; expanded: 52428800; png: 262144; manifest: 65536; ratio: 100; depth: 16
  pages: 8; blocks: 64; actions: 32; settings: 64; value: 524288; keys: 200; data: 5242880
}>
export declare const LIMITS_V2: Readonly<{
  archive: 20971520; entries: 256; expanded: 52428800; manifest: 65536; ratio: 100; depth: 16
  html: 1048576; bundleFile: 8388608; image: 2097152; font: 1048576; icon: 262144
  assets: 128; features: 16; commands: 8; contexts: 4; capabilities: 12; networkDomains: 16
}>
