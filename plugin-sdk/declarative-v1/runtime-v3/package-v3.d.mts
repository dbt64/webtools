import type { ManifestV3 } from './manifest-v3.mjs'
export interface ValidatedRuntimeResourceV3 { readonly canonicalPath: string; readonly mimeType: string; readonly size: number; readonly bytes: Buffer }
export interface ValidatedPackageV3 { readonly manifest: ManifestV3; readonly hash: string; readonly size: number; readonly runtimeSupport: 'runtime-v3' }
export interface ValidatedPackageV3ForRuntime extends ValidatedPackageV3 { readonly expandedSize: number; readonly resources: readonly ValidatedRuntimeResourceV3[] }
export declare function readIncomingManifestVersion(source: Uint8Array): Promise<number>
export declare function readManifestVersionV3(source: Uint8Array): Promise<number>
export declare function validatePackageV3(source: Uint8Array, hostVersion: string, host?: { platform?: string; architecture?: string; nodeAbi?: string }): Promise<ValidatedPackageV3>
export declare function validatePackageV3ForRuntime(source: Uint8Array, hostVersion: string, host?: { platform?: string; architecture?: string; nodeAbi?: string }): Promise<ValidatedPackageV3ForRuntime>
