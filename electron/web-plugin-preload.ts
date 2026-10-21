import { contextBridge, ipcRenderer } from 'electron'
import { registerWebPluginPreload } from './plugins/web-plugin-preload-registration.ts'
import { PLUGIN_BRIDGE_CLIENT_ROUTE, PLUGIN_BRIDGE_HOST_ROUTE } from './plugins/web-plugin-bridge-routes.ts'

registerWebPluginPreload(contextBridge, {
  send: raw => ipcRenderer.send(PLUGIN_BRIDGE_CLIENT_ROUTE, raw),
  listen: listener => {
    const receive = (_event: Electron.IpcRendererEvent, raw: unknown) => listener(raw)
    ipcRenderer.on(PLUGIN_BRIDGE_HOST_ROUTE, receive)
    return () => { ipcRenderer.removeListener(PLUGIN_BRIDGE_HOST_ROUTE, receive) }
  },
}, window, process.argv)
