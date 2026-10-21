import type { WebContents } from 'electron'
import { IPC_CHANNELS } from '../../src/shared/ipc.ts'
import { registerManagerEventHandlers, registerManagerInvokeHandlers, type IpcSenderContext, type ManagerEventRegistry, type ManagerInvokeRegistry } from './window-security.ts'
import type { IpcResult, ManagerWindowAction } from '../../src/shared/ipc.ts'

export function registerWindowIpcHandlers(ipc: ManagerEventRegistry & ManagerInvokeRegistry, deps: {
  isManagerMainFrame: (context: IpcSenderContext) => boolean
  markManagerRendererReady: (sender: WebContents) => void
  acknowledgeNativeManagerIntent: (context: IpcSenderContext, requestId: unknown, outcome: unknown) => void
  performManagerWindowAction: (action: ManagerWindowAction) => IpcResult<{ maximized: boolean }>
}): () => void {
  const disposeEvents = registerManagerEventHandlers(ipc, deps.isManagerMainFrame, {
    [IPC_CHANNELS.managerReady]: event => deps.markManagerRendererReady(event.sender as WebContents),
    [IPC_CHANNELS.acknowledgeNativeManagerIntent]: (event, requestId: unknown, outcome: unknown) => deps.acknowledgeNativeManagerIntent(event, requestId, outcome),
  })
  const disposeInvokes = registerManagerInvokeHandlers(ipc, deps.isManagerMainFrame, {
    [IPC_CHANNELS.managerWindowAction]: (_event, value: unknown) => {
      if (value !== 'minimize' && value !== 'toggle-maximize' && value !== 'close') {
        return { ok: false, error: { code: 'INVALID_WINDOW_ACTION', message: '窗口操作无效。' } }
      }
      return deps.performManagerWindowAction(value)
    },
  })
  return () => { disposeEvents(); disposeInvokes() }
}
