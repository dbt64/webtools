export type RuntimeFileRole = 'web' | 'node-preload' | 'node-command' | 'dependency' | 'native-addon' | 'helper' | 'library' | 'resource'
export type PluginCapabilityV3 = 'manager.page' | 'plugin.config.read' | 'plugin.config.write' | 'plugin.storage.read' | 'plugin.storage.write' | 'external.open' | 'clipboard.write' | 'clipboard.read' | 'sharedAI.complete'
export type RuntimeMediaType = 'text/html' | 'text/javascript' | 'text/css' | 'application/json' | 'application/wasm' | 'image/png' | 'image/jpeg' | 'image/webp' | 'font/woff2' | 'application/octet-stream'
export interface RuntimeFileV3 { readonly path: string; readonly role: RuntimeFileRole; readonly mediaType: RuntimeMediaType; readonly dependency?: string }
export interface PluginDependencyV3 { readonly name: string; readonly version: string; readonly files: readonly string[] }
export type WindowBlurBehaviorV3 = 'temporary-hide' | 'background'
export type FeaturePresentationV3 = Readonly<{ type: 'command' }> | Readonly<{
  type: 'window'; defaultWidth?: number; defaultHeight?: number; minWidth?: number; minHeight?: number; resizable?: boolean; blurBehavior?: WindowBlurBehaviorV3
}>
export type AcceptedContextV3 =
  | Readonly<{ type: 'text'; sources: readonly ('launcher-input' | 'clipboard' | 'selected-text')[]; textMatch?: 'http-url' }>
  | Readonly<{ type: 'files'; sources: readonly 'explorer-selection'[]; extensions?: readonly string[]; maxItems?: number }>
  | Readonly<{ type: 'directories'; sources: readonly 'explorer-selection'[]; maxItems?: number }>
  | Readonly<{ type: 'none'; sources: readonly [] }>
export interface PluginFeatureV3 {
  readonly id: string; readonly title: string; readonly description?: string; readonly commands: readonly string[]
  readonly entry: Readonly<{ kind: 'web-bundle'; document: string }> | Readonly<{ kind: 'node-command'; module: string }>
  /** Omission is normalized to window for existing Manifest v3 packages. */
  readonly presentation?: FeaturePresentationV3
  readonly requiredCapabilities: readonly PluginCapabilityV3[]
  readonly acceptedContexts: readonly AcceptedContextV3[]
  readonly icon?: Readonly<{ kind: 'host'; key: 'sparkles' | 'document' | 'globe' | 'translate' }> | Readonly<{ kind: 'asset'; path: string }>
}
export interface ManifestV3 {
  readonly manifestVersion: 3; readonly id: string; readonly name: string; readonly description: string
  readonly author: Readonly<{ name: string; url?: string }>; readonly version: string
  readonly api: Readonly<{ apiMajor: 1; minHostVersion: string }>; readonly type: 'plugin'
  readonly requestedCapabilities: readonly PluginCapabilityV3[]
  readonly configuration?: import('./configuration.mjs').PluginConfiguration
  readonly runtime: Readonly<{ kind: 'web' | 'node'; preload?: string }>
  readonly compatibility: Readonly<{ platforms: readonly string[]; architectures: readonly string[]; nodeAbi?: string }>
  readonly features: readonly PluginFeatureV3[]; readonly runtimeFiles: readonly RuntimeFileV3[]
  readonly dependencies: readonly PluginDependencyV3[]
  readonly package: Readonly<{ format: 'wtplugin'; packageVersion: 1; metadata?: Readonly<Record<string, never>> }>
}
export type { PluginConfiguration, ConfigurationSetting, ConfigurationValue } from './configuration.mjs'
export declare const MANIFEST_VERSION_V3: 3
export declare const LIMITS_V3: Readonly<Record<string, number>>
export declare class ManifestV3ValidationError extends Error { readonly code: string }
export declare function parseManifestV3(source: Uint8Array, hostVersion: string, host?: { platform?: string; architecture?: string; nodeAbi?: string }): Readonly<{ manifest: ManifestV3 }>
