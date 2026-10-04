import { IPC_CHANNELS, type IpcResult } from '../../src/shared/ipc.ts'
import { PLUGIN_CAPABILITIES, type PluginCapability, type PluginInvokeRequest } from '../../src/shared/plugin-contracts.ts'
import { opaqueKey, record, validPluginId, versionParts } from '../plugins/manifest.ts'
import { PluginManager } from '../plugins/plugin-manager.ts'
import { fail, safePluginError } from '../plugins/errors.ts'
import type { IpcSenderContext } from './window-security.ts'

interface PluginHandlerDependencies {
  getManager(): PluginManager | null
  isManagerMainFrame(context: IpcSenderContext): boolean
  choosePackage(): Promise<Uint8Array | null>
}
type Handler = (event: IpcSenderContext, ...args: unknown[]) => Promise<IpcResult<unknown>>
function id(value: unknown): string { if (!validPluginId(value)) fail('INVALID_INPUT'); return value }
export function createPluginHandlers(deps: PluginHandlerDependencies): Record<string, Handler> {
  const guard = (count: number, action: (manager: PluginManager, session: string, args: unknown[]) => Promise<unknown>): Handler => async (event, ...args) => {
    try {
      if (!deps.isManagerMainFrame(event)) fail('PERMISSION_DENIED')
      if (args.length !== count) fail('INVALID_INPUT')
      const manager = deps.getManager(); if (!manager) fail('OPERATION_FAILED')
      const session = manager.session; if (!manager.isSession(session)) fail('SESSION_EXPIRED')
      const data = await action(manager, session, args)
      if (!deps.isManagerMainFrame(event) || !manager.isSession(session)) fail('SESSION_EXPIRED')
      return { ok: true, data }
    } catch (error) { return { ok: false, error: safePluginError(error) } }
  }
  return {
    [IPC_CHANNELS.pluginList]: guard(0, async manager => manager.list()),
    [IPC_CHANNELS.pluginInstall]: guard(0, async (manager, session) => {
      const bytes = await deps.choosePackage(); if (!manager.isSession(session)) fail('SESSION_EXPIRED')
      return bytes ? manager.install(bytes, session) : { outcome: 'cancelled' }
    }),
    [IPC_CHANNELS.pluginSetEnabled]: guard(2, async (manager, session, args) => {
      if (typeof args[1] !== 'boolean') fail('INVALID_INPUT'); return manager.setEnabled(id(args[0]), args[1], session)
    }),
    [IPC_CHANNELS.pluginSetGrants]: guard(2, async (manager, session, args) => {
      const grants = args[1]
      if (!Array.isArray(grants) || grants.length > PLUGIN_CAPABILITIES.length || grants.some(cap => !PLUGIN_CAPABILITIES.includes(cap)) || new Set(grants).size !== grants.length) fail('INVALID_INPUT')
      return manager.setGrants(id(args[0]), grants as PluginCapability[], session)
    }),
    [IPC_CHANNELS.pluginGetPages]: guard(1, async (manager, session, args) => manager.getPages(id(args[0]), session)),
    [IPC_CHANNELS.pluginInvoke]: guard(1, async (manager, session, args) => {
      const request = record(args[0], ['pluginId', 'version', 'hash', 'actionId', 'input']); id(request.pluginId); versionParts(request.version); opaqueKey(request.actionId)
      if (typeof request.hash !== 'string' || !/^[a-f0-9]{64}$/.test(request.hash)) fail('INVALID_INPUT')
      return manager.invoke(request as unknown as PluginInvokeRequest, session)
    }),
    [IPC_CHANNELS.pluginAIReviewPrepare]: guard(1, async (manager, session, args) => {
      const request = record(args[0], ['pluginId', 'version', 'hash', 'actionId', 'input']); id(request.pluginId); versionParts(request.version); opaqueKey(request.actionId)
      if (typeof request.hash !== 'string' || !/^[a-f0-9]{64}$/.test(request.hash)) fail('INVALID_INPUT')
      return manager.prepareAIReview(request as unknown as PluginInvokeRequest, session)
    }),
    [IPC_CHANNELS.pluginAIReviewConfirm]: guard(1, async (manager, session, args) => manager.confirmAIReview(args[0], session)),
    [IPC_CHANNELS.pluginAIReviewCancel]: guard(1, async (manager, session, args) => manager.cancelAIReview(args[0], session)),
    [IPC_CHANNELS.pluginUninstall]: guard(1, async (manager, session, args) => manager.uninstall(id(args[0]), session)),
  }
}
export function registerPluginIpcHandlers(ipc: { handle(channel: string, handler: Handler): void; removeHandler(channel: string): void }, deps: PluginHandlerDependencies): () => void {
  const handlers = createPluginHandlers(deps)
  for (const [channel, handler] of Object.entries(handlers)) ipc.handle(channel, handler)
  return () => { for (const channel of Object.keys(handlers)) ipc.removeHandler(channel) }
}
