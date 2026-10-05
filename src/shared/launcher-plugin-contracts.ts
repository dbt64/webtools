import type { PluginRef } from './plugin-catalog-contracts.ts'

/** Derived Launcher presentation only. Main remains the package/state authority. */
export interface LauncherPluginShortcut {
  ref: PluginRef
  displayName: string
  icon: 'translation' | 'plugin'
}
export interface LauncherPluginProjection { projectionVersion: 1; plugins: LauncherPluginShortcut[] }

export function isLauncherPluginRef(value: unknown): value is PluginRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (Object.keys(row).length !== 2 || !Object.hasOwn(row, 'kind') || !Object.hasOwn(row, 'id')) return false
  return row.kind === 'builtin' ? row.id === 'webtools.translation'
    : row.kind === 'declarative' && typeof row.id === 'string' && row.id.length <= 128 && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(row.id)
}
