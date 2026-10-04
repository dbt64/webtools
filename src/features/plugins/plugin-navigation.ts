import type { PluginSummary } from '../../shared/plugin-contracts.ts'
import { pluginCanOpen } from './plugin-view-model.ts'

export interface PluginNavigationItem { id: string; label: string; iconDataUrl?: string }

export interface PluginPageRequestIdentity {
  section: string
  pluginId: string | null
  generation: number
}

export function isCurrentPluginPageRequest(current: PluginPageRequestIdentity, requested: PluginPageRequestIdentity): boolean {
  return current.section === 'plugin-page'
    && current.section === requested.section
    && current.pluginId === requested.pluginId
    && current.generation === requested.generation
}

export function pluginNavigationItems(plugins: PluginSummary[]): PluginNavigationItem[] {
  return plugins.filter(pluginCanOpen).map(plugin => ({ id: plugin.id, label: plugin.name, ...(plugin.iconDataUrl ? { iconDataUrl: plugin.iconDataUrl } : {}) }))
}

export function shouldReturnToPluginCenter(pluginId: string | null, plugins: PluginSummary[]): boolean {
  if (!pluginId) return true
  const current = plugins.find(plugin => plugin.id === pluginId)
  return !current || !pluginCanOpen(current)
}
