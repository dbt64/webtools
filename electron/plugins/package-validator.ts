import type { ValidatedManifest } from './manifest.ts'
import { validatePackageV1 } from '../../plugin-sdk/declarative-v1/runtime/package-v1.mjs'
import { readManifestVersion, validatePackageV2 as validatePackageV2Core } from '../../plugin-sdk/declarative-v1/runtime/package-v2.mjs'
import { ManifestV2ValidationError } from '../../plugin-sdk/declarative-v1/runtime/manifest-v2.mjs'
import { RESERVED_WEB_FEATURE_IDENTITIES } from './reserved-web-feature-identities.ts'
import { fail } from './errors.ts'

export interface ValidatedPackage { manifest: ValidatedManifest; hash: string; bytes: Buffer; assets: Map<string, Buffer> }
export type ValidatedPackageV2 = Awaited<ReturnType<typeof validatePackageV2Core>>
export type IncomingPackage = { kind: 'v1'; package: ValidatedPackage } | { kind: 'v2'; package: ValidatedPackageV2 }

export async function validatePackage(source: Uint8Array, hostVersion: string, pngDecoder?: (bytes: Buffer) => boolean): Promise<ValidatedPackage> {
  try { return await validatePackageV1(source, hostVersion, pngDecoder) as unknown as ValidatedPackage }
  catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    if (code === 'INCOMPATIBLE_PLUGIN' || code === 'INVALID_MANIFEST') return fail(code)
    return fail('INVALID_PACKAGE')
  }
}

export async function validatePackageV2(source: Uint8Array, hostVersion: string): Promise<ValidatedPackageV2> {
  try { return await validatePackageV2Core(source, hostVersion, RESERVED_WEB_FEATURE_IDENTITIES) }
  catch (error) {
    if (error instanceof ManifestV2ValidationError) return fail(error.code)
    return fail('UNSAFE_ARCHIVE')
  }
}

/** Version routing for user-selected installs; v1 keeps its existing validator and v2 never falls back. */
export async function validateIncomingPackage(source: Uint8Array, hostVersion: string, pngDecoder?: (bytes: Buffer) => boolean): Promise<IncomingPackage> {
  let manifestVersion: 1 | 2
  try { manifestVersion = await readManifestVersion(source) }
  catch (error) {
    if (error instanceof ManifestV2ValidationError) return fail(error.code)
    return fail('UNSAFE_ARCHIVE')
  }
  if (manifestVersion === 1) return { kind: 'v1', package: await validatePackage(source, hostVersion, pngDecoder) }
  if (manifestVersion === 2) return { kind: 'v2', package: await validatePackageV2(source, hostVersion) }
  return fail('UNSUPPORTED_MANIFEST_VERSION')
}
