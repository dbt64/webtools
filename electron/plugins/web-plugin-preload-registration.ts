import { createPluginPreloadFacade } from './web-plugin-preload-client.ts'
import { PLUGIN_BRIDGE_CLIENT_ROUTE, PLUGIN_BRIDGE_HOST_ROUTE } from './web-plugin-bridge-routes.ts'

interface Port {
  send(raw: string): void
  listen(listener: (raw: unknown) => void): () => void
}

interface ContextBridgePort {
  exposeInMainWorld(key: string, api: object): void
}

interface PageLifecycle {
  addEventListener(type: 'pagehide', listener: () => void, options?: AddEventListenerOptions | boolean): void
  removeEventListener(type: 'pagehide', listener: () => void, options?: EventListenerOptions | boolean): void
}

/** Registers only the WebTools bridge, using APIs available to a sandboxed Electron preload. */
export function registerWebPluginPreload(contextBridge: ContextBridgePort, port: Port, page: PageLifecycle, argv: readonly string[]): void {
  const capabilityNamespaces: Array<'ai' | 'clipboard'> = []
  if (argv.includes('--webtools-plugin-ai')) capabilityNamespaces.push('ai')
  if (argv.includes('--webtools-plugin-clipboard')) capabilityNamespaces.push('clipboard')
  const facade = createPluginPreloadFacade(port, capabilityNamespaces)
  contextBridge.exposeInMainWorld('__webtoolsPluginBridge', facade)
  const onPageHide = () => facade.dispose()
  page.addEventListener('pagehide', onPageHide, { once: true })
  facade.onClose(() => page.removeEventListener('pagehide', onPageHide))
}
