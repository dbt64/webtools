import { contextBridge, ipcRenderer } from 'electron'
import { appendFileSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { LIMITS_V3 } from '../plugin-sdk/runtime-v3/manifest-v3.mjs'
import { loadNodePluginPreload } from './plugins/node-plugin-preload-bootstrap.ts'
import { PLUGIN_BRIDGE_CLIENT_ROUTE, PLUGIN_BRIDGE_HOST_ROUTE, PLUGIN_RUNTIME_PRELOAD_ERROR_ROUTE } from './plugins/web-plugin-bridge-routes.ts'
import { registerWebPluginPreload } from './plugins/web-plugin-preload-registration.ts'

registerWebPluginPreload(contextBridge, {
  send: raw => ipcRenderer.send(PLUGIN_BRIDGE_CLIENT_ROUTE, raw),
  listen: listener => {
    const receive = (_event: Electron.IpcRendererEvent, raw: unknown) => listener(raw)
    ipcRenderer.on(PLUGIN_BRIDGE_HOST_ROUTE, receive)
    return () => { ipcRenderer.removeListener(PLUGIN_BRIDGE_HOST_ROUTE, receive) }
  },
}, window, process.argv)

try {
  loadNodePluginPreload(process.argv, {
    readFile: path => {
      const stat = statSync(path)
      if (!stat.isFile() || stat.size > LIMITS_V3.nodePreload) throw new Error('Invalid Node Plugin preload file')
      return readFileSync(path)
    },
    setPluginData: path => { process.env.WEBTOOLS_PLUGIN_DATA = path },
    requirePlugin: path => { require(path) },
  })
} catch (error) {
  // A malformed or tampered preload fails the current runtime generation closed.
  if (process.argv.includes('--plugin-runtime-acceptance') && process.env.WEBTOOLS_PLUGIN_RUNTIME_ACCEPTANCE === '1'
    && process.argv.some(argument => argument.startsWith('--webtools-plugin-runtime='))) {
    const isolatedProfile = process.env.WEBTOOLS_PLUGIN_RUNTIME_TEST_PROFILE
    if (isolatedProfile && isAbsolute(isolatedProfile)) {
      try {
        appendFileSync(join(isolatedProfile, 'plugin-runtime-trace.jsonl'), `${JSON.stringify({
          at: new Date().toISOString(), event: 'node-preload-exception',
          details: { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined },
        })}\n`, 'utf8')
      } catch { /* Acceptance diagnostics cannot alter the fail-closed behavior. */ }
    }
  }
  try {
    ipcRenderer.send(PLUGIN_RUNTIME_PRELOAD_ERROR_ROUTE, {
      code: 'NODE_PRELOAD_FAILED',
      ...(process.argv.includes('--webtools-plugin-developer-diagnostics') ? { detail: {
        message: (error instanceof Error ? error.message : String(error)).slice(0, 4096),
        stack: error instanceof Error ? error.stack?.slice(0, 8192) : undefined,
      } } : {}),
    })
  } catch {}
}
