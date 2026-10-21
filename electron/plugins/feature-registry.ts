import { randomUUID } from 'node:crypto'
import {
  featureProjectionContentIdentity,
  isFeatureRef,
  parseFeatureProjectionV2,
  type FeatureProjectionRowV2,
  type FeatureProjectionV2,
  type FeatureRef,
  FEATURE_PROJECTION_MAX_FEATURES,
  FEATURE_PROJECTION_MAX_BYTES,
  normalizeFeatureText,
} from '../../src/shared/feature-contracts.ts'
import { BUILTIN_TRANSLATION_FEATURE, type DeclarativeFeatureCandidate, type MainResolvedFeature } from './feature-contracts.ts'

export interface FeatureRegistryDependencies {
  listDeclarativeFeatures(): Promise<readonly DeclarativeFeatureCandidate[]>
  listRuntimeFeatures?(): Promise<readonly ResolvedFeatureCandidate[]>
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
  if (feature.sourceKind === 'runtime-v3') {
    const commands = [...new Map(feature.commands.map(command => normalizeFeatureText(command, 48)).filter((value): value is string => value !== null)
      .map(command => [command.toLocaleLowerCase('en-US'), command] as const)).values()]
    const description = normalizeFeatureText(feature.description, 240)
    return {
      ref: { ...feature.ref }, pluginName: normalizeFeatureText(candidate.pluginName, 80) ?? feature.ref.pluginId.slice(0, 80),
      title: normalizeFeatureText(feature.title, 80) ?? feature.ref.featureId, commands,
      acceptedContexts: structuredClone(feature.acceptedContexts), iconToken: feature.iconToken,
      featureKind: 'runtime-v3', group: 'plugin-features', presentation: feature.presentation,
      ...(description ? { description } : {}),
      ...(feature.iconDataUrl ? { iconDataUrl: feature.iconDataUrl } : {}),
    }
  }
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
      acceptedContexts: [{ type: 'text', sources: ['selected-text'] }, { type: 'none', sources: [] }],
      iconToken: 'translate',
      // Built-in Translation keeps its existing Manager handoff; selection is
      // explicitly accepted without migrating it to Manifest v3.
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

  snapshot(launcherSurfaces = true, superPanel = true, selectedTextMatching = true): FeatureProjectionV2 {
    const supported = selectedTextMatching ? this.currentProjection : { ...this.currentProjection,
      features: this.currentProjection.features.filter(row => !row.acceptedContexts.some(rule => rule.textMatch !== undefined)) }
    const value = launcherSurfaces ? supported : { ...supported,
      features: supported.features.filter(row => row.featureKind !== 'runtime-v3').map(({ description: _description, presentation: _presentation, iconDataUrl: _icon, ...row }) => row) }
    const compatible = superPanel ? value : { ...value, features: value.features.map(row => ({ ...row,
      acceptedContexts: row.acceptedContexts.filter(item => item.type === 'text').map(item => ({ type: 'text' as const,
        sources: item.sources.filter(source => source === 'launcher-input' || source === 'clipboard') })).filter(item => item.sources.length > 0).slice(0, 1) })) }
    const copy = parseFeatureProjectionV2(compatible)
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
      const runtime = await this.deps.listRuntimeFeatures?.() ?? []
      if (this.refreshRequested || this.closed) continue

      const candidates: ResolvedFeatureCandidate[] = [...declarative, ...runtime].map(item => structuredClone(item))
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

      // Keep the existing bounded discovery cache useful even with many packages.
      // Optional image payloads are dropped before omitting metadata-only rows.
      let remainingBytes = FEATURE_PROJECTION_MAX_BYTES - 1024
      const rows: FeatureProjectionRowV2[] = []
      const projectionCandidates = [...candidates].sort((left, right) => Number(right.feature.sourceKind === 'built-in') - Number(left.feature.sourceKind === 'built-in'))
      for (const candidate of projectionCandidates) {
        if (rows.length >= FEATURE_PROJECTION_MAX_FEATURES) break
        let row = toProjectionRow(candidate)
        let bytes = new TextEncoder().encode(JSON.stringify(row)).byteLength + 1
        if (bytes > remainingBytes && row.iconDataUrl) {
          const { iconDataUrl: _icon, ...withoutIcon } = row; row = withoutIcon
          bytes = new TextEncoder().encode(JSON.stringify(row)).byteLength + 1
        }
        if (bytes > remainingBytes) continue
        rows.push(row); remainingBytes -= bytes
      }
      rows.sort((left, right) => compareOrdinal(left.ref.pluginId, right.ref.pluginId) || compareOrdinal(left.ref.featureId, right.ref.featureId))
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
