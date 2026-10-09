import { createHash, randomUUID } from 'node:crypto'
import { open, readdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { PLUGIN_CAPABILITIES, type InstalledPluginCapability, type PluginAIReviewDTO, type PluginActionResult, type PluginInstallResult, type PluginInvokeRequest, type PluginPageDTO, type PluginSummary, type PluginVersionChange } from '../../src/shared/plugin-contracts.ts'
import { LIMITS, boundedString, compareVersions, opaqueKey, record, validPluginId, versionParts } from './manifest.ts'
import { ManagedFs, SerialQueue } from './managed-fs.ts'
import { PluginRegistry, WEB_GRANTABLE_CAPABILITIES, type PluginRecord, type RegistryData, type InstalledVersion } from './plugin-registry.ts'
import { PluginStore } from './plugin-store.ts'
import { validateIncomingPackage, validatePackage, validateWebPackageForRuntime, type ValidatedPackage } from './package-validator.ts'
import type { ValidatedWebPackageSnapshot } from './validated-web-package-snapshot.ts'
import { createWebFeatureAuthority, IMPLEMENTED_WEB_CAPABILITIES, type WebFeatureAuthority } from './web-feature-authority.ts'
import { DeclarativeRuntime } from './declarative-runtime.ts'
import { adaptDeclarativeV1Feature, DECLARATIVE_V1_FEATURE_ID } from './declarative-feature-adapter.ts'
import type { DeclarativeFeatureCandidate } from './feature-contracts.ts'
import { isFeatureRef, type FeatureRef } from '../../src/shared/feature-contracts.ts'
import { PermissionBroker, providerIdentity, validateActionInput, type PluginConsent, type PluginHostEffects, type PluginProviderInfo } from './permission-broker.ts'
import { fail, safePluginError } from './errors.ts'

export interface PluginManagerDependencies extends PluginHostEffects { userData: string; hostVersion: string; pngDecoder?: (bytes: Buffer) => boolean; now?: () => number }
interface PendingAIReview { reviewId: string; pluginId: string; session: string; runtime: DeclarativeRuntime; version: string; hash: string; actionId: string; input: unknown; digest: string; provider: PluginProviderInfo; expiresAt: number; generation: number }
function digestReview(actionId: string, input: unknown): string { return createHash('sha256').update(JSON.stringify({ actionId, input })).digest('hex') }
export class PluginManager {
  readonly fs: ManagedFs
  readonly registry: PluginRegistry
  readonly store: PluginStore
  private readonly deps: PluginManagerDependencies
  private readonly broker: PermissionBroker
  private readonly queue = new SerialQueue()
  private data: RegistryData = { registryVersion: 1, plugins: [] }
  private readonly runtimes = new Map<string, DeclarativeRuntime>()
  private readonly webAuthorities = new Map<string, Set<WebFeatureAuthority>>()
  private readonly webFeatureMetadata = new Map<string, ValidatedWebPackageSnapshot['manifest']['features']>()
  private readonly intents = new Map<string, { generation: number; blocked: boolean }>()
  private readonly pendingAIReviews = new Map<string, PendingAIReview>()
  private readonly featureAuthorityListeners = new Set<() => void>()
  private readonly reviewGenerations = new Map<string, number>()
  private readonly preparingAIReviews = new Map<string, number>()
  private reviewExpiryTimer: ReturnType<typeof setTimeout> | undefined
  private intentGeneration = 0
  private currentSession = randomUUID()
  private closed = false
  constructor(deps: PluginManagerDependencies) {
    this.deps = deps; this.fs = new ManagedFs(join(deps.userData, 'plugins')); this.registry = new PluginRegistry(this.fs); this.store = new PluginStore(this.fs); this.broker = new PermissionBroker(deps)
  }
  get session(): string { return this.currentSession }
  isWebPackage(id: string): boolean { return this.data.plugins.some(p => p.id === id && p.manifestVersion === 2) }
  isSession(session: string): boolean { return !this.closed && session === this.currentSession }
  private assertSession(session: string): void { if (!this.isSession(session)) fail('SESSION_EXPIRED') }
  private find(id: unknown): PluginRecord { if (!validPluginId(id)) fail('INVALID_INPUT'); const p = this.data.plugins.find(p => p.id === id); if (!p) fail('NOT_INSTALLED'); return p }
  private packageLogical(id: string, identity: InstalledVersion): string { if (!validPluginId(id)) fail('INVALID_INPUT'); versionParts(identity.version); if (!/^[a-f0-9]{64}$/.test(identity.hash)) fail('INVALID_INPUT'); return `packages/${id}/${identity.version}/${identity.hash}.wtplugin` }
  private async load(p: PluginRecord): Promise<ValidatedPackage> {
    if (p.manifestVersion === 2) fail('INCOMPATIBLE_PLUGIN')
    const bytes = await this.fs.read(this.packageLogical(p.id, p.current), LIMITS.archive)
    if (createHash('sha256').update(bytes).digest('hex') !== p.current.hash) fail('INTEGRITY_FAILED')
    const pkg = await validatePackage(bytes, this.deps.hostVersion, this.deps.pngDecoder)
    if (pkg.manifest.id !== p.id || pkg.manifest.version !== p.current.version) fail('INTEGRITY_FAILED')
    return pkg
  }
  private async loadWeb(p: PluginRecord): Promise<ValidatedWebPackageSnapshot> {
    if (p.manifestVersion !== 2) fail('INCOMPATIBLE_PLUGIN')
    const bytes = await this.fs.read(this.packageLogical(p.id, p.current), LIMITS.archive)
    const snapshot = await validateWebPackageForRuntime(bytes, this.deps.hostVersion)
    if (snapshot.packageHash !== p.current.hash || snapshot.manifest.id !== p.id || snapshot.manifest.version !== p.current.version
      || JSON.stringify(snapshot.manifest.requestedCapabilities) !== JSON.stringify(p.requested)) fail('INTEGRITY_FAILED')
    return snapshot
  }
  private loadInstalled(p: PluginRecord): Promise<ValidatedPackage | ValidatedWebPackageSnapshot> {
    return p.manifestVersion === 2 ? this.loadWeb(p) : this.load(p)
  }
  subscribeFeatureAuthorityChanged(listener: () => void): () => void {
    if (this.closed || typeof listener !== 'function') return () => undefined
    this.featureAuthorityListeners.add(listener)
    return () => { this.featureAuthorityListeners.delete(listener) }
  }
  private notifyFeatureAuthorityChanged(): void {
    for (const listener of [...this.featureAuthorityListeners]) {
      try { listener() } catch (error) { console.error('[plugins] Feature authority listener failed.', error) }
    }
  }
  private stop(id: string): void {
    this.invalidateAIReview(id); this.runtimes.get(id)?.stop(); this.runtimes.delete(id)
    for (const authority of [...(this.webAuthorities.get(id) ?? [])]) authority.revoke()
  }
  private beginIntent(id: string, stop: boolean): number {
    this.invalidateAIReview(id)
    const generation = ++this.intentGeneration
    const blocked = stop || Boolean(this.intents.get(id)?.blocked)
    this.intents.set(id, { generation, blocked }); if (blocked) this.stop(id)
    return generation
  }
  private finishIntent(id: string, generation: number): void {
    if (this.intents.get(id)?.generation === generation) this.intents.delete(id)
  }
  private invalidateAIReview(id: string): void {
    this.pendingAIReviews.delete(id)
    if ((this.preparingAIReviews.get(id) ?? 0) > 0) this.reviewGenerations.set(id, (this.reviewGenerations.get(id) ?? 0) + 1)
    else this.reviewGenerations.delete(id)
    this.scheduleAIReviewExpiry()
  }
  private beginAIReviewPreparation(id: string): number {
    this.invalidateAIReview(id)
    this.preparingAIReviews.set(id, (this.preparingAIReviews.get(id) ?? 0) + 1)
    const generation = this.reviewGenerations.get(id) ?? 0
    this.reviewGenerations.set(id, generation)
    return generation
  }
  private endAIReviewPreparation(id: string): void {
    const remaining = (this.preparingAIReviews.get(id) ?? 1) - 1
    if (remaining > 0) this.preparingAIReviews.set(id, remaining)
    else {
      this.preparingAIReviews.delete(id)
      if (!this.pendingAIReviews.has(id)) this.reviewGenerations.delete(id)
    }
  }
  private clearAIReviews(): void {
    this.pendingAIReviews.clear()
    for (const id of this.reviewGenerations.keys()) {
      if ((this.preparingAIReviews.get(id) ?? 0) > 0) this.reviewGenerations.set(id, (this.reviewGenerations.get(id) ?? 0) + 1)
      else this.reviewGenerations.delete(id)
    }
    if (this.reviewExpiryTimer) clearTimeout(this.reviewExpiryTimer)
    this.reviewExpiryTimer = undefined
  }
  private scheduleAIReviewExpiry(): void {
    if (this.reviewExpiryTimer) clearTimeout(this.reviewExpiryTimer)
    this.reviewExpiryTimer = undefined
    if (this.closed || this.pendingAIReviews.size === 0) return
    const earliest = Math.min(...[...this.pendingAIReviews.values()].map(review => review.expiresAt))
    const delay = Math.max(0, earliest - (this.deps.now?.() ?? Date.now()))
    this.reviewExpiryTimer = setTimeout(() => {
      this.reviewExpiryTimer = undefined
      const now = this.deps.now?.() ?? Date.now()
      for (const [id, review] of this.pendingAIReviews) {
        if (review.expiresAt <= now) {
          this.pendingAIReviews.delete(id)
          if ((this.preparingAIReviews.get(id) ?? 0) > 0) this.reviewGenerations.set(id, (this.reviewGenerations.get(id) ?? 0) + 1)
          else this.reviewGenerations.delete(id)
        }
      }
      this.scheduleAIReviewExpiry()
    }, delay)
    this.reviewExpiryTimer.unref?.()
  }
  private activate(p: PluginRecord, pkg: ValidatedPackage): void {
    this.stop(p.id)
    if (this.intents.get(p.id)?.blocked) { p.status = 'stopping'; return }
    if (!p.enabled) { p.status = 'installed-disabled'; return }
    if (pkg.manifest.requestedCapabilities.some(cap => !p.granted.includes(cap))) { p.status = 'needs-permission'; return }
    p.status = 'active'; this.runtimes.set(p.id, new DeclarativeRuntime(pkg.manifest, pkg.hash, pkg.assets))
  }
  private activateInstalled(p: PluginRecord, pkg: ValidatedPackage | ValidatedWebPackageSnapshot): void {
    if (!('packageHash' in pkg)) { this.webFeatureMetadata.delete(p.id); this.activate(p, pkg); return }
    this.webFeatureMetadata.set(p.id, pkg.manifest.features)
    this.stop(p.id)
    if (this.intents.get(p.id)?.blocked) { p.status = 'stopping'; return }
    if (pkg.manifest.network.mode !== 'none') { p.enabled = false; p.status = 'incompatible'; return }
    p.status = !p.enabled ? 'installed-disabled' : p.requested.some(cap => !p.granted.includes(cap)) ? 'needs-permission' : 'active'
  }
  async initialize(): Promise<void> {
    await this.fs.initialize()
    // Staging is exclusively host-owned; unsafe entries abort initialization, never follow links.
    for (const name of await readdir(await this.fs.path('staging'))) await this.fs.remove(await this.fs.path('staging', name))
    const saved = await this.registry.load(); const recovered = await this.recover()
    this.data = saved ?? recovered
    if (saved) {
      for (const orphan of recovered.plugins) {
        const existing = saved.plugins.find(p => p.id === orphan.id)
        if (!existing) saved.plugins.push(orphan)
        else for (const identity of orphan.versions) {
          if (!existing.versions.some(v => v.version === identity.version && v.hash === identity.hash)) existing.versions.push(identity)
        }
      }
    }
    for (const p of this.data.plugins) {
      try { const pkg = await this.loadInstalled(p); if (!('packageHash' in pkg)) await this.store.readConfig(pkg.manifest); p.name = pkg.manifest.name; p.description = pkg.manifest.description; p.author = structuredClone(pkg.manifest.author); p.api = structuredClone(pkg.manifest.api); p.source = 'local-unsigned'; p.requested = [...pkg.manifest.requestedCapabilities]; p.granted = p.granted.filter(cap => p.requested.includes(cap)); if (p.errorCode !== 'REGISTRY_RECOVERED') delete p.errorCode; this.activateInstalled(p, pkg) }
      catch (error) { p.enabled = false; p.granted = []; p.status = safePluginError(error).code === 'INCOMPATIBLE_PLUGIN' ? 'incompatible' : 'invalid'; p.errorCode = safePluginError(error).code; this.stop(p.id) }
    }
    await this.registry.save(this.data)
    this.notifyFeatureAuthorityChanged()
  }
  private async recover(): Promise<RegistryData> {
    const groups = new Map<string, Array<{ name: string; description: string; author: { name: string; url?: string }; api: { apiMajor: 1; minHostVersion: string }; requested: InstalledPluginCapability[]; identity: InstalledVersion; manifestVersion: 1 | 2 }>>()
    for (const id of await readdir(await this.fs.path('packages'))) {
      if (!validPluginId(id)) continue
      const idPath = await this.fs.path('packages', id)
      for (const version of await readdir(idPath)) {
        try { versionParts(version) } catch { continue }
        for (const file of await readdir(await this.fs.path('packages', id, version))) {
          if (!/^[a-f0-9]{64}\.wtplugin$/.test(file)) continue
          try {
            const hash = file.slice(0, 64); const identity = { version, hash }
            const bytes = await this.fs.read(this.packageLogical(id, identity), LIMITS.archive)
            if (createHash('sha256').update(bytes).digest('hex') !== hash) fail('INTEGRITY_FAILED')
            const { package: pkg } = await validateIncomingPackage(bytes, this.deps.hostVersion, this.deps.pngDecoder)
            if (pkg.manifest.id !== id || pkg.manifest.version !== version) fail('INTEGRITY_FAILED')
            const list = groups.get(id) ?? []; list.push({ name: pkg.manifest.name, description: pkg.manifest.description, author: structuredClone(pkg.manifest.author), api: structuredClone(pkg.manifest.api), requested: [...pkg.manifest.requestedCapabilities], identity, manifestVersion: pkg.manifest.manifestVersion }); groups.set(id, list)
          } catch (error) { if (safePluginError(error).code === 'UNSAFE_PATH') throw error }
        }
      }
    }
    return { registryVersion: 1, plugins: [...groups].map(([id, versions]) => {
      versions.sort((a, b) => compareVersions(b.identity.version, a.identity.version) || a.identity.hash.localeCompare(b.identity.hash))
      const current = versions[0]
      return { id, name: current.name, description: current.description, author: current.author, api: current.api, source: 'local-unsigned', manifestVersion: current.manifestVersion, requested: current.requested, current: current.identity, versions: versions.map(v => v.identity), enabled: false, granted: [], status: 'installed-disabled', errorCode: 'REGISTRY_RECOVERED' }
    }) }
  }
  async list(): Promise<PluginSummary[]> {
    return this.data.plugins.map(p => ({ id: p.id, name: p.name, version: p.current.version, hash: p.current.hash, manifestVersion: p.manifestVersion ?? 1, enabled: p.enabled, status: this.intents.get(p.id)?.blocked ? 'stopping' : this.runtimes.get(p.id)?.invoking ? 'invoking' : p.status, requested: p.requested.slice(), granted: p.granted.slice(), installedVersions: [...new Set(p.versions.map(v => v.version))], source: 'local-unsigned', ...(p.manifestVersion === 2 ? { webFeatures: this.presentWebFeatures(p) } : {}), ...(p.description !== undefined ? { description: p.description } : {}), ...(p.author ? { author: structuredClone(p.author) } : {}), ...(p.api ? { api: structuredClone(p.api) } : {}), ...(this.runtimes.get(p.id)?.iconDataUrl ? { iconDataUrl: this.runtimes.get(p.id)?.iconDataUrl } : {}), ...(p.errorCode ? { errorCode: p.errorCode } : {}) }))
  }
  private presentWebFeatures(p: PluginRecord): NonNullable<PluginSummary['webFeatures']> {
    return (this.webFeatureMetadata.get(p.id) ?? []).map(feature => ({ id: feature.id, title: feature.title,
      available: p.enabled && !this.intents.get(p.id)?.blocked && !['invalid', 'incompatible', 'faulted'].includes(p.status)
        && feature.requiredCapabilities.every(cap => IMPLEMENTED_WEB_CAPABILITIES.includes(cap) && p.requested.includes(cap) && p.granted.includes(cap)) }))
  }
  /** Returns only safe Main-owned metadata for currently eligible v1 page Features. */
  async listFeatureCandidates(): Promise<DeclarativeFeatureCandidate[]> {
    const session = this.session
    return this.queue.run(async () => {
      this.assertSession(session)
      const candidates: DeclarativeFeatureCandidate[] = []
      for (const plugin of this.data.plugins) {
        if (plugin.manifestVersion === 2 || !plugin.enabled || !plugin.requested.includes('manager.page') || !plugin.granted.includes('manager.page')) continue
        let pkg: ValidatedPackage
        try { pkg = await this.load(plugin) } catch { continue }
        this.assertSession(session)
        if (!pkg.manifest.requestedCapabilities.includes('manager.page')) continue
        const feature = adaptDeclarativeV1Feature(pkg.manifest)
        if (!feature) continue
        candidates.push({ pluginName: pkg.manifest.name, feature: structuredClone(feature) })
      }
      this.assertSession(session)
      return candidates
    })
  }
  /**
   * Revalidates a v1 compatibility Feature inside the existing mutation queue, then
   * synchronously hands the resolved route to Main-owned dispatch before releasing
   * the queue. The returned completion is deliberately not awaited under the queue.
   */
  async authorizeAndDispatchFeature(
    ref: FeatureRef,
    session: string,
    dispatch: (feature: NonNullable<ReturnType<typeof adaptDeclarativeV1Feature>>) => Promise<void>,
  ): Promise<{ completion: Promise<void> }> {
    if (!isFeatureRef(ref) || ref.featureId !== DECLARATIVE_V1_FEATURE_ID || typeof dispatch !== 'function') fail('INVALID_INPUT')
    return this.queue.run(async () => {
      this.assertSession(session)
      const plugin = this.find(ref.pluginId)
      const runtime = this.runtimes.get(plugin.id)
      if (!runtime || !this.isSession(session) || this.intents.get(plugin.id)?.blocked
        || !plugin.enabled || plugin.current.hash !== runtime.hash) fail('PLUGIN_DISABLED')
      this.broker.enforce(runtime.manifest.requestedCapabilities, plugin.granted, 'manager.page', true)
      if (plugin.status !== 'active') fail('PLUGIN_DISABLED')

      // load() re-reads the current immutable package by its recorded content hash.
      // Mutations that block immediately are rechecked after this await, before the
      // synchronous dispatch callback establishes the queue's linearization point.
      const pkg = await this.load(plugin)
      this.assertSession(session)
      const currentPlugin = this.find(ref.pluginId)
      if (currentPlugin.current.version !== plugin.current.version || currentPlugin.current.hash !== plugin.current.hash
        || !this.isSession(session) || this.intents.get(currentPlugin.id)?.blocked
        || !currentPlugin.enabled || this.runtimes.get(currentPlugin.id) !== runtime) fail('PLUGIN_DISABLED')
      this.broker.enforce(pkg.manifest.requestedCapabilities, currentPlugin.granted, 'manager.page', true)
      if (currentPlugin.status !== 'active') fail('PLUGIN_DISABLED')
      const feature = adaptDeclarativeV1Feature(pkg.manifest)
      if (!feature || feature.ref.pluginId !== ref.pluginId || feature.ref.featureId !== ref.featureId
        || feature.sourceKind !== 'declarative' || feature.resolvedEntry.kind !== 'declarative-compatibility') fail('ACTION_NOT_DECLARED')
      if (!pkg.manifest.pages.some(page => page.id === feature.resolvedEntry.pageId)) fail('ACTION_NOT_DECLARED')
      if (!this.isSession(session) || this.intents.get(currentPlugin.id)?.blocked
        || !currentPlugin.enabled || currentPlugin.status !== 'active'
        || this.runtimes.get(currentPlugin.id) !== runtime) fail('PLUGIN_DISABLED')

      const completion = dispatch(structuredClone(feature))
      return { completion: Promise.resolve(completion) }
    })
  }
  private async summary(id: string): Promise<PluginSummary> { return (await this.list()).find(p => p.id === id)! }
  /** Installs produce no runtime privilege. Only this live Main-side resolution can issue a ticket. */
  async authorizeWebFeature(ref: FeatureRef, session: string,
    dispatch: (authority: WebFeatureAuthority) => Promise<void>): Promise<{ completion: Promise<void> }> {
    if (!isFeatureRef(ref) || typeof dispatch !== 'function') fail('INVALID_INPUT')
    return this.queue.run(async () => {
      this.assertSession(session)
      const p = this.find(ref.pluginId)
      if (p.manifestVersion !== 2 || !p.enabled || this.intents.get(p.id)?.blocked || ['invalid', 'incompatible', 'faulted'].includes(p.status)) fail('PLUGIN_DISABLED')
      const snapshot = await this.loadWeb(p)
      this.assertSession(session)
      const feature = snapshot.manifest.features.find(f => f.id === ref.featureId)
      if (!feature) fail('ACTION_NOT_DECLARED')
      if (snapshot.manifest.network.mode !== 'none') fail('INCOMPATIBLE_PLUGIN')
      const current = (capability?: import('../../plugin-sdk/declarative-v1/runtime/manifest-v2.mjs').CapabilityV2): boolean => {
        const row = this.data.plugins.find(item => item.id === p.id)
        return this.isSession(session) && row === p && row.manifestVersion === 2 && row.enabled
          && !this.intents.get(row.id)?.blocked && !['invalid', 'incompatible', 'faulted'].includes(row.status)
          && row.current.hash === snapshot.packageHash && row.current.version === snapshot.manifest.version
          && feature.requiredCapabilities.every(cap => IMPLEMENTED_WEB_CAPABILITIES.includes(cap) && row.requested.includes(cap) && row.granted.includes(cap))
          && (!capability || IMPLEMENTED_WEB_CAPABILITIES.includes(capability) && feature.requiredCapabilities.includes(capability)
            && row.requested.includes(capability) && row.granted.includes(capability))
      }
      if (!current()) fail('PERMISSION_DENIED')
      const tickets = this.webAuthorities.get(p.id) ?? new Set<WebFeatureAuthority>()
      let authority: WebFeatureAuthority
      authority = createWebFeatureAuthority(snapshot, ref.featureId, current, () => {
        tickets.delete(authority); if (!tickets.size) this.webAuthorities.delete(p.id)
      })
      tickets.add(authority); this.webAuthorities.set(p.id, tickets)
      let completion: Promise<void>
      try { completion = Promise.resolve(dispatch(authority)).catch(error => { authority.revoke(); throw error }) }
      catch (error) { authority.revoke(); throw error }
      return { completion }
    })
  }
  private async confirm(request: PluginConsent, session: string): Promise<boolean> { this.assertSession(session); const accepted = await this.deps.confirm(request); this.assertSession(session); return accepted }
  async install(bytes: Uint8Array, session: string): Promise<PluginInstallResult> {
    const archiveBytes = Buffer.from(bytes) // Own bytes before the first asynchronous validation boundary.
    return this.queue.run(async () => {
      this.assertSession(session)
      const incoming = await validateIncomingPackage(archiveBytes, this.deps.hostVersion, this.deps.pngDecoder); this.assertSession(session)
      const pkg = incoming.package
      const installedPackage = incoming.kind === 'v1' ? incoming.package : await validateWebPackageForRuntime(archiveBytes, this.deps.hostVersion)
      this.assertSession(session)
      const requested: InstalledPluginCapability[] = [...pkg.manifest.requestedCapabilities]
      const m = pkg.manifest; const old = this.data.plugins.find(p => p.id === m.id); this.invalidateAIReview(m.id)
      if (old?.current.version === m.version && old.current.hash === pkg.hash) { await this.loadInstalled(old); return { outcome: 'already-installed', plugin: await this.summary(m.id) } }
      const expected = old ? { version: old.current.version, hash: old.current.hash, enabled: old.enabled } : undefined
      // Once an installed replacement is identified, revoke before any confirmation can wait.
      const replacementIntent = old ? this.beginIntent(m.id, true) : undefined
      const targetCurrent = () => this.isSession(session) && (old && expected
        ? this.data.plugins.find(p => p.id === m.id) === old && old.current.version === expected.version
          && old.current.hash === expected.hash && old.enabled === expected.enabled
          && this.intents.get(m.id)?.generation === replacementIntent
        : !this.data.plugins.some(p => p.id === m.id))
      const assertTarget = () => { this.assertSession(session); if (!targetCurrent()) fail('INTENT_SUPERSEDED') }
      try {
        const conflict = old?.versions.some(v => v.version === m.version && v.hash !== pkg.hash)
        const comparison = old ? compareVersions(m.version, old.current.version) : 1
        const downgrade = comparison < 0
        const versionChange: PluginVersionChange = {
          kind: !old ? 'new-install' : comparison < 0 ? 'downgrade' : comparison === 0 ? 'same-version-replacement' : 'upgrade',
          ...(old ? { currentVersion: old.current.version } : {}),
          incomingVersion: m.version,
          addedCapabilities: requested.filter(capability => !old?.requested.includes(capability)),
          removedCapabilities: old?.requested.filter(capability => !requested.includes(capability)) ?? [],
          reauthorizationRequired: Boolean(old && ((old.manifestVersion ?? 1) !== m.manifestVersion || requested.some(capability => !old.granted.includes(capability)))),
        }
        const prompt = { pluginId: m.id, name: m.name, version: m.version, capabilities: requested, versionChange, manifestVersion: m.manifestVersion }
        const confirmationKinds: Array<'install' | 'replace' | 'downgrade'> = ['install']
        if (conflict) confirmationKinds.push('replace')
        if (downgrade) confirmationKinds.push('downgrade')
        for (const kind of confirmationKinds) {
          const accepted = await this.confirm({ ...prompt, kind }, session)
          assertTarget(); if (!accepted) return { outcome: 'cancelled' }
        }
        if (old) { await this.loadInstalled(old); assertTarget() }
        if (incoming.kind === 'v1') { try { await this.store.readConfig(incoming.package.manifest) } catch { fail('CONFIG_INCOMPATIBLE') } }
        assertTarget()
        if (!old && this.data.plugins.length >= 1000) fail('STORAGE_LIMIT')
        const identity = { version: m.version, hash: pkg.hash }
        const p: PluginRecord = { id: m.id, name: m.name, description: m.description, author: structuredClone(m.author), api: structuredClone(m.api), source: 'local-unsigned', manifestVersion: m.manifestVersion, requested, current: identity, versions: old ? old.versions.slice() : [], enabled: old?.enabled ?? false, granted: (old?.manifestVersion ?? 1) === m.manifestVersion ? old?.granted.filter(cap => requested.includes(cap) && (m.manifestVersion !== 2 || cap !== 'network.domains')) ?? [] : [], status: 'installed-disabled' }
        if (!p.versions.some(v => v.version === m.version && v.hash === pkg.hash)) p.versions.push(identity)
        p.status = p.enabled ? requested.some(cap => !p.granted.includes(cap)) ? 'needs-permission' : 'active' : 'installed-disabled'
        if ('packageHash' in installedPackage && installedPackage.manifest.network.mode !== 'none') { p.enabled = false; p.status = 'incompatible' }
        const next = { registryVersion: 1 as const, plugins: [...this.data.plugins.filter(item => item.id !== m.id), p] }
        const staging = await this.fs.path('staging', `${randomUUID()}.wtplugin`); const destinationLogical = this.packageLogical(m.id, identity)
        let created = false
        try {
          assertTarget()
          const file = await open(staging, 'wx'); try { await file.writeFile(archiveBytes); await file.sync() } finally { await file.close() }
          await this.fs.mkdir(`packages/${m.id}/${m.version}`); const destination = await this.fs.path(destinationLogical)
          try {
            const existing = await this.fs.read(destinationLogical, LIMITS.archive)
            if (createHash('sha256').update(existing).digest('hex') !== pkg.hash) fail('INTEGRITY_FAILED')
          } catch (error) {
            if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error
            assertTarget(); await rename(staging, destination); created = true
          }
          if (old) { await this.store.flush(); if (incoming.kind === 'v1') await this.store.readConfig(incoming.package.manifest) }
          await this.registry.save(next, targetCurrent)
          if (replacementIntent !== undefined) this.finishIntent(m.id, replacementIntent)
          this.data = next; if (this.isSession(session)) this.activateInstalled(p, installedPackage)
          this.notifyFeatureAuthorityChanged()
          return { outcome: 'installed', plugin: await this.summary(m.id), change: versionChange }
        } catch (error) {
          if (created) await this.fs.remove(await this.fs.path(destinationLogical))
          // Preserve the existing v1 failed-write rollback using a newly constructed runtime, never Web tickets.
          if (old && old.manifestVersion !== 2 && replacementIntent !== undefined && targetCurrent()) {
            try {
              const previous = await this.loadInstalled(old); assertTarget()
              this.finishIntent(m.id, replacementIntent); this.activateInstalled(old, previous)
            } catch { /* Leave the old installation unavailable when rollback cannot be verified. */ }
          }
          throw error
        } finally { await this.fs.remove(staging) }
      } finally {
        if (replacementIntent !== undefined && this.intents.get(m.id)?.generation === replacementIntent) {
          this.finishIntent(m.id, replacementIntent); this.notifyFeatureAuthorityChanged()
        }
      }
    })
  }
  async setEnabled(id: string, enabled: boolean, session: string): Promise<PluginSummary> {
    this.assertSession(session); if (typeof enabled !== 'boolean') fail('INVALID_INPUT')
    this.find(id); const intent = this.beginIntent(id, !enabled)
    return this.queue.run(async () => {
      this.assertSession(session); const old = this.find(id); const p = structuredClone(old)
      if (!enabled) { this.stop(id); p.enabled = false; p.status = 'installed-disabled'; await this.store.flush() }
      else {
        const pkg = await this.loadInstalled(p); if (!('packageHash' in pkg)) await this.store.readConfig(pkg.manifest)
        else if (pkg.manifest.network.mode !== 'none') fail('INCOMPATIBLE_PLUGIN')
        const missing = pkg.manifest.requestedCapabilities.filter(cap => !p.granted.includes(cap))
        if (missing.length && !await this.confirm({ kind: 'grant', pluginId: id, name: p.name, version: p.current.version, capabilities: missing, manifestVersion: p.manifestVersion }, session)) return this.summary(id)
        p.granted = [...pkg.manifest.requestedCapabilities]; p.enabled = true; p.status = 'active'; delete p.errorCode
        const next = { registryVersion: 1 as const, plugins: this.data.plugins.map(item => item.id === id ? p : item) }
        await this.registry.save(next, () => this.isSession(session)); this.data = next; this.finishIntent(id, intent); this.activateInstalled(p, pkg); this.notifyFeatureAuthorityChanged(); return this.summary(id)
      }
      const next = { registryVersion: 1 as const, plugins: this.data.plugins.map(item => item.id === id ? p : item) }
      await this.registry.save(next, () => this.isSession(session)); this.data = next; this.finishIntent(id, intent); this.notifyFeatureAuthorityChanged(); return this.summary(id)
    })
  }
  async setGrants(id: string, grants: InstalledPluginCapability[], session: string): Promise<PluginSummary> {
    this.assertSession(session)
    const previous = this.find(id)
    if (previous.manifestVersion === 2 && Array.isArray(grants) && grants.includes('network.domains')) fail('INCOMPATIBLE_PLUGIN')
    const allowed: readonly string[] = previous.manifestVersion === 2 ? WEB_GRANTABLE_CAPABILITIES : PLUGIN_CAPABILITIES
    if (!Array.isArray(grants) || grants.length > allowed.length || grants.some(cap => !allowed.includes(cap)) || new Set(grants).size !== grants.length) fail('INVALID_INPUT')
    if (grants.some(cap => !previous.requested.includes(cap))) fail('INVALID_INPUT')
    const intent = this.beginIntent(id, previous.manifestVersion === 2 || previous.granted.some(cap => !grants.includes(cap)))
    return this.queue.run(async () => {
      this.assertSession(session); if (this.intents.get(id)?.blocked) this.stop(id); const old = this.find(id); const pkg = await this.loadInstalled(old)
      if (grants.some(cap => !(pkg.manifest.requestedCapabilities as readonly string[]).includes(cap))) fail('INVALID_INPUT')
      const added = grants.filter(cap => !old.granted.includes(cap))
      if (added.length && !await this.confirm({ kind: 'grant', pluginId: id, name: old.name, version: old.current.version, capabilities: added, manifestVersion: old.manifestVersion }, session)) { this.finishIntent(id, intent); return this.summary(id) }
      await this.store.flush(); const p = { ...structuredClone(old), granted: grants.slice() }
      p.status = p.enabled ? pkg.manifest.requestedCapabilities.some(cap => !grants.includes(cap)) ? 'needs-permission' : 'active' : 'installed-disabled'
      const next = { registryVersion: 1 as const, plugins: this.data.plugins.map(item => item.id === id ? p : item) }
      await this.registry.save(next, () => this.isSession(session)); this.data = next; this.finishIntent(id, intent); this.activateInstalled(p, pkg); this.notifyFeatureAuthorityChanged(); return this.summary(id)
    })
  }
  private current(id: string, runtime: DeclarativeRuntime, session: string): boolean { const p = this.data.plugins.find(item => item.id === id); return this.isSession(session) && !this.intents.get(id)?.blocked && this.runtimes.get(id) === runtime && Boolean(p?.enabled) && p?.current.hash === runtime.hash && p?.status === 'active' }
  async getPages(id: string, session: string): Promise<PluginPageDTO> {
    this.assertSession(session); const p = this.find(id); const runtime = this.runtimes.get(id)
    this.broker.enforce(runtime?.manifest.requestedCapabilities ?? [], p.granted, 'manager.page', Boolean(runtime && this.current(id, runtime, session)))
    await this.verifyIntegrity(p); this.assertSession(session)
    if (!runtime || !this.current(id, runtime, session)) fail('PLUGIN_DISABLED')
    const config = p.granted.includes('plugin.config.read') ? await this.store.readConfig(runtime.manifest) : undefined
    if (!this.current(id, runtime, session)) fail('PLUGIN_DISABLED')
    return runtime.pages(config)
  }
  private async verifyIntegrity(p: PluginRecord): Promise<void> {
    try { await this.load(p) } catch (error) {
      this.stop(p.id); p.enabled = false; p.status = 'invalid'; p.errorCode = safePluginError(error).code
      try { await this.queue.run(async () => this.registry.save(this.data)) }
      finally { this.notifyFeatureAuthorityChanged() }
      throw error
    }
  }
  async invoke(value: PluginInvokeRequest, session: string): Promise<PluginActionResult> {
    this.assertSession(session); const r = record(value, ['pluginId', 'version', 'hash', 'actionId', 'input']); const p = this.find(r.pluginId)
    if (r.version !== p.current.version || r.hash !== p.current.hash) fail('INTEGRITY_FAILED'); opaqueKey(r.actionId)
    const runtime = this.runtimes.get(p.id); if (!runtime || !this.current(p.id, runtime, session)) fail('PLUGIN_DISABLED')
    const action = runtime.manifest.actions.find(action => action.id === r.actionId); if (!action) fail('ACTION_NOT_DECLARED')
    this.broker.enforce(runtime.manifest.requestedCapabilities, p.granted, action.type, true)
    await this.verifyIntegrity(p)
    if (!this.current(p.id, runtime, session)) return { status: 'cancelled' }
    return runtime.invoke(action.id, r.input, this.broker, this.store, () => this.current(p.id, runtime, session))
  }
  private currentProvider(info: PluginProviderInfo): PluginProviderInfo {
    return { providerName: boundedString(info.providerName, 128), model: boundedString(info.model, 128), ...(info.identity !== undefined ? { identity: boundedString(info.identity, 8192, 0) } : {}) }
  }
  async prepareAIReview(value: PluginInvokeRequest, session: string): Promise<PluginAIReviewDTO> {
    this.assertSession(session)
    const r = record(value, ['pluginId', 'version', 'hash', 'actionId', 'input'])
    const p = this.find(r.pluginId)
    if (r.version !== p.current.version || r.hash !== p.current.hash) fail('INTEGRITY_FAILED')
    opaqueKey(r.actionId)
    const runtime = this.runtimes.get(p.id); if (!runtime || !this.current(p.id, runtime, session)) fail('PLUGIN_DISABLED')
    const action = runtime.manifest.actions.find(item => item.id === r.actionId)
    if (!action || action.type !== 'sharedAI.complete') fail('ACTION_NOT_DECLARED')
    this.broker.enforce(runtime.manifest.requestedCapabilities, p.granted, 'sharedAI.complete', true)
    const input = validateActionInput(action, r.input) as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
    const generation = this.beginAIReviewPreparation(p.id)
    try {
      await this.verifyIntegrity(p)
      const provider = this.currentProvider(await this.deps.ai.getDefaultProviderInfo())
      this.assertSession(session)
      if (generation !== (this.reviewGenerations.get(p.id) ?? 0) || !this.current(p.id, runtime, session) || p.current.version !== r.version || p.current.hash !== r.hash) fail('USER_CONFIRMATION_REQUIRED')
      const reviewId = randomUUID()
      const messages = structuredClone(input)
      const reviewedInput = { messages }
      const digest = digestReview(action.id, reviewedInput)
      const expiresAt = (this.deps.now?.() ?? Date.now()) + 120_000
      this.pendingAIReviews.set(p.id, { reviewId, pluginId: p.id, session, runtime, version: p.current.version, hash: p.current.hash, actionId: action.id, input: reviewedInput, digest, provider, expiresAt, generation })
      this.scheduleAIReviewExpiry()
      return { reviewId, pluginId: p.id, pluginName: p.name, version: p.current.version, hash: p.current.hash, actionId: action.id, messages, providerName: provider.providerName, model: provider.model, messageCount: messages.length, characterCount: messages.reduce((sum, message) => sum + message.content.length, 0) }
    } finally { this.endAIReviewPreparation(p.id) }
  }
  async confirmAIReview(value: unknown, session: string): Promise<PluginActionResult> {
    this.assertSession(session)
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) fail('INVALID_INPUT')
    const pair = [...this.pendingAIReviews.entries()].find(([, review]) => review.reviewId === value)
    if (!pair) fail('USER_CONFIRMATION_REQUIRED')
    const [pluginId, review] = pair
    this.pendingAIReviews.delete(pluginId)
    this.scheduleAIReviewExpiry()
    const generationMatches = review.generation === this.reviewGenerations.get(pluginId)
    if ((this.preparingAIReviews.get(pluginId) ?? 0) === 0) this.reviewGenerations.delete(pluginId)
    if (review.expiresAt <= (this.deps.now?.() ?? Date.now()) || review.session !== session || !generationMatches || digestReview(review.actionId, review.input) !== review.digest) fail('USER_CONFIRMATION_REQUIRED')
    const p = this.find(pluginId); const runtime = this.runtimes.get(pluginId)
    if (!runtime || runtime !== review.runtime || !this.current(pluginId, runtime, session) || p.current.version !== review.version || p.current.hash !== review.hash) fail('USER_CONFIRMATION_REQUIRED')
    const action = runtime.manifest.actions.find(item => item.id === review.actionId)
    if (!action || action.type !== 'sharedAI.complete') fail('USER_CONFIRMATION_REQUIRED')
    this.broker.enforce(runtime.manifest.requestedCapabilities, p.granted, 'sharedAI.complete', true)
    await this.verifyIntegrity(p)
    if (!this.current(pluginId, runtime, session)) fail('USER_CONFIRMATION_REQUIRED')
    const provider = this.currentProvider(await this.deps.ai.getDefaultProviderInfo())
    if (providerIdentity(provider) !== providerIdentity(review.provider) || digestReview(action.id, review.input) !== review.digest) fail('USER_CONFIRMATION_REQUIRED')
    return runtime.invoke(action.id, review.input, this.broker, this.store, () => this.current(pluginId, runtime, session), review.provider)
  }
  async cancelAIReview(value: unknown, session: string): Promise<{ cancelled: boolean }> {
    this.assertSession(session)
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) fail('INVALID_INPUT')
    const pair = [...this.pendingAIReviews.entries()].find(([, review]) => review.reviewId === value)
    if (!pair) return { cancelled: false }
    this.pendingAIReviews.delete(pair[0]); if ((this.preparingAIReviews.get(pair[0]) ?? 0) === 0) this.reviewGenerations.delete(pair[0]); this.scheduleAIReviewExpiry(); return { cancelled: true }
  }
  async uninstall(id: string, session: string): Promise<{ removed: boolean }> {
    this.assertSession(session)
    const intent = this.find(id).manifestVersion === 2 ? this.beginIntent(id, true) : undefined
    this.invalidateAIReview(id)
    return this.queue.run(async () => {
      this.assertSession(session); const p = this.find(id); const request = { pluginId: id, name: p.name, version: p.current.version }
      if (!await this.confirm({ ...request, kind: 'uninstall' }, session)) { if (intent !== undefined) this.finishIntent(id, intent); return { removed: false } }
      const deleteData = await this.confirm({ ...request, kind: 'delete-data' }, session)
      this.stop(id); p.enabled = false; p.status = 'stopping'; await this.store.flush()
      // Persist disabled before removal; an interrupted uninstall never auto-enables leftovers.
      await this.registry.save(this.data, () => this.isSession(session))
      this.notifyFeatureAuthorityChanged()
      const target = await this.fs.path('packages', id); this.assertSession(session); await this.fs.remove(target)
      if (deleteData) { this.assertSession(session); await this.store.deletePrivateData(id) }
      const next = { registryVersion: 1 as const, plugins: this.data.plugins.filter(item => item.id !== id) }
      await this.registry.save(next, () => this.isSession(session)); this.data = next; this.webFeatureMetadata.delete(id); this.broker.forget(id); this.intents.delete(id); this.notifyFeatureAuthorityChanged(); return { removed: true }
    })
  }
  beginSession(): void { if (this.closed) return; this.clearAIReviews(); for (const p of this.data.plugins) this.stop(p.id); this.currentSession = randomUUID(); this.runtimes.clear() }
  async restoreSession(): Promise<void> {
    const session = this.session
    await this.queue.run(async () => { for (const p of this.data.plugins) { if (!this.isSession(session)) return; if (p.enabled) { try { const pkg = await this.loadInstalled(p); if (this.isSession(session)) this.activateInstalled(p, pkg) } catch { p.enabled = false; p.status = 'invalid' } } } })
    if (this.isSession(session)) this.notifyFeatureAuthorityChanged()
  }
  close(): void { this.closed = true; this.clearAIReviews(); this.currentSession = randomUUID(); for (const p of this.data.plugins) this.stop(p.id); this.runtimes.clear(); this.broker.clear(); this.featureAuthorityListeners.clear() }
}
