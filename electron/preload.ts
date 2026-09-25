import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type DesktopApi } from '../src/shared/ipc'

const desktopApi: DesktopApi = {
  getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.getVersion) as Promise<string>,
}

contextBridge.exposeInMainWorld('desktop', desktopApi)
