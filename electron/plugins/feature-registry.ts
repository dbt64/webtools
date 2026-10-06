import { randomUUID } from 'node:crypto'
import {
  featureProjectionContentIdentity,
  isFeatureRef,
  parseFeatureProjectionV2,
  type FeatureProjectionRowV2,
  type FeatureProjectionV2,
  type FeatureRef,
} from '../../src/shared/feature-contracts.ts'
import { BUILTIN_TRANSLATION_FEATURE, type DeclarativeFeatureCandidate, type MainResolvedFeature } from './feature-contracts.ts'

export interface FeatureRegistryDependencies {
  listDeclarativeFeatures(): Promise<readonly DeclarativeFeatureCandidate[]>
  isTranslationEnabled(): boolean
  now?: () => number
  hostSessionId?: string
}

export interface ResolvedFeatureCandidate {
  readonly pluginName: string
  readonly feature: MainResolvedFeature
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function refKey(ref: FeatureRef): string {
  return `${ref.pluginId}\u0000${ref.featureId}`
}

function toProjectionRow(candidate: ResolvedFeatureCandidate): FeatureProjectionRowV2 {
  const { feature } = candidate
  if (feature.sourceKind === 'declarative') {
    if (feature.resolvedEntry.kind !== 'declarative-compatibility') throw new Error('Invalid declarative Feature route.')
    return {
      ref: { ...feature.ref },
      pluginName: candidate.pluginName,
      title: feature.title,
      commands: [...feature.commands],
      acceptedContexts: [],
      iconToken: 'plugin',
      featureKind: 'declarative-compatibility',
      group: 'plugin-features',
    }
  }
  if (feature.sourceKind === 'built-in') {
    if (feature.resolvedEntry.kind !== 'built-in' || feature.resolvedEntry.key !== 'translation') throw new Error('Invalid built-in Feature route.')
    return {
      ref: { ...feature.ref },
      pluginName: candidate.pluginName,
      title: feature.title,
      commands: [...feature.commands],
      acceptedContexts: [],
      iconToken: 'translate',
      featureKind: 'built-in',
      group: 'plugin-features',
    }
  }
  throw new Error('Unknown Feature source kind.')
}

/** Main-owned, non-persistent view derived exclusively from live authorities. */
export class FeatureRegistry {
  private readonly deps: FeatureRegistryDependencies
  private readonly sessionId: string
  private revision = 1
  private lastContentIdentity = '[]'
  private currentProjection: FeatureProjectionV2
  private currentFeatures = new Map<string, ResolvedFeatureCandidate>()
  private refreshRequested = false
  private refreshInFlight: Promise<FeatureProjectionV2> | null = null
  private closed = false

  constructor(deps: FeatureRegistryDependencies) {
    this.deps = deps
    this.sessionId = deps.hostSessionId ?? randomUUID()
    const initial = parseFeatureProjectionV2({
      projectionVersion: 2,
      hostSessionId: this.sessionId,
      revision: this.revision,
      generatedAtUnixMs: (deps.now ?? Date.now)(),
      features: [],
    })
    if (!initial) throw new Error('Invalid Feature Registry session identity.')
    this.currentProjection = initial
  }

  get hostSessionId(): string { return this.sessionId }
  get contentRevision(): number { return this.revision }

  snapshot(): FeatureProjectionV2 {
    const copy = parseFeatureProjectionV2(this.currentProjection)
    if (!copy) throw new Error('Current Feature Projection is invalid.')
    return copy
  }

  resolve(ref: unknown): ResolvedFeatureCandidate | null {
    if (this.closed || !isFeatureRef(ref)) return null
    const candidate = this.currentFeatures.get(refKey(ref))
    return candidate ? structuredClone(candidate) : null
  }

  /** Coalesces concurrent invalidations and discards any snapshot made stale during derivation. */
  refresh(): Promise<FeatureProjectionV2> {
    if (this.closed) return Promise.reject(new Error('Feature Registry is closed.'))
    this.refreshRequested = true
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.runRefreshLoop().finally(() => {
        this.refreshInFlight = null
        if (this.refreshRequested && !this.closed) void this.refresh().catch(() => undefined)
      })
    }
    return this.refreshInFlight
  }

  private async runRefreshLoop(): Promise<FeatureProjectionV2> {
    while (this.refreshRequested && !this.closed) {
      this.refreshRequested = false
      const declarative = await this.deps.listDeclarativeFeatures()
      if (this.refreshRequested || this.closed) continue

      const candidates: ResolvedFeatureCandidate[] = declarative.map(item => structuredClone(item))
      if (this.deps.isTranslationEnabled()) {
        candidates.push({ pluginName: '翻译', feature: structuredClone(BUILTIN_TRANSLATION_FEATURE) })
      }
      candidates.sort((left, right) => compareOrdinal(left.feature.ref.pluginId, right.feature.ref.pluginId)
        || compareOrdinal(left.feature.ref.featureId, right.feature.ref.featureId))

      const nextFeatures = new Map<string, ResolvedFeatureCandidate>()
      for (const candidate of candidates) {
        if (!isFeatureRef(candidate.feature.ref)) throw new Error('Feature Registry received an invalid FeatureRef.')
        const key = refKey(candidate.feature.ref)
        if (nextFeatures.has(key)) throw new Error(`Duplicate FeatureRef in derived registry: ${candidate.feature.ref.pluginId}/${candidate.feature.ref.featureId}`)
        nextFeatures.set(key, candidate)
      }

      const rows = candidates.map(toProjectionRow)
      const provisional = parseFeatureProjectionV2({
        projectionVersion: 2,
        hostSessionId: this.sessionId,
        revision: this.revision,
        generatedAtUnixMs: (this.deps.now ?? Date.now)(),
        features: rows,
      })
      if (!provisional) throw new Error('Feature Projection v2 is invalid or exceeds its contract bounds.')
      const candidateIdentity = featureProjectionContentIdentity(provisional)
      const nextRevision = candidateIdentity === this.lastContentIdentity ? this.revision : this.revision + 1
      if (!Number.isSafeInteger(nextRevision)) throw new Error('Feature Registry revision capacity exceeded.')
      const projection = nextRevision === this.revision
        ? provisional
        : parseFeatureProjectionV2({ ...provisional, revision: nextRevision })
      if (!projection) throw new Error('Feature Projection v2 is invalid or exceeds its contract bounds.')
      if (this.refreshRequested || this.closed) continue

      this.revision = nextRevision
      this.lastContentIdentity = featureProjectionContentIdentity(projection)
      this.currentProjection = projection
      this.currentFeatures = nextFeatures
    }
    return this.snapshot()
  }

  close(): void {
    this.closed = true
    this.refreshRequested = false
    this.currentFeatures.clear()
  }
}
