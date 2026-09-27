interface WebContentsLike {
  mainFrame: object
  isDestroyed(): boolean
}

interface WindowLike {
  webContents: WebContentsLike
  isDestroyed(): boolean
}

export interface IpcSenderContext {
  sender: object
  senderFrame: object | null
}

export function isCurrentWindowMainFrame(context: IpcSenderContext, window: WindowLike | null): boolean {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return false
  return context.sender === window.webContents && context.senderFrame === window.webContents.mainFrame
}

export function isCurrentAppMainFrame(context: IpcSenderContext, windows: readonly (WindowLike | null)[]): boolean {
  return windows.some((window) => isCurrentWindowMainFrame(context, window))
}
