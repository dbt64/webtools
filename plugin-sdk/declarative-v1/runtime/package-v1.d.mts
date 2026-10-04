import type { ValidatedManifestV1 } from './manifest-v1.mjs'
export interface ValidatedPackageV1 { manifest: ValidatedManifestV1; hash: string; bytes: Buffer; assets: Map<string, Buffer> }
export declare function validatePackageV1(source: Uint8Array, hostVersion: string, pngDecoder?: (bytes: Buffer) => boolean): Promise<ValidatedPackageV1>
