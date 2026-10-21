import type { ManifestV3 } from '../../plugin-sdk/runtime-v3/manifest-v3.mjs'
import type { ValidatedRuntimeResourceV3 } from '../../plugin-sdk/runtime-v3/package-v3.mjs'

export interface ValidatedPluginResourceMetadataV3 {
  readonly canonicalPath: string
  readonly mimeType: string
  readonly size: number
}

export interface ValidatedPluginResourceV3 extends ValidatedPluginResourceMetadataV3 {
  readonly bytes: Buffer
}

export interface ValidatedPluginPackageSnapshotV3 {
  readonly manifest: ManifestV3
  readonly packageHash: string
  readonly archiveSize: number
  readonly expandedSize: number
  readonly inventory: readonly ValidatedPluginResourceMetadataV3[]
  getResource(canonicalPath: string): ValidatedPluginResourceV3 | undefined
}

const resourcesBySnapshot = new WeakMap<ValidatedPluginPackageSnapshotV3, ReadonlyMap<string, ValidatedPluginResourceV3>>()
const validSnapshots = new WeakSet<object>()

export function createValidatedPluginPackageSnapshotV3(value: {
  manifest: ManifestV3
  hash: string
  size: number
  expandedSize: number
  resources: readonly ValidatedRuntimeResourceV3[]
}): ValidatedPluginPackageSnapshotV3 {
  const resources = new Map<string, ValidatedPluginResourceV3>()
  const inventory = value.resources.map(resource => {
    const copy = Object.freeze({ canonicalPath: resource.canonicalPath, mimeType: resource.mimeType, size: resource.size })
    resources.set(resource.canonicalPath, Object.freeze({ ...copy, bytes: Buffer.from(resource.bytes) }))
    return copy
  })
  let snapshot: ValidatedPluginPackageSnapshotV3
  snapshot = Object.freeze({
    manifest: value.manifest,
    packageHash: value.hash,
    archiveSize: value.size,
    expandedSize: value.expandedSize,
    inventory: Object.freeze(inventory),
    getResource(canonicalPath: string) {
      const resource = resourcesBySnapshot.get(snapshot)?.get(canonicalPath)
      return resource ? Object.freeze({ ...resource, bytes: Buffer.from(resource.bytes) }) : undefined
    },
  })
  resourcesBySnapshot.set(snapshot, resources)
  validSnapshots.add(snapshot)
  return snapshot
}

export function isValidatedPluginPackageSnapshotV3(value: unknown): value is ValidatedPluginPackageSnapshotV3 {
  return value !== null && typeof value === 'object' && validSnapshots.has(value)
}
