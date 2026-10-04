import { IPC_CHANNELS, type IpcResult } from '../../src/shared/ipc.ts'
import type { PluginRef } from '../../src/shared/plugin-catalog-contracts.ts'
import { record, validPluginId } from '../plugins/manifest.ts'
import { fail, safePluginError } from '../plugins/errors.ts'
import type { PluginCatalog } from '../plugins/plugin-catalog.ts'
import type { IpcSenderContext } from './window-security.ts'

interface Dependencies {
  getCatalog(): PluginCatalog | null
  isManagerMainFrame(context: IpcSenderContext): boolean
  confirmBuiltinStateRecovery(): Promise<boolean>
}
type Handler = (event: IpcSenderContext, ...args: unknown[]) => Promise<IpcResult<unknown>>
function reference(value: unknown): PluginRef {
  const ref = record(value, ['kind', 'id'])
  if (ref.kind === 'builtin' && ref.id === 'webtools.translation') return { kind: 'builtin', id: ref.id }
  if (ref.kind === 'declarative' && validPluginId(ref.id)) return { kind: 'declarative', id: ref.id }
  return fail('INVALID_INPUT')
}
export function createPluginCatalogHandlers(deps: Dependencies): Record<string, Handler> {
  const guard = (count: number, action: (catalog: PluginCatalog, session: string, args: unknown[]) => Promise<unknown>): Handler => async (event, ...args) => {
    try {
      if (!deps.isManagerMainFrame(event)) fail('PERMISSION_DENIED')
      if (args.length !== count) fail('INVALID_INPUT')
      const catalog = deps.getCatalog(); if (!catalog) fail('OPERATION_FAILED')
      const session = catalog.session
      const data = await action(catalog, session, args)
      if (!deps.isManagerMainFrame(event) || deps.getCatalog() !== catalog || !catalog.isSession(session)) fail('SESSION_EXPIRED')
      return { ok: true, data }
    } catch (error) { return { ok: false, error: safePluginError(error) } }
  }
  return {
    [IPC_CHANNELS.pluginCatalogList]: guard(0, (catalog, session) => catalog.list(session)),
    [IPC_CHANNELS.pluginCatalogOpen]: guard(1, (catalog, session, args) => catalog.open(reference(args[0]), session)),
    [IPC_CHANNELS.pluginCatalogSetEnabled]: guard(2, (catalog, session, args) => {
      if (typeof args[1] !== 'boolean') fail('INVALID_INPUT')
      return catalog.setEnabled(reference(args[0]), args[1], session)
    }),
    [IPC_CHANNELS.pluginCatalogRecoverBuiltin]: guard(0, async (catalog, session) => {
      if (!await deps.confirmBuiltinStateRecovery()) return { recovered: false as const }
      return { recovered: true as const, entry: await catalog.recoverBuiltinTranslation(session, true) }
    }),
  }
}
export function registerPluginCatalogIpcHandlers(ipc: { handle(channel: string, handler: Handler): void; removeHandler(channel: string): void }, deps: Dependencies): () => void {
  const handlers = createPluginCatalogHandlers(deps)
  for (const [channel, handler] of Object.entries(handlers)) ipc.handle(channel, handler)
  return () => { for (const channel of Object.keys(handlers)) ipc.removeHandler(channel) }
}
