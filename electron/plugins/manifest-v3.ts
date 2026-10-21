import type { ManifestV3 } from '../../plugin-sdk/runtime-v3/manifest-v3.mjs'
import * as canonical from '../../plugin-sdk/runtime-v3/manifest-v3.mjs'
import { fail } from './errors.ts'

declare const validated: unique symbol
export type ValidatedManifestV3 = ManifestV3 & { readonly [validated]: true }

export function supportsFeaturePresentation(manifest: ManifestV3, feature: ManifestV3['features'][number]): boolean {
  return feature.presentation?.type === 'command'
    ? manifest.runtime.kind === 'node' && feature.entry.kind === 'node-command'
    : feature.entry.kind === 'web-bundle'
}

function adapt<T>(operation: () => T): T {
  try { return operation() }
  catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    if (typeof code === 'string') return fail(code)
    return fail('INVALID_INPUT')
  }
}

export function parseManifestV3(source: Uint8Array, hostVersion: string, host?: { platform?: string; architecture?: string; nodeAbi?: string }): ValidatedManifestV3 {
  return adapt(() => canonical.parseManifestV3(source, hostVersion, host).manifest) as ValidatedManifestV3
}
