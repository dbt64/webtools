import { ipcMain, type WebContents } from 'electron'
import { IPC_CHANNELS } from '../../src/shared/ipc'
import type { IpcSenderContext } from './window-security'

export function registerWindowIpcHandlers(deps: {
  markManagerRendererReady: (sender: WebContents) => void
  acknowledgeNativeManagerIntent: (context: IpcSenderContext, requestId: unknown) => void
}): void {
  ipcMain.on(IPC_CHANNELS.managerReady, (event) => deps.markManagerRendererReady(event.sender))
  ipcMain.on(IPC_CHANNELS.acknowledgeNativeManagerIntent, (event, requestId: unknown) => deps.acknowledgeNativeManagerIntent(event, requestId))
}
