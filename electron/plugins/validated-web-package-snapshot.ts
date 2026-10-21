import type { ManifestV2, NetworkRuntimeSupportV2 } from '../../plugin-sdk/declarative-v1/runtime/manifest-v2.mjs'

export interface ValidatedWebResourceMetadata {
  readonly canonicalPath: string
  readonly mimeType: string
  readonly size: number
}

export interface ValidatedWebResource {
  readonly canonicalPath: string
  readonly mimeType: string
  readonly bytes: Buffer
}

export interface ValidatedWebPackageSnapshot {
  readonly manifest: ManifestV2
  readonly packageHash: string
  readonly archiveSize: number
  readonly expandedSize: number
  readonly networkRuntimeSupport: NetworkRuntimeSupportV2
  readonly inventory: readonly ValidatedWebResourceMetadata[]
  getResource(canonicalPath: string): ValidatedWebResource | undefined
}
