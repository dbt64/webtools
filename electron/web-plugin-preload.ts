import { contextBridge, ipcRenderer } from 'electron'
import { createPluginPreloadFacade } from './plugins/web-plugin-preload-client.ts'
import { PLUGIN_BRIDGE_CLIENT_ROUTE, PLUGIN_BRIDGE_HOST_ROUTE } from './plugins/web-plugin-bridge-routes.ts'

const facade = createPluginPreloadFacade({
  send: raw => ipcRenderer.send(PLUGIN_BRIDGE_CLIENT_ROUTE, raw),
  listen: listener => {
    const receive = (_event: Electron.IpcRendererEvent, raw: unknown) => listener(raw)
    ipcRenderer.on(PLUGIN_BRIDGE_HOST_ROUTE, receive)
    return () => { ipcRenderer.removeListener(PLUGIN_BRIDGE_HOST_ROUTE, receive) }
  },
})
contextBridge.exposeInMainWorld('__webtoolsPluginBridge', facade)
const onPageHide = () => facade.dispose()
window.addEventListener('pagehide', onPageHide, { once: true })
facade.onClose(() => window.removeEventListener('pagehide', onPageHide))
