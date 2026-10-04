import { createHash, randomUUID } from 'node:crypto'
import { open, readdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { PLUGIN_CAPABILITIES, type PluginAIReviewDTO, type PluginActionResult, type PluginCapability, type PluginInstallResult, type PluginInvokeRequest, type PluginPageDTO, type PluginSummary, type PluginVersionChange } from '../../src/shared/plugin-contracts.ts'
import { LIMITS, boundedString, compareVersions, opaqueKey, record, validPluginId, versionParts } from './manifest.ts'
import { ManagedFs, SerialQueue } from './managed-fs.ts'
import { PluginRegistry, type PluginRecord, type RegistryData, type InstalledVersion } from './plugin-registry.ts'
import { PluginStore } from './plugin-store.ts'
import { validatePackage, type ValidatedPackage } from './package-validator.ts'
import { DeclarativeRuntime } from './declarative-runtime.ts'
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
  private readonly intents = new Map<string, { generation: number; blocked: boolean }>()
  private readonly pendingAIReviews = new Map<string, PendingAIReview>()
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
  isSession(session: string): boolean { return !this.closed && session === this.currentSession }
  private assertSession(session: string): void { if (!this.isSession(session)) fail('SESSION_EXPIRED') }
  private find(id: unknown): PluginRecord { if (!validPluginId(id)) fail('INVALID_INPUT'); const p = this.data.plugins.find(p => p.id === id); if (!p) fail('NOT_INSTALLED'); return p }
  private packageLogical(id: string, identity: InstalledVersion): string { if (!validPluginId(id)) fail('INVALID_INPUT'); versionParts(identity.version); if (!/^[a-f0-9]{64}$/.test(identity.hash)) fail('INVALID_INPUT'); return `packages/${id}/${identity.version}/${identity.hash}.wtplugin` }
  private async load(p: PluginRecord): Promise<ValidatedPackage> {
    const bytes = await this.fs.read(this.packageLogical(p.id, p.current), LIMITS.archive)
    if (createHash('sha256').update(bytes).digest('hex') !== p.current.hash) fail('INTEGRITY_FAILED')
    const pkg = await validatePackage(bytes, this.deps.hostVersion, this.deps.pngDecoder)
    if (pkg.manifest.id !== p.id || pkg.manifest.version !== p.current.version) fail('INTEGRITY_FAILED')
    return pkg
  }
  private stop(id: string): void { this.invalidateAIReview(id); this.runtimes.get(id)?.stop(); this.runtimes.delete(id) }
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
      try { const pkg = await this.load(p); await this.store.readConfig(pkg.manifest); p.name = pkg.manifest.name; p.description = pkg.manifest.description; p.author = structuredClone(pkg.manifest.author); p.api = structuredClone(pkg.manifest.api); p.source = 'local-unsigned'; p.requested = pkg.manifest.requestedCapabilities.slice(); p.granted = p.granted.filter(cap => p.requested.includes(cap)); if (p.errorCode !== 'REGISTRY_RECOVERED') delete p.errorCode; this.activate(p, pkg) }
      catch (error) { p.enabled = false; p.status = safePluginError(error).code === 'INCOMPATIBLE_PLUGIN' ? 'incompatible' : 'invalid'; p.errorCode = safePluginError(error).code; this.stop(p.id) }
    }
    await this.registry.save(this.data)
  }
  private async recover(): Promise<RegistryData> {
    const groups = new Map<string, Array<{ name: string; description: string; author: { name: string; url?: string }; api: { apiMajor: 1; minHostVersion: string }; requested: PluginCapability[]; identity: InstalledVersion }>>()
    for (const id of await readdir(await this.fs.path('packages'))) {
      if (!validPluginId(id)) continue
      const idPath = await this.fs.path('packages', id)
      for (const version of await readdir(idPath)) {
        try { versionParts(version) } catch { continue }
        for (const file of await readdir(await this.fs.path('packages', id, version))) {
          if (!/^[a-f0-9]{64}\.wtplugin$/.test(file)) continue
          try {
            const hash = file.slice(0, 64); const identity = { version, hash }
            const pkg = await this.load({ id, current: identity } as PluginRecord)
            const list = groups.get(id) ?? []; list.push({ name: pkg.manifest.name, description: pkg.manifest.description, author: structuredClone(pkg.manifest.author), api: structuredClone(pkg.manifest.api), requested: pkg.manifest.requestedCapabilities.slice(), identity }); groups.set(id, list)
          } catch (error) { if (safePluginError(error).code === 'UNSAFE_PATH') throw error }
        }
      }
    }
    return { registryVersion: 1, plugins: [...groups].map(([id, versions]) => {
      versions.sort((a, b) => compareVersions(b.identity.version, a.identity.version) || a.identity.hash.localeCompare(b.identity.hash))
      const current = versions[0]
      return { id, name: current.name, description: current.description, author: current.author, api: current.api, source: 'local-unsigned', requested: current.requested, current: current.identity, versions: versions.map(v => v.identity), enabled: false, granted: [], status: 'installed-disabled', errorCode: 'REGISTRY_RECOVERED' }
    }) }
  }
  async list(): Promise<PluginSummary[]> {
    return this.data.plugins.map(p => ({ id: p.id, name: p.name, version: p.current.version, hash: p.current.hash, enabled: p.enabled, status: this.intents.get(p.id)?.blocked ? 'stopping' : this.runtimes.get(p.id)?.invoking ? 'invoking' : p.status, requested: p.requested.slice(), granted: p.granted.slice(), installedVersions: [...new Set(p.versions.map(v => v.version))], source: 'local-unsigned', ...(p.description !== undefined ? { description: p.description } : {}), ...(p.author ? { author: structuredClone(p.author) } : {}), ...(p.api ? { api: structuredClone(p.api) } : {}), ...(this.runtimes.get(p.id)?.iconDataUrl ? { iconDataUrl: this.runtimes.get(p.id)?.iconDataUrl } : {}), ...(p.errorCode ? { errorCode: p.errorCode } : {}) }))
  }
  private async summary(id: string): Promise<PluginSummary> { return (await this.list()).find(p => p.id === id)! }
  private async confirm(request: PluginConsent, session: string): Promise<boolean> { this.assertSession(session); const accepted = await this.deps.confirm(request); this.assertSession(session); return accepted }
  async install(bytes: Uint8Array, session: string): Promise<PluginInstallResult> {
    return this.queue.run(async () => {
      this.assertSession(session)
      const pkg = await validatePackage(bytes, this.deps.hostVersion, this.deps.pngDecoder); this.assertSession(session)
      const m = pkg.manifest; const old = this.data.plugins.find(p => p.id === m.id); this.invalidateAIReview(m.id)
      if (old?.current.version === m.version && old.current.hash === pkg.hash) { await this.load(old); return { outcome: 'already-installed', plugin: await this.summary(m.id) } }
      const conflict = old?.versions.some(v => v.version === m.version && v.hash !== pkg.hash)
      const comparison = old ? compareVersions(m.version, old.current.version) : 1
      const downgrade = comparison < 0
      const versionChange: PluginVersionChange = {
        kind: !old ? 'new-install' : comparison < 0 ? 'downgrade' : comparison === 0 ? 'same-version-replacement' : 'upgrade',
        ...(old ? { currentVersion: old.current.version } : {}),
        incomingVersion: m.version,
        addedCapabilities: m.requestedCapabilities.filter(capability => !old?.requested.includes(capability)),
        removedCapabilities: old?.requested.filter(capability => !m.requestedCapabilities.includes(capability)) ?? [],
        reauthorizationRequired: Boolean(old && m.requestedCapabilities.some(capability => !old.granted.includes(capability))),
      }
      const prompt = { pluginId: m.id, name: m.name, version: m.version, capabilities: m.requestedCapabilities, versionChange }
      if (!await this.confirm({ ...prompt, kind: 'install' }, session)) return { outcome: 'cancelled' }
      if (conflict && !await this.confirm({ ...prompt, kind: 'replace' }, session)) return { outcome: 'cancelled' }
      if (downgrade && !await this.confirm({ ...prompt, kind: 'downgrade' }, session)) return { outcome: 'cancelled' }
      try { await this.store.readConfig(m) } catch { fail('CONFIG_INCOMPATIBLE') }
      this.assertSession(session)
      if (!old && this.data.plugins.length >= 1000) fail('STORAGE_LIMIT')
      const identity = { version: m.version, hash: pkg.hash }
      const p: PluginRecord = { id: m.id, name: m.name, description: m.description, author: structuredClone(m.author), api: structuredClone(m.api), source: 'local-unsigned', requested: m.requestedCapabilities.slice(), current: identity, versions: old ? old.versions.slice() : [], enabled: old?.enabled ?? false, granted: old?.granted.filter(cap => m.requestedCapabilities.includes(cap)) ?? [], status: 'installed-disabled' }
      if (!p.versions.some(v => v.version === m.version && v.hash === pkg.hash)) p.versions.push(identity)
      p.status = p.enabled ? m.requestedCapabilities.some(cap => !p.granted.includes(cap)) ? 'needs-permission' : 'active' : 'installed-disabled'
      const next = { registryVersion: 1 as const, plugins: [...this.data.plugins.filter(item => item.id !== m.id), p] }
      const staging = await this.fs.path('staging', `${randomUUID()}.wtplugin`); const destinationLogical = this.packageLogical(m.id, identity)
      let created = false
      let stoppedOld = false
      try {
        const file = await open(staging, 'wx'); try { await file.writeFile(pkg.bytes); await file.sync() } finally { await file.close() }
        await this.fs.mkdir(`packages/${m.id}/${m.version}`); const destination = await this.fs.path(destinationLogical)
        try {
          const existing = await this.fs.read(destinationLogical, LIMITS.archive)
          if (createHash('sha256').update(existing).digest('hex') !== pkg.hash) fail('INTEGRITY_FAILED')
        } catch (error) {
          if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error
          this.assertSession(session); await rename(staging, destination); created = true
        }
        if (old) { this.stop(old.id); stoppedOld = true; await this.store.flush(); await this.store.readConfig(m) }
        await this.registry.save(next, () => this.isSession(session))
        this.data = next; if (this.isSession(session)) this.activate(p, pkg)
        return { outcome: 'installed', plugin: await this.summary(m.id), change: versionChange }
      } catch (error) {
        if (created) await this.fs.remove(await this.fs.path(destinationLogical))
        if (stoppedOld && old && this.isSession(session)) {
          try { this.activate(old, await this.load(old)) } catch { old.enabled = false; old.status = 'invalid' }
        }
        throw error
      } finally { await this.fs.remove(staging) }
    })
  }
  async setEnabled(id: string, enabled: boolean, session: string): Promise<PluginSummary> {
    this.assertSession(session); if (typeof enabled !== 'boolean') fail('INVALID_INPUT')
    this.find(id); const intent = this.beginIntent(id, !enabled)
    return this.queue.run(async () => {
      this.assertSession(session); const old = this.find(id); const p = structuredClone(old)
      if (!enabled) { this.stop(id); p.enabled = false; p.status = 'installed-disabled'; await this.store.flush() }
      else {
        const pkg = await this.load(p); await this.store.readConfig(pkg.manifest)
        const missing = pkg.manifest.requestedCapabilities.filter(cap => !p.granted.includes(cap))
        if (missing.length && !await this.confirm({ kind: 'grant', pluginId: id, name: p.name, version: p.current.version, capabilities: missing }, session)) return this.summary(id)
        p.granted = pkg.manifest.requestedCapabilities.slice(); p.enabled = true; p.status = 'active'; delete p.errorCode
        const next = { registryVersion: 1 as const, plugins: this.data.plugins.map(item => item.id === id ? p : item) }
        await this.registry.save(next, () => this.isSession(session)); this.data = next; this.finishIntent(id, intent); this.activate(p, pkg); return this.summary(id)
      }
      const next = { registryVersion: 1 as const, plugins: this.data.plugins.map(item => item.id === id ? p : item) }
      await this.registry.save(next, () => this.isSession(session)); this.data = next; this.finishIntent(id, intent); return this.summary(id)
    })
  }
  async setGrants(id: string, grants: PluginCapability[], session: string): Promise<PluginSummary> {
    this.assertSession(session)
    if (!Array.isArray(grants) || grants.length > PLUGIN_CAPABILITIES.length || grants.some(cap => !PLUGIN_CAPABILITIES.includes(cap)) || new Set(grants).size !== grants.length) fail('INVALID_INPUT')
    const previous = this.find(id)
    if (grants.some(cap => !previous.requested.includes(cap))) fail('INVALID_INPUT')
    const intent = this.beginIntent(id, previous.granted.some(cap => !grants.includes(cap)))
    return this.queue.run(async () => {
      this.assertSession(session); if (this.intents.get(id)?.blocked) this.stop(id); const old = this.find(id); const pkg = await this.load(old)
      if (grants.some(cap => !pkg.manifest.requestedCapabilities.includes(cap))) fail('INVALID_INPUT')
      const added = grants.filter(cap => !old.granted.includes(cap))
      if (added.length && !await this.confirm({ kind: 'grant', pluginId: id, name: old.name, version: old.current.version, capabilities: added }, session)) return this.summary(id)
      await this.store.flush(); const p = { ...structuredClone(old), granted: grants.slice() }
      p.status = p.enabled ? pkg.manifest.requestedCapabilities.some(cap => !grants.includes(cap)) ? 'needs-permission' : 'active' : 'installed-disabled'
      const next = { registryVersion: 1 as const, plugins: this.data.plugins.map(item => item.id === id ? p : item) }
      await this.registry.save(next, () => this.isSession(session)); this.data = next; this.finishIntent(id, intent); this.activate(p, pkg); return this.summary(id)
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
      await this.queue.run(async () => this.registry.save(this.data)); throw error
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
    this.invalidateAIReview(id)
    return this.queue.run(async () => {
      this.assertSession(session); const p = this.find(id); const request = { pluginId: id, name: p.name, version: p.current.version }
      if (!await this.confirm({ ...request, kind: 'uninstall' }, session)) return { removed: false }
      const deleteData = await this.confirm({ ...request, kind: 'delete-data' }, session)
      this.stop(id); p.enabled = false; p.status = 'stopping'; await this.store.flush()
      // Persist disabled before removal; an interrupted uninstall never auto-enables leftovers.
      await this.registry.save(this.data, () => this.isSession(session))
      const target = await this.fs.path('packages', id); this.assertSession(session); await this.fs.remove(target)
      if (deleteData) { this.assertSession(session); await this.store.deletePrivateData(id) }
      const next = { registryVersion: 1 as const, plugins: this.data.plugins.filter(item => item.id !== id) }
      await this.registry.save(next, () => this.isSession(session)); this.data = next; this.broker.forget(id); this.intents.delete(id); return { removed: true }
    })
  }
  beginSession(): void { if (this.closed) return; this.clearAIReviews(); for (const runtime of this.runtimes.values()) runtime.stop(); this.currentSession = randomUUID(); this.runtimes.clear() }
  async restoreSession(): Promise<void> {
    const session = this.session
    await this.queue.run(async () => { for (const p of this.data.plugins) { if (!this.isSession(session)) return; if (p.enabled) { try { const pkg = await this.load(p); if (this.isSession(session)) this.activate(p, pkg) } catch { p.enabled = false; p.status = 'invalid' } } } })
  }
  close(): void { this.closed = true; this.clearAIReviews(); this.currentSession = randomUUID(); for (const runtime of this.runtimes.values()) runtime.stop(); this.runtimes.clear(); this.broker.clear() }
}
