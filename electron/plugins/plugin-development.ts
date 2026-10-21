import { createHash } from 'node:crypto'
import { createConnection, type Socket } from 'node:net'
import { lstat, open, realpath } from 'node:fs/promises'
import { basename, isAbsolute, join, parse, resolve, sep } from 'node:path'
import type { PluginDevelopmentStatus } from '../../src/shared/plugin-development-contracts.ts'
import { LIMITS_V3 } from '../../plugin-sdk/runtime-v3/manifest-v3.mjs'
import { validPluginId } from './manifest.ts'
import { ManagedFs, SerialQueue } from './managed-fs.ts'
import { PluginStore } from './plugin-store.ts'
import { validatePackageV3ForRuntime, type ValidatedRuntimePackageV3 } from './package-validator.ts'
import { materializeRuntimePackage } from './plugin-package-installer.ts'
import { createWebFeatureAuthority, isWebCapabilityImplemented, IMPLEMENTED_WEB_CAPABILITIES, type WebFeatureAuthority } from './web-feature-authority.ts'
import { PluginRuntimeDiagnostics } from './plugin-runtime-diagnostics.ts'
import { supportsFeaturePresentation } from './manifest-v3.ts'
import { isFeatureRef, parseFeatureProjectionV2, normalizeFeatureText, type FeatureRef, type FeatureProjectionV2 } from '../../src/shared/feature-contracts.ts'

interface DevelopmentMarker { protocolVersion: 1; pluginId: string; projectRoot: string; sessionId: string; pipeName: string; token: string }
export interface DevelopmentPresentationHost {
  clearWindowTarget?(sessionId: string): void
  activate(authority: WebFeatureAuthority): Promise<void>
  beginReload(sessionId: string): { featureIds: readonly string[]; ready: Promise<void>; finish(): Promise<void> }
  closeSession(sessionId: string): Promise<void>
}
interface DevelopmentSession {
  marker: DevelopmentMarker
  socket: Socket
  fs: ManagedFs
  store: PluginStore
  scope: string
  queue: SerialQueue
  connected: boolean
  disposed: boolean
  revision: number
  seenRevision: number
  package?: ValidatedRuntimePackageV3
  contract?: string
  authorities: Set<WebFeatureAuthority>
  abort: AbortController
  resolveInitial(): void
  rejectInitial(error: Error): void
}
function samePath(left: string, right: string): boolean { return left.toLowerCase() === right.toLowerCase() }
async function canonicalDirectory(value: string): Promise<string> {
  if (!isAbsolute(value)) throw new Error('The development project must be an absolute directory.')
  const absolute = resolve(value)
  let cursor = parse(absolute).root
  for (const part of absolute.slice(cursor.length).split(sep).filter(Boolean)) {
    cursor = join(cursor, part)
    const stat = await lstat(cursor)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Development paths cannot contain links or junctions.')
  }
  return realpath(absolute)
}
async function readRegularFile(filePath: string, limit: number): Promise<Buffer> {
  const before = await lstat(filePath)
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > limit) throw new Error('Invalid development file.')
  const file = await open(filePath, 'r')
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size !== before.size || stat.ino !== before.ino || stat.size > limit) throw new Error('Development file changed while opening.')
    const parts: Buffer[] = []; let total = 0
    for (;;) {
      const part = Buffer.alloc(Math.min(65536, limit + 1 - total))
      const { bytesRead } = await file.read(part)
      if (!bytesRead) break
      total += bytesRead
      if (total > limit) throw new Error('Development package is too large.')
      parts.push(part.subarray(0, bytesRead))
    }
    return Buffer.concat(parts, total)
  } finally { await file.close() }
}

export class PluginDevelopment {
  private enabled = false
  private session: DevelopmentSession | null = null
  private intent = 0
  private readonly ownAuthorities = new WeakSet<object>()
  private readonly listeners = new Set<() => void>()
  constructor(private readonly deps: {
    runtime: DevelopmentPresentationHost
    diagnostics: PluginRuntimeDiagnostics
    userData: string
    hostVersion: string
    confirmProject(projectName: string, pkg: ValidatedRuntimePackageV3, signal: AbortSignal): Promise<boolean>
  }) {}
  get status(): PluginDevelopmentStatus {
    const s = this.session
    return { enabled: this.enabled, connected: s?.connected ?? false,
      ...(s ? { project: { pluginId: s.marker.pluginId, name: s.package?.manifest.name ?? s.marker.pluginId,
        projectName: basename(s.marker.projectRoot), revision: s.revision,
        ...(s.package ? { runtimeKind: s.package.manifest.runtime.kind } : {}),
        features: s.package?.manifest.features.map(feature => ({ id: feature.id, title: feature.title,
          available: supportsFeaturePresentation(s.package!.manifest, feature) })) ?? [] } } : {}),
      diagnostics: this.deps.diagnostics.list() }
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish(): void { for (const listener of this.listeners) { try { listener() } catch { /* Manager observation is optional. */ } } }
  private current(s: DevelopmentSession): boolean { return this.enabled && this.session === s && !s.disposed && s.connected }
  ownsPlugin(pluginId: string): boolean { const s = this.session; return Boolean(s && this.current(s) && s.package?.manifest.id === pluginId) }
  nativeProjection(selectedTextMatching = true): FeatureProjectionV2 | null {
    const s = this.session
    if (!s || !this.current(s) || !s.package || s.package.manifest.runtime.kind !== 'node') return null
    const manifest = s.package.manifest
    return parseFeatureProjectionV2({ projectionVersion: 2, hostSessionId: s.marker.sessionId, revision: s.revision, generatedAtUnixMs: Date.now(),
      features: manifest.features.filter(f => f.presentation?.type === 'command' && f.entry.kind === 'node-command'
        && (selectedTextMatching || !f.acceptedContexts.some(c => c.type === 'text' && c.textMatch !== undefined))
        && f.acceptedContexts.some(c => c.type === 'text' && c.sources.includes('selected-text'))).map(f => ({
          ref: { pluginId: manifest.id, featureId: f.id }, pluginName: normalizeFeatureText(`${Array.from(manifest.name).slice(0, 70).join('')} · 开发`, 80),
          title: f.title, commands: f.commands, acceptedContexts: f.acceptedContexts.filter(c => c.type === 'text' && c.sources.includes('selected-text'))
            .map(c => ({ type: 'text' as const, sources: ['selected-text' as const], ...('textMatch' in c && c.textMatch ? { textMatch: c.textMatch } : {}) })),
          iconToken: 'plugin', featureKind: 'runtime-v3', group: 'plugin-features', presentation: 'command',
        })) })
  }
  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled === this.enabled) return
    this.enabled = enabled
    this.deps.diagnostics.setEnabled(enabled)
    if (!enabled) await this.disconnect()
    this.publish()
  }
  async connectProject(project: string): Promise<void> {
    if (!this.enabled) throw new Error('Enable Developer Mode first.')
    await this.disconnect()
    const intent = ++this.intent
    const projectRoot = await canonicalDirectory(project)
    const directory = await canonicalDirectory(join(projectRoot, '.webtools'))
    const value = JSON.parse((await readRegularFile(join(directory, 'development.json'), 4096)).toString('utf8')) as DevelopmentMarker
    if (value.protocolVersion !== 1 || !validPluginId(value.pluginId) || typeof value.projectRoot !== 'string' || !samePath(value.projectRoot, projectRoot)
      || typeof value.sessionId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.sessionId)
      || value.pipeName !== `WebTools.PluginDevelopment.${value.sessionId}` || !/^[a-f0-9]{64}$/.test(value.token)) {
      throw new Error('Invalid development session. Run pnpm dev in the selected project.')
    }
    await canonicalDirectory(join(directory, value.sessionId))
    if (!this.enabled || intent !== this.intent) throw new Error('Development connection cancelled.')
    const scope = createHash('sha256').update(`${projectRoot.toLowerCase()}\0${value.pluginId}`).digest('hex').slice(0, 32)
    const fs = new ManagedFs(join(this.deps.userData, 'plugin-development', scope))
    await fs.initialize()
    if (!this.enabled || intent !== this.intent) throw new Error('Development connection cancelled.')
    let resolveInitial!: () => void
    let rejectInitial!: (error: Error) => void
    const initial = new Promise<void>((resolvePromise, reject) => { resolveInitial = resolvePromise; rejectInitial = reject })
    const socket = createConnection(`\\\\.\\pipe\\${value.pipeName}`)
    const s: DevelopmentSession = { marker: value, socket, fs, store: new PluginStore(fs), scope,
      queue: new SerialQueue(), connected: false, disposed: false, revision: 0, seenRevision: 0,
      authorities: new Set(), abort: new AbortController(), resolveInitial, rejectInitial }
    this.deps.diagnostics.rememberSecret(value.token)
    this.session = s
    let buffer = ''
    const timeout = setTimeout(() => { rejectInitial(new Error('Development Host connection timed out. Run pnpm dev and reconnect the project.')); socket.destroy() }, 60_000)
    socket.setEncoding('utf8')
    socket.once('connect', () => socket.write(`${JSON.stringify({ type: 'attach', sessionId: value.sessionId, token: value.token })}\n`))
    socket.on('data', chunk => {
      buffer += chunk
      if (buffer.length > 16_384) { socket.destroy(new Error('Invalid development message.')); return }
      let newline
      while ((newline = buffer.indexOf('\n')) >= 0) {
        let message: Record<string, unknown>
        try { message = JSON.parse(buffer.slice(0, newline)) } catch { socket.destroy(new Error('Invalid development message.')); return }
        buffer = buffer.slice(newline + 1)
        if (!message || typeof message !== 'object' || Array.isArray(message)) { socket.destroy(); return }
        if (!s.connected) {
          if (message.type !== 'ready' || message.sessionId !== value.sessionId || message.pluginId !== value.pluginId
            || message.projectRoot !== value.projectRoot) { socket.destroy(new Error('Development session identity mismatch.')); return }
          s.connected = true; this.publish()
        } else if (message.type === 'build') {
          void s.queue.run(() => this.receiveBuild(s, message)).catch(error => this.failure(s, 'reload', 'DEV_RELOAD_FAILED', error))
        } else if (message.type === 'diagnostic') {
          // Preserve wire order: a later failed rebuild cannot be cleared by an
          // earlier successful snapshot that is still loading/materializing.
          void s.queue.run(async () => {
            if (!this.current(s)) return
            this.deps.diagnostics.record({ pluginId: value.pluginId, phase: message.phase === 'preload' ? 'preload' : 'build',
              code: typeof message.code === 'string' ? message.code : 'DEV_BUILD_FAILED',
              message: typeof message.message === 'string' ? message.message : 'Development build failed.',
              source: typeof message.source === 'string' ? message.source : undefined,
              stack: typeof message.stack === 'string' ? message.stack : undefined, timestamp: Date.now() })
            if (!s.package) s.rejectInitial(new Error('The development build is invalid. Fix the project and rebuild.'))
          }).catch(error => this.failure(s, 'build', 'DEV_BUILD_FAILED', error))
        }
      }
    })
    socket.on('error', error => { rejectInitial(error); this.failure(s, 'reload', 'DEV_CONNECTION_LOST', error) })
    socket.on('close', () => {
      clearTimeout(timeout)
      if (s.disposed) return
      s.connected = false
      s.abort.abort()
      for (const authority of [...s.authorities]) authority.revoke()
      rejectInitial(new Error('Development connection closed.'))
      this.failure(s, 'reload', 'DEV_CONNECTION_LOST', new Error('pnpm dev disconnected. Reconnect the project after restarting the watcher.'))
      this.publish()
      if (this.session === s) {
        void this.disconnect().catch(() => console.warn('[plugin-development] Disconnected session files could not be removed.'))
      }
    })
    this.publish()
    try { await initial } finally { clearTimeout(timeout) }
  }
  private failure(s: DevelopmentSession, phase: 'build' | 'reload' | 'runtime', code: string, error: unknown, featureId?: string): void {
    if (!this.enabled || this.session !== s || s.disposed) return
    this.deps.diagnostics.record({ pluginId: s.marker.pluginId, ...(featureId ? { featureId } : {}), phase, code,
      message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined, timestamp: Date.now() })
  }
  private async receiveBuild(s: DevelopmentSession, message: Record<string, unknown>): Promise<void> {
    if (!this.current(s)) return
    const revision = message.revision
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision <= s.seenRevision) return
    const expected = join(s.marker.projectRoot, '.webtools', s.marker.sessionId, `build-${revision}.wtplugin`)
    if (typeof message.archivePath !== 'string' || !samePath(message.archivePath, expected)) throw new Error('Invalid development snapshot path.')
    s.seenRevision = revision
    const startedAt = Date.now()
    let reload: ReturnType<DevelopmentPresentationHost['beginReload']> | undefined
    try {
      await canonicalDirectory(join(s.marker.projectRoot, '.webtools', s.marker.sessionId))
      const pkg = await validatePackageV3ForRuntime(await readRegularFile(expected, LIMITS_V3.archive), this.deps.hostVersion)
      if (!this.current(s)) return
      if (pkg.manifest.id !== s.marker.pluginId) throw new Error('The development build changed Plugin ID. Restart pnpm dev and reconnect.')
      const contract = JSON.stringify([pkg.manifest.runtime.kind, [...pkg.manifest.requestedCapabilities].sort()])
      if (s.contract && s.contract !== contract) throw new Error('Runtime kind or requested capabilities changed. Reconnect this project to authorize the new contract.')
      if (!s.contract) {
        if (!await this.deps.confirmProject(basename(s.marker.projectRoot), pkg, s.abort.signal)) {
          s.socket.destroy()
          throw new Error('Development project authorization cancelled.')
        }
        if (!this.current(s)) return
      }
      const logical = `runtime/${s.marker.sessionId}/${pkg.hash}`
      await materializeRuntimePackage(s.fs, logical, pkg.manifest.runtimeFiles, pkg.resources, () => this.current(s))
      if (!this.current(s)) return
      reload = this.deps.runtime.beginReload(s.marker.sessionId)
      const oldHash = s.package?.hash
      s.package = pkg; s.contract = contract; s.revision = revision
      this.deps.diagnostics.buildSucceeded(s.marker.pluginId, startedAt)
      for (const authority of [...s.authorities]) authority.revoke()
      await reload.ready
      if (!this.current(s)) return
      this.publish(); s.resolveInitial()
      for (const reopenFeature of reload.featureIds) {
        if (pkg.manifest.features.some(feature => feature.id === reopenFeature)) {
          try { await this.openFeature(reopenFeature) } catch { /* Keep diagnostics and continue restoring the other Feature windows. */ }
        }
        else {
          this.failure(s, 'reload', 'DEV_FEATURE_REMOVED', new Error('The active Feature was removed from the new Manifest. Select another Feature.'), reopenFeature)
        }
      }
      await reload.finish()
      if (oldHash && oldHash !== pkg.hash) {
        try { await s.fs.remove(await s.fs.path(`runtime/${s.marker.sessionId}/${oldHash}`)) }
        catch (error) { this.failure(s, 'reload', 'DEV_OLD_BUILD_CLEANUP_FAILED', error) }
      }
    } catch (error) {
      const detailed = this.deps.diagnostics.list().some(item => item.pluginId === s.marker.pluginId
        && item.runtimeGeneration !== undefined && item.timestamp >= startedAt)
      if (!detailed) this.failure(s, 'reload', 'DEV_RELOAD_FAILED', error)
      s.rejectInitial(error instanceof Error ? error : new Error('Development update failed.'))
    } finally {
      await reload?.finish()
      if (!s.socket.destroyed) s.socket.write(`${JSON.stringify({ type: 'ack', revision })}\n`)
    }
  }
  isAuthority(authority: WebFeatureAuthority): boolean { return this.ownAuthorities.has(authority) && authority.isCurrent() }
  capabilityStore(authority: WebFeatureAuthority): PluginStore | null { return this.isAuthority(authority) ? this.session?.store ?? null : null }
  async resolveNodeRuntimePaths(authority: WebFeatureAuthority, command = false): Promise<{ pluginId: string; packageHash: string; preloadPath: string; preloadHash: string; localDataPath: string }> {
    const s = this.session
    if (!s || !this.isAuthority(authority) || s.package?.snapshot !== authority.snapshot || s.package.manifest.runtime.kind !== 'node') throw new Error('Development Node authority unavailable.')
    const feature = s.package.manifest.features.find(item => item.id === authority.featureId)
    const preload = command && feature?.entry.kind === 'node-command' ? feature.entry.module : s.package.manifest.runtime.preload
    if (!preload) throw new Error('Development Node preload is not declared.')
    const resource = authority.snapshot.getResource(preload)
    if (!resource) throw new Error('Development preload missing from validated snapshot.')
    const preloadPath = await s.fs.path(`runtime/${s.marker.sessionId}/${s.package.hash}/${preload}`)
    await s.fs.mkdir(`local-data/${s.marker.pluginId}`)
    const localDataPath = await s.fs.path(`local-data/${s.marker.pluginId}`)
    if (!this.isAuthority(authority)) throw new Error('Development Node authority revoked.')
    return { pluginId: s.marker.pluginId, packageHash: s.package.hash, preloadPath,
      preloadHash: createHash('sha256').update(resource.bytes).digest('hex'), localDataPath }
  }
  async openFeature(featureId: string): Promise<void> {
    const s = this.session
    const startedAt = Date.now()
    try { await this.openDevelopmentFeature(featureId) }
    catch (error) {
      if (s && !this.deps.diagnostics.list().some(item => item.pluginId === s.marker.pluginId && item.featureId === featureId && item.timestamp >= startedAt)) {
        this.failure(s, 'runtime', 'DEV_FEATURE_OPEN_FAILED', error, featureId)
      }
      throw error
    }
  }
  private async openDevelopmentFeature(featureId: string): Promise<void> {
    const s = this.session
    if (!s) throw new Error('Connect a development project first.')
    const ticket = await this.authorizeFeature({ pluginId: s.marker.pluginId, featureId }, authority => this.deps.runtime.activate(authority))
    await ticket.completion
  }
  async authorizeFeature(ref: FeatureRef, dispatch: (authority: WebFeatureAuthority, isSourceCurrent: () => boolean) => Promise<void>): Promise<{ completion: Promise<void> }> {
    const s = this.session
    const snapshot = s?.package?.snapshot
    if (!isFeatureRef(ref) || !s || !snapshot || !this.current(s) || ref.pluginId !== snapshot.manifest.id) throw new Error('Connect and authorize a valid development build first.')
    const revision = s.revision
    const featureId = ref.featureId
    const feature = snapshot.manifest.features.find(item => item.id === featureId)
    if (!feature) throw new Error('Development Feature unavailable.')
    const supported = (cap: string) => isWebCapabilityImplemented(cap as typeof IMPLEMENTED_WEB_CAPABILITIES[number], snapshot.manifest)
      && snapshot.manifest.requestedCapabilities.includes(cap as typeof snapshot.manifest.requestedCapabilities[number])
    const current = (cap?: typeof IMPLEMENTED_WEB_CAPABILITIES[number]) => this.current(s) && s.package?.snapshot === snapshot && s.revision === revision
      && feature.requiredCapabilities.every(supported)
      && (!cap || feature.requiredCapabilities.includes(cap as typeof feature.requiredCapabilities[number]) && supported(cap))
    if (!current()) throw new Error('This development Feature requires an unavailable Host capability.')
    let authority: WebFeatureAuthority
    authority = createWebFeatureAuthority(snapshot, featureId, current, () => { s.authorities.delete(authority) },
      { sessionId: s.marker.sessionId, originIdentity: `development.${s.scope}.${s.marker.pluginId}` })
    s.authorities.add(authority); this.ownAuthorities.add(authority)
    try { return { completion: Promise.resolve(dispatch(authority, current)).catch(error => { authority.revoke(); throw error }) } }
    catch (error) { authority.revoke(); throw error }
  }
  async disconnect(): Promise<void> {
    ++this.intent
    const s = this.session
    if (s) this.deps.runtime.clearWindowTarget?.(s.marker.sessionId)
    this.session = null
    if (!s) { this.publish(); return }
    s.disposed = true
    s.abort.abort()
    s.rejectInitial(new Error('Development session disconnected.'))
    s.socket.destroy()
    for (const authority of [...s.authorities]) authority.revoke()
    // Revocation closes only this session's RuntimeInstance. A global close()
    // here would also cancel a concurrently requested installed-plugin Feature.
    try {
      await this.deps.runtime.closeSession(s.marker.sessionId)
      await s.queue.run(async () => undefined)
      await s.fs.remove(await s.fs.path(`runtime/${s.marker.sessionId}`))
      await s.store.flush()
    } finally {
      this.deps.diagnostics.forgetSecret(s.marker.token)
      this.publish()
    }
  }
  async close(): Promise<void> { await this.setEnabled(false) }
}
