import { randomUUID } from 'node:crypto'
import type { BuiltinEntryDTO, CatalogOpenDTO, CatalogSnapshot, DeclarativeEntryDTO, PluginRef } from '../../src/shared/plugin-catalog-contracts.ts'
import type { PluginSummary } from '../../src/shared/plugin-contracts.ts'
import type { PluginManager } from './plugin-manager.ts'
import type { BuiltinTranslationRuntimeState } from './builtin-translation-lifecycle.ts'
import { builtinPluginEntries } from './builtin-plugin-registry.ts'
import { fail, safePluginError } from './errors.ts'
import type { LauncherPluginProjection, LauncherPluginShortcut } from '../../src/shared/launcher-plugin-contracts.ts'

type CatalogCore = Pick<PluginManager, 'session' | 'isSession' | 'list' | 'getPages' | 'setEnabled'>
export interface BuiltinTranslationCatalogPort {
  snapshot(): BuiltinTranslationRuntimeState
  isEnabled(): boolean
  setEnabled(enabled: boolean, mayCommit?: () => boolean): Promise<BuiltinTranslationRuntimeState>
  recoverToDefault(confirmed: boolean, mayCommit?: () => boolean): Promise<BuiltinTranslationRuntimeState>
}
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
  private readonly builtinTranslation: BuiltinTranslationCatalogPort
  constructor(hostVersion: string, getCore: () => CatalogCore | null, builtinTranslation: BuiltinTranslationCatalogPort) {
    this.hostVersion = hostVersion
    this.getCore = getCore
    this.builtinTranslation = builtinTranslation
  }
  get session(): string { return this.currentSession }
  isSession(session: string): boolean { return !this.closed && session === this.currentSession }
  private assertSession(session: string): void { if (!this.isSession(session)) fail('SESSION_EXPIRED') }
  private assertCore(core: CatalogCore, session: string): void { if (this.getCore() !== core || !core.isSession(session)) fail('SESSION_EXPIRED') }
  async list(session: string): Promise<CatalogSnapshot> {
    this.assertSession(session)
    const revision = ++this.revision
    let packageEntries: DeclarativeEntryDTO[] = []
    const core = this.getCore(); const coreSession = core?.session
    let declarativeAvailability: CatalogSnapshot['declarativeAvailability'] = { status: 'available' }
    if (!core) declarativeAvailability = { status: 'unavailable', errorCode: 'OPERATION_FAILED' }
    else {
      try { packageEntries = (await core.list()).map(project) }
      catch (error) { declarativeAvailability = { status: 'unavailable', errorCode: safePluginError(error).code } }
      this.assertCore(core, coreSession!)
    }
    this.assertSession(session)
    return { revision, entries: [...builtinPluginEntries(this.hostVersion, this.builtinTranslation.snapshot()), ...packageEntries], declarativeAvailability }
  }
  async open(ref: PluginRef, session: string): Promise<CatalogOpenDTO> {
    this.assertSession(session)
    if (ref.kind === 'builtin') {
      if (ref.id !== 'webtools.translation') fail('NOT_INSTALLED')
      if (!this.builtinTranslation.isEnabled()) fail('PLUGIN_DISABLED')
      return { kind: 'builtin', id: 'webtools.translation', key: 'translation', generation: this.generation }
    }
    const core = this.getCore(); if (!core) fail('OPERATION_FAILED')
    const coreSession = core.session
    const page = await core.getPages(ref.id, coreSession)
    this.assertSession(session); this.assertCore(core, coreSession)
    return { kind: 'declarative', page }
  }
  async launcherProjection(session: string): Promise<LauncherPluginProjection> {
    const snapshot = await this.list(session)
    const plugins: LauncherPluginShortcut[] = []
    for (const entry of snapshot.entries) {
      if (entry.kind === 'builtin') {
        if (entry.state.status === 'ready' && entry.state.enabled)
          plugins.push({ ref: { kind: 'builtin', id: entry.id }, displayName: entry.name.replace(/\p{Cc}/gu, ' ').trim().slice(0, 128) || entry.id, icon: 'translation' })
      } else if (entry.package.enabled && ['active', 'invoking'].includes(entry.package.status) && entry.package.granted.includes('manager.page')) {
        plugins.push({ ref: { kind: 'declarative', id: entry.id }, displayName: entry.package.name.replace(/\p{Cc}/gu, ' ').trim().slice(0, 128) || entry.id, icon: 'plugin' })
      }
    }
    if (plugins.length > 1001) fail('INVALID_INPUT') // Existing 1,000-package registry limit plus the builtin.
    return { projectionVersion: 1, plugins }
  }
  async setEnabled(ref: PluginRef, enabled: boolean, session: string): Promise<BuiltinEntryDTO | DeclarativeEntryDTO> {
    this.assertSession(session)
    if (ref.kind === 'builtin') {
      if (ref.id !== 'webtools.translation') fail('NOT_INSTALLED')
      const state = await this.builtinTranslation.setEnabled(enabled, () => this.isSession(session))
      this.assertSession(session)
      return builtinPluginEntries(this.hostVersion, state)[0]
    }
    const core = this.getCore(); if (!core) fail('OPERATION_FAILED')
    const coreSession = core.session
    const result = await core.setEnabled(ref.id, enabled, coreSession)
    this.assertSession(session); this.assertCore(core, coreSession)
    return project(result)
  }
  async recoverBuiltinTranslation(session: string, confirmed: boolean): Promise<BuiltinEntryDTO> {
    this.assertSession(session)
    const state = await this.builtinTranslation.recoverToDefault(confirmed, () => this.isSession(session))
    this.assertSession(session)
    return builtinPluginEntries(this.hostVersion, state)[0]
  }
  beginSession(): void { if (this.closed) return; this.currentSession = randomUUID(); this.generation += 1 }
  close(): void { this.closed = true; this.generation += 1 }
}
