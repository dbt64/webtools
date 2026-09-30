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
