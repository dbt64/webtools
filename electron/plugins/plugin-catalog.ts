import { randomUUID } from 'node:crypto'
import type { CatalogOpenDTO, CatalogSnapshot, DeclarativeEntryDTO, PluginRef } from '../../src/shared/plugin-catalog-contracts.ts'
import type { PluginSummary } from '../../src/shared/plugin-contracts.ts'
import type { PluginManager } from './plugin-manager.ts'
import { builtinPluginEntries } from './builtin-plugin-registry.ts'
import { fail, safePluginError } from './errors.ts'

type CatalogCore = Pick<PluginManager, 'session' | 'isSession' | 'list' | 'getPages' | 'setEnabled'>
function project(plugin: PluginSummary): DeclarativeEntryDTO {
  return {
    kind: 'declarative', id: plugin.id, source: 'local-unsigned', package: plugin,
    icon: plugin.iconDataUrl ? { kind: 'png', dataUrl: plugin.iconDataUrl } : { kind: 'fallback' },
    entry: { kind: 'declarative-page' },
    management: { canToggle: plugin.status !== 'invalid' && plugin.status !== 'incompatible', canManageGrants: true, canUninstall: true, canReplacePackage: true },
  }
}

/** Safe presentation over existing authorities; owns no packages, grants or runtimes. */
export class PluginCatalog {
  private currentSession = randomUUID()
  private closed = false
  private revision = 0
  private generation = 0
  private readonly hostVersion: string
  private readonly getCore: () => CatalogCore | null
  constructor(hostVersion: string, getCore: () => CatalogCore | null) { this.hostVersion = hostVersion; this.getCore = getCore }
  get session(): string { return this.currentSession }
  isSession(session: string): boolean { return !this.closed && session === this.currentSession }
  private assertSession(session: string): void { if (!this.isSession(session)) fail('SESSION_EXPIRED') }
  private assertCore(core: CatalogCore, session: string): void { if (this.getCore() !== core || !core.isSession(session)) fail('SESSION_EXPIRED') }
  async list(session: string): Promise<CatalogSnapshot> {
    this.assertSession(session)
    const revision = ++this.revision
    const entries: CatalogSnapshot['entries'] = builtinPluginEntries(this.hostVersion)
    const core = this.getCore(); const coreSession = core?.session
    let declarativeAvailability: CatalogSnapshot['declarativeAvailability'] = { status: 'available' }
    if (!core) declarativeAvailability = { status: 'unavailable', errorCode: 'OPERATION_FAILED' }
    else {
      try { entries.push(...(await core.list()).map(project)) }
      catch (error) { declarativeAvailability = { status: 'unavailable', errorCode: safePluginError(error).code } }
      this.assertCore(core, coreSession!)
    }
    this.assertSession(session)
    return { revision, entries, declarativeAvailability }
  }
  async open(ref: PluginRef, session: string): Promise<CatalogOpenDTO> {
    this.assertSession(session)
    if (ref.kind === 'builtin') {
      if (!builtinPluginEntries(this.hostVersion).some(entry => entry.id === ref.id)) fail('NOT_INSTALLED')
      return { kind: 'builtin', id: 'webtools.translation', key: 'translation', generation: this.generation }
    }
    const core = this.getCore(); if (!core) fail('OPERATION_FAILED')
    const coreSession = core.session
    const page = await core.getPages(ref.id, coreSession)
    this.assertSession(session); this.assertCore(core, coreSession)
    return { kind: 'declarative', page }
  }
  async setEnabled(ref: PluginRef, enabled: boolean, session: string): Promise<DeclarativeEntryDTO> {
    this.assertSession(session)
    if (ref.kind === 'builtin') fail('PERMISSION_DENIED') // Phase 5F keeps Translation always enabled.
    const core = this.getCore(); if (!core) fail('OPERATION_FAILED')
    const coreSession = core.session
    const result = await core.setEnabled(ref.id, enabled, coreSession)
    this.assertSession(session); this.assertCore(core, coreSession)
    return project(result)
  }
  beginSession(): void { if (this.closed) return; this.currentSession = randomUUID(); this.generation += 1 }
  close(): void { this.closed = true; this.generation += 1 }
}
