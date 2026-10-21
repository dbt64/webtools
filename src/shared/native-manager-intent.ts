import type { NativeManagerIntent } from './ipc.ts'
import { isLauncherPluginRef } from './launcher-plugin-contracts.ts'
import { isFeatureRef } from './feature-contracts.ts'

export function parseNativeManagerIntent(value: unknown): NativeManagerIntent | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (typeof row.requestId !== 'string' || !row.requestId || row.requestId.length > 128) return null
  const keys = Object.keys(row)
  if (row.kind === 'open-page' && (row.section === 'favorites' || row.section === 'entries' || row.section === 'settings')) {
    if (keys.length === 3) return { requestId: row.requestId, kind: row.kind, section: row.section }
    if (keys.length === 4 && row.section === 'settings' && row.settingsSection === 'super-panel')
      return { requestId: row.requestId, kind: row.kind, section: row.section, settingsSection: 'super-panel' }
    return null
  }
  if (row.kind === 'select-plugin') {
    if (!isPluginSelectionRef(row.ref)) return null
    if (keys.length === 3) return { requestId: row.requestId, kind: row.kind, ref: { ...row.ref } }
    if (keys.length === 4 && (row.section === 'about' || row.section === 'settings'))
      return { requestId: row.requestId, kind: row.kind, ref: { ...row.ref }, section: row.section }
    return null
  }
  if (keys.length !== 3) return null
  if (row.kind === 'open-plugin' && isLauncherPluginRef(row.ref))
    return { requestId: row.requestId, kind: row.kind, ref: { ...row.ref } }
  if (row.kind === 'open-feature' && isFeatureRef(row.ref))
    return { requestId: row.requestId, kind: row.kind, ref: { ...row.ref } }
  return null
}

function isPluginSelectionRef(value: unknown): value is import('./plugin-catalog-contracts.ts').PluginRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  const keys = Object.keys(row)
  if (!Object.hasOwn(row, 'kind') || !Object.hasOwn(row, 'id') || keys.length !== (Object.hasOwn(row, 'featureId') ? 3 : 2)) return false
  if (row.kind !== 'web' || typeof row.id !== 'string' || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(row.id) || row.id.length > 128) return false
  return !Object.hasOwn(row, 'featureId') || typeof row.featureId === 'string' && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(row.featureId) && row.featureId.length <= 128
}
