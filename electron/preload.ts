import { contextBridge, ipcRenderer } from 'electron'

const desktopApi = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version') as Promise<string>,
}

contextBridge.exposeInMainWorld('desktop', desktopApi)

export type DesktopApi = typeof desktopApi
