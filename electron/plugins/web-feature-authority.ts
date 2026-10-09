import type { CapabilityV2 } from '../../plugin-sdk/declarative-v1/runtime/manifest-v2.mjs'
import { isValidatedWebPackageSnapshot } from './package-validator.ts'
import type { ValidatedWebPackageSnapshot } from './validated-web-package-snapshot.ts'

const authorities = new WeakSet<object>()
export const IMPLEMENTED_WEB_CAPABILITIES: readonly CapabilityV2[] = ['plugin.storage.read', 'plugin.storage.write', 'sharedAI.complete', 'clipboard.write']
export interface WebFeatureAuthority {
  readonly snapshot: ValidatedWebPackageSnapshot
  readonly featureId: string
  isCurrent(capability?: CapabilityV2): boolean
  revoke(): void
  onRevoke(listener: () => void): () => void
}

/** Host-internal ticket; never serializable or derived from Renderer claims. */
export function createWebFeatureAuthority(snapshot: ValidatedWebPackageSnapshot, featureId: string,
  current: (capability?: CapabilityV2) => boolean, release: () => void): WebFeatureAuthority {
  if (!isValidatedWebPackageSnapshot(snapshot) || !snapshot.manifest.features.some(f => f.id === featureId)) throw new TypeError('Invalid Web authority')
  let revoked = false
  const listeners = new Set<() => void>()
  const authority = Object.freeze({ snapshot, featureId,
    isCurrent: (capability?: CapabilityV2) => !revoked && current(capability),
    revoke: () => {
      if (revoked) return
      revoked = true; release()
      for (const listener of [...listeners]) { try { listener() } catch { /* Revocation cannot be interrupted by an observer. */ } }
      listeners.clear()
    },
    onRevoke: (listener: () => void) => {
      if (revoked) { listener(); return () => {} }
      listeners.add(listener); return () => { listeners.delete(listener) }
    },
  })
  authorities.add(authority)
  return authority
}
export function isWebFeatureAuthority(value: unknown): value is WebFeatureAuthority {
  return value !== null && typeof value === 'object' && authorities.has(value)
}
