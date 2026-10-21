export type CapabilityV2 = 'plugin.config.read' | 'plugin.config.write' | 'plugin.storage.read' | 'plugin.storage.write' | 'external.open' | 'clipboard.write' | 'clipboard.read' | 'sharedAI.complete' | 'network.domains'
export interface ManifestV2 {
  readonly manifestVersion: 2
  readonly id: string
  readonly name: string
  readonly description: string
  readonly author: Readonly<{ name: string; url?: string }>
  readonly version: string
  readonly api: Readonly<{ apiMajor: 1; minHostVersion: string }>
  readonly type: 'feature-bundle'
  readonly requestedCapabilities: readonly CapabilityV2[]
  readonly features: readonly Readonly<{
    id: string; title: string; description?: string; commands: readonly string[]; icon?: { readonly kind: 'host'; readonly key: string } | { readonly kind: 'asset'; readonly path: string }
    acceptedContexts: readonly Readonly<{ type: 'text'; sources: readonly ('launcher-input' | 'clipboard')[] }>[]
    entry: Readonly<{ kind: 'web-bundle'; document: string }>; requiredCapabilities: readonly CapabilityV2[]
    executionRequirements: Readonly<{ wasm: boolean }>
  }>[]
  readonly webBundle: Readonly<{ files: readonly Readonly<{ path: string; mediaType: string }>[] }>
  readonly assets: readonly Readonly<{ path: string; mediaType: string }>[]
  readonly network: Readonly<{ mode: 'none'; domains: readonly [] } | { mode: 'domains'; domains: readonly Readonly<{ host: string; protocol: 'https' | 'wss' }>[] }>
}
export type NetworkRuntimeSupportV2 = 'not-requested' | 'unavailable'
export declare const MANIFEST_VERSION_V2: 2
export declare const LIMITS_V2: Readonly<Record<string, number>>
export declare class ManifestV2ValidationError extends Error { readonly code: string }
export declare function parseManifestV2(source: Uint8Array, hostVersion: string, reservedFeatureIdentities?: readonly string[]): Readonly<{ manifest: ManifestV2; networkRuntimeSupport: NetworkRuntimeSupportV2 }>
