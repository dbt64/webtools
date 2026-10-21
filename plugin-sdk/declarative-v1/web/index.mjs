import { createBridgeConnection } from './bridge-client.mjs'

const connections = new WeakMap()
export function connectWebTools() {
  const facade = globalThis.__webtoolsPluginBridge
  if (!facade || typeof facade !== 'object') return createBridgeConnection(null).publicClient
  let connection = connections.get(facade)
  if (!connection) { connection = createBridgeConnection(facade); connections.set(facade, connection) }
  return connection.publicClient
}
