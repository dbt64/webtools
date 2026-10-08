import type { ManifestV2, NetworkRuntimeSupportV2 } from './manifest-v2.mjs'
export interface ValidatedPackageV2 {
  readonly manifest: ManifestV2
  readonly hash: string
  readonly size: number
  readonly runtimeSupport: 'not-implemented'
  readonly networkRuntimeSupport: NetworkRuntimeSupportV2
}
export interface ValidatedPackageV2Runtime extends ValidatedPackageV2 {
  readonly expandedSize: number
  readonly resources: readonly Readonly<{ canonicalPath: string; mimeType: string; size: number; bytes: Buffer }>[]
}
export declare function readManifestVersion(source: Uint8Array): Promise<1 | 2>
export declare function validatePackageV2(source: Uint8Array, hostVersion: string, reservedFeatureIdentities?: readonly string[]): Promise<ValidatedPackageV2>
/** Host-internal validated bytes from the same archive validation pass. Not part of the public SDK entry point. */
export declare function validatePackageV2ForRuntime(source: Uint8Array, hostVersion: string, reservedFeatureIdentities?: readonly string[]): Promise<ValidatedPackageV2Runtime>
