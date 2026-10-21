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

type ManagerInvokeHandler = (context: IpcSenderContext, ...args: unknown[]) => unknown
type ManagerEventHandler = (context: IpcSenderContext, ...args: unknown[]) => void

export interface ManagerInvokeRegistry {
  handle(channel: string, handler: ManagerInvokeHandler): void
  removeHandler?(channel: string): void
}

export interface ManagerEventRegistry {
  on(channel: string, handler: ManagerEventHandler): void
  removeListener?(channel: string, handler: ManagerEventHandler): void
}

export function createManagerInvokeRegistry(
  ipc: ManagerInvokeRegistry,
  isManagerMainFrame: (context: IpcSenderContext) => boolean,
): ManagerInvokeRegistry {
  return {
    handle(channel, handler) {
      ipc.handle(channel, (context, ...args) => {
        if (!isManagerMainFrame(context)) throw new Error('UNAUTHORIZED_MANAGER_IPC')
        return handler(context, ...args)
      })
    },
    removeHandler: channel => ipc.removeHandler?.(channel),
  }
}

export function isCurrentWindowMainFrame(context: IpcSenderContext, window: WindowLike | null): boolean {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return false
  return context.sender === window.webContents && context.senderFrame === window.webContents.mainFrame
}

export function registerManagerInvokeHandlers(
  ipc: ManagerInvokeRegistry,
  isManagerMainFrame: (context: IpcSenderContext) => boolean,
  handlers: Record<string, ManagerInvokeHandler>,
): () => void {
  const authorized = createManagerInvokeRegistry(ipc, isManagerMainFrame)
  for (const [channel, handler] of Object.entries(handlers)) authorized.handle(channel, handler)
  return () => {
    for (const channel of Object.keys(handlers)) ipc.removeHandler?.(channel)
  }
}

export function registerManagerEventHandlers(
  ipc: ManagerEventRegistry,
  isManagerMainFrame: (context: IpcSenderContext) => boolean,
  handlers: Record<string, ManagerEventHandler>,
): () => void {
  const listeners = new Map<string, ManagerEventHandler>()
  for (const [channel, handler] of Object.entries(handlers)) {
    const listener: ManagerEventHandler = (context, ...args) => {
      if (!isManagerMainFrame(context)) return
      handler(context, ...args)
    }
    listeners.set(channel, listener)
    ipc.on(channel, listener)
  }
  return () => {
    for (const [channel, listener] of listeners) ipc.removeListener?.(channel, listener)
  }
}
