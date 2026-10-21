import { clipboard } from 'electron'
import { IPC_CHANNELS, type IpcResult } from '../../src/shared/ipc.ts'
import type { PluginDevelopment } from '../plugins/plugin-development.ts'
import type { PluginRuntimeDiagnostics } from '../plugins/plugin-runtime-diagnostics.ts'
import { registerManagerInvokeHandlers, type IpcSenderContext, type ManagerInvokeRegistry } from './window-security.ts'

export function registerPluginDevelopmentHandlers(ipc: ManagerInvokeRegistry, deps: {
  development: PluginDevelopment
  diagnostics: PluginRuntimeDiagnostics
  isManagerMainFrame(context: IpcSenderContext): boolean
  chooseProject(): Promise<string | null>
}): () => void {
  const guard = (count: number, action: (args: unknown[]) => Promise<unknown>) => async (event: IpcSenderContext, ...args: unknown[]): Promise<IpcResult<unknown>> => {
    try {
      if (!deps.isManagerMainFrame(event) || args.length !== count) throw new Error('Invalid development request.')
      const data = await action(args)
      if (!deps.isManagerMainFrame(event)) throw new Error('Manager session changed.')
      return { ok: true, data }
    } catch {
      return { ok: false, error: { code: 'DEVELOPMENT_OPERATION_FAILED', message: '开发操作未完成。请先在所选项目运行 pnpm dev，查看开发者诊断后重新连接。' } }
    }
  }
  return registerManagerInvokeHandlers(ipc, deps.isManagerMainFrame, {
    [IPC_CHANNELS.pluginDevelopmentGet]: guard(0, async () => deps.development.status),
    [IPC_CHANNELS.pluginDevelopmentSetEnabled]: guard(1, async args => {
      if (typeof args[0] !== 'boolean') throw new Error('Invalid Developer Mode value.')
      await deps.development.setEnabled(args[0]); return deps.development.status
    }),
    [IPC_CHANNELS.pluginDevelopmentConnect]: guard(0, async () => {
      if (!deps.development.status.enabled) throw new Error('Developer Mode disabled.')
      const directory = await deps.chooseProject()
      if (directory) await deps.development.connectProject(directory)
      return deps.development.status
    }),
    [IPC_CHANNELS.pluginDevelopmentDisconnect]: guard(0, async () => { await deps.development.disconnect(); return deps.development.status }),
    [IPC_CHANNELS.pluginDevelopmentOpen]: guard(1, async args => {
      if (typeof args[0] !== 'string' || args[0].length > 128) throw new Error('Invalid Feature identity.')
      await deps.development.openFeature(args[0])
    }),
    [IPC_CHANNELS.pluginDevelopmentCopy]: guard(2, async args => {
      if (!deps.development.status.enabled || typeof args[0] !== 'string') throw new Error('Developer diagnostics unavailable.')
      if (args[1] !== undefined && typeof args[1] !== 'string') throw new Error('Invalid Feature identity.')
      clipboard.writeText(deps.diagnostics.format(args[0], args[1] as string | undefined))
    }),
  })
}
