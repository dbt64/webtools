import type { NativeManagerIntent } from './ipc.ts'
import { isLauncherPluginRef } from './launcher-plugin-contracts.ts'

export function parseNativeManagerIntent(value: unknown): NativeManagerIntent | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (typeof row.requestId !== 'string' || !row.requestId || row.requestId.length > 128) return null
  const keys = Object.keys(row)
  if (row.kind === 'translation-handoff' && keys.length === 2) return { requestId: row.requestId, kind: row.kind }
  if (keys.length !== 3) return null
  if (row.kind === 'open-page' && (row.section === 'favorites' || row.section === 'entries' || row.section === 'settings'))
    return { requestId: row.requestId, kind: row.kind, section: row.section }
  if (row.kind === 'open-plugin' && isLauncherPluginRef(row.ref))
    return { requestId: row.requestId, kind: row.kind, ref: { ...row.ref } }
  return null
}
