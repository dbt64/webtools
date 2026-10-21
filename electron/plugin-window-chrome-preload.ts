import { contextBridge, ipcRenderer } from 'electron'
import { PLUGIN_WINDOW_CHROME_CHANNELS, type PluginWindowAction, type PluginWindowChromeApi, type PluginWindowChromeState } from './plugins/plugin-window-chrome-contract.ts'

const api: PluginWindowChromeApi = {
  getState: () => ipcRenderer.invoke(PLUGIN_WINDOW_CHROME_CHANNELS.getState) as Promise<PluginWindowChromeState | null>,
  perform: action => ipcRenderer.invoke(PLUGIN_WINDOW_CHROME_CHANNELS.action, action) as Promise<boolean>,
  onState: handler => {
    const listener = (_event: Electron.IpcRendererEvent, value: PluginWindowChromeState) => handler(value)
    ipcRenderer.on(PLUGIN_WINDOW_CHROME_CHANNELS.state, listener)
    return () => ipcRenderer.removeListener(PLUGIN_WINDOW_CHROME_CHANNELS.state, listener)
  },
}

contextBridge.exposeInMainWorld('pluginWindowChrome', api)
