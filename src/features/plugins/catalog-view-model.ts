import type { CatalogEntryDTO, PluginRef } from '../../shared/plugin-catalog-contracts.ts'
import { pluginCanOpen, pluginStatusView } from './plugin-view-model.ts'

export function catalogRef(entry: CatalogEntryDTO): PluginRef { return entry.kind === 'builtin' ? { kind: 'builtin', id: entry.id } : { kind: 'declarative', id: entry.id } }
export function catalogKey(ref: PluginRef): string { return `${ref.kind}:${ref.id}` }
export function catalogCanOpen(entry: CatalogEntryDTO): boolean { return entry.kind === 'builtin' ? entry.state.enabled && entry.state.status === 'ready' : pluginCanOpen(entry.package) }
export function catalogPresentation(entry: CatalogEntryDTO) {
  return entry.kind === 'builtin'
    ? { name: entry.name, version: entry.version, description: entry.description, author: 'WebTools · 内置', status: { label: '可用 · 内置', tone: 'good' } }
    : { name: entry.package.name, version: entry.package.version, description: entry.package.description ?? '', author: entry.package.author?.name ?? '作者未知', status: pluginStatusView(entry.package) }
}
export function catalogNavigationItems(entries: CatalogEntryDTO[]) {
  return entries.filter(catalogCanOpen).map(entry => ({ ref: catalogRef(entry), key: catalogKey(entry), label: catalogPresentation(entry).name, icon: entry.icon }))
}
export function catalogShouldReturnToCenter(ref: PluginRef | null, entries: CatalogEntryDTO[]): boolean {
  const current = ref ? entries.find(entry => catalogKey(entry) === catalogKey(ref)) : undefined
  return !current || !catalogCanOpen(current)
}
export interface CatalogRequestIdentity { section: string; ref: PluginRef | null; generation: number }
export function isCurrentCatalogRequest(current: CatalogRequestIdentity, requested: CatalogRequestIdentity): boolean {
  return current.section === 'plugin-page' && current.section === requested.section && current.generation === requested.generation
    && current.ref !== null && requested.ref !== null && catalogKey(current.ref) === catalogKey(requested.ref)
}
