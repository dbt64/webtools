import type { ValidatedManifest } from './manifest.ts'
import { validatePackageV1 } from '../../plugin-sdk/declarative-v1/runtime/package-v1.mjs'
import { fail } from './errors.ts'

export interface ValidatedPackage { manifest: ValidatedManifest; hash: string; bytes: Buffer; assets: Map<string, Buffer> }

export async function validatePackage(source: Uint8Array, hostVersion: string, pngDecoder?: (bytes: Buffer) => boolean): Promise<ValidatedPackage> {
  try { return await validatePackageV1(source, hostVersion, pngDecoder) as unknown as ValidatedPackage }
  catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    if (code === 'INCOMPATIBLE_PLUGIN' || code === 'INVALID_MANIFEST') return fail(code)
    return fail('INVALID_PACKAGE')
  }
}
