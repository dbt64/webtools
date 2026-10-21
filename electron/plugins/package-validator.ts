import type { ValidatedManifest } from './manifest.ts'
import { validatePackageV1 } from '../../plugin-sdk/declarative-v1/runtime/package-v1.mjs'
import { validatePackageV2 as validatePackageV2Core, validatePackageV2ForRuntime as validatePackageV2RuntimeCore } from '../../plugin-sdk/declarative-v1/runtime/package-v2.mjs'
import { ManifestV2ValidationError } from '../../plugin-sdk/declarative-v1/runtime/manifest-v2.mjs'
import { ManifestV3ValidationError } from '../../plugin-sdk/runtime-v3/manifest-v3.mjs'
import { readIncomingManifestVersion, validatePackageV3 as validatePackageV3Core, validatePackageV3ForRuntime as validatePackageV3RuntimeCore } from '../../plugin-sdk/runtime-v3/package-v3.mjs'
import type { ValidatedPackageV3, ValidatedPackageV3ForRuntime } from '../../plugin-sdk/runtime-v3/package-v3.mjs'
import { RESERVED_WEB_FEATURE_IDENTITIES } from './reserved-web-feature-identities.ts'
import type { ValidatedWebPackageSnapshot } from './validated-web-package-snapshot.ts'
import { createValidatedPluginPackageSnapshotV3, isValidatedPluginPackageSnapshotV3, type ValidatedPluginPackageSnapshotV3 } from './validated-plugin-package-snapshot.ts'
import { fail } from './errors.ts'

export interface ValidatedPackage { manifest: ValidatedManifest; hash: string; bytes: Buffer; assets: Map<string, Buffer> }
export type ValidatedPackageV2 = Awaited<ReturnType<typeof validatePackageV2Core>>
export type ValidatedRuntimePackageV3 = ValidatedPackageV3ForRuntime & { readonly snapshot: ValidatedPluginPackageSnapshotV3 }
export type IncomingPackage = { kind: 'v1'; package: ValidatedPackage } | { kind: 'v2'; package: ValidatedPackageV2 } | { kind: 'v3'; package: ValidatedRuntimePackageV3 }
export type ValidatedPluginRuntimeSnapshot = ValidatedWebPackageSnapshot | ValidatedPluginPackageSnapshotV3

type RuntimeResource = Readonly<{ canonicalPath: string; mimeType: string; size: number; bytes: Buffer }>
const runtimeSnapshotResources = new WeakMap<ValidatedWebPackageSnapshot, ReadonlyMap<string, RuntimeResource>>()
const runtimeSnapshots = new WeakSet<object>()

function createRuntimeSnapshot(validated: Awaited<ReturnType<typeof validatePackageV2RuntimeCore>>): ValidatedWebPackageSnapshot {
  const resources = new Map<string, RuntimeResource>()
  const inventory = validated.resources.map(resource => {
    const owned = Object.freeze({
      canonicalPath: resource.canonicalPath,
      mimeType: resource.mimeType,
      size: resource.size,
      bytes: Buffer.from(resource.bytes),
    })
    resources.set(owned.canonicalPath, owned)
    return Object.freeze({ canonicalPath: owned.canonicalPath, mimeType: owned.mimeType, size: owned.size })
  })
  let snapshot: ValidatedWebPackageSnapshot
  snapshot = Object.freeze({
    manifest: validated.manifest,
    packageHash: validated.hash,
    archiveSize: validated.size,
    expandedSize: validated.expandedSize,
    networkRuntimeSupport: validated.networkRuntimeSupport,
    inventory: Object.freeze(inventory),
    getResource(canonicalPath: string) {
      const resource = runtimeSnapshotResources.get(snapshot)?.get(canonicalPath)
      return resource ? Object.freeze({ ...resource, bytes: Buffer.from(resource.bytes) }) : undefined
    },
  })
  runtimeSnapshotResources.set(snapshot, resources)
  runtimeSnapshots.add(snapshot)
  return snapshot
}

export function isValidatedWebPackageSnapshot(value: unknown): value is ValidatedWebPackageSnapshot {
  return value !== null && typeof value === 'object' && runtimeSnapshots.has(value)
}

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

function runtimeCompatibility() {
  return { platform: process.platform, architecture: process.arch, nodeAbi: process.versions.modules }
}

export async function validatePackageV3(source: Uint8Array, hostVersion: string): Promise<ValidatedPackageV3> {
  try { return await validatePackageV3Core(source, hostVersion, runtimeCompatibility()) }
  catch (error) {
    if (error instanceof ManifestV3ValidationError) return fail(error.code)
    return fail('UNSAFE_ARCHIVE')
  }
}

export async function validatePackageV3ForRuntime(source: Uint8Array, hostVersion: string): Promise<ValidatedRuntimePackageV3> {
  try {
    const validated = await validatePackageV3RuntimeCore(source, hostVersion, runtimeCompatibility())
    const snapshot = createValidatedPluginPackageSnapshotV3(validated)
    return Object.freeze({ ...validated, snapshot })
  }
  catch (error) {
    if (error instanceof ManifestV3ValidationError) return fail(error.code)
    return fail('UNSAFE_ARCHIVE')
  }
}

export function isValidatedPluginRuntimeSnapshot(value: unknown): value is ValidatedPluginRuntimeSnapshot {
  return isValidatedPluginPackageSnapshotV3(value) || isValidatedWebPackageSnapshot(value)
}

/** Internal runtime prerequisite: validated resource bytes are retained from the same authoritative ZIP pass. */
export async function validateWebPackageForRuntime(source: Uint8Array, hostVersion: string): Promise<ValidatedWebPackageSnapshot> {
  try {
    const validated = await validatePackageV2RuntimeCore(source, hostVersion, RESERVED_WEB_FEATURE_IDENTITIES)
    return createRuntimeSnapshot(validated)
  } catch (error) {
    if (error instanceof ManifestV2ValidationError) return fail(error.code)
    return fail('UNSAFE_ARCHIVE')
  }
}

/** Version routing for user-selected installs; v1 keeps its existing validator and v2 never falls back. */
export async function validateIncomingPackage(source: Uint8Array, hostVersion: string, pngDecoder?: (bytes: Buffer) => boolean): Promise<IncomingPackage> {
  let manifestVersion: number
  try { manifestVersion = await readIncomingManifestVersion(source) }
  catch (error) {
    if (error instanceof ManifestV2ValidationError || error instanceof ManifestV3ValidationError) return fail(error.code)
    return fail('UNSAFE_ARCHIVE')
  }
  if (manifestVersion === 1) return { kind: 'v1', package: await validatePackage(source, hostVersion, pngDecoder) }
  if (manifestVersion === 2) return { kind: 'v2', package: await validatePackageV2(source, hostVersion) }
  if (manifestVersion === 3) return { kind: 'v3', package: await validatePackageV3ForRuntime(source, hostVersion) }
  return fail('UNSUPPORTED_MANIFEST_VERSION')
}
