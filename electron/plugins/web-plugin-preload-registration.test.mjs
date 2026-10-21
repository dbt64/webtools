import test from 'node:test'
import assert from 'node:assert/strict'
import { registerWebPluginPreload } from './web-plugin-preload-registration.ts'

test('Web preload exposes the bridge and releases its page lifecycle listener on teardown', async () => {
  let exposed
  let receive
  let removedListener
  let pageHide
  let portUnsubscribed = false
  const sent = []
  const contextBridge = { exposeInMainWorld: (key, api) => { exposed = { key, api } } }
  const port = {
    send: raw => sent.push(raw),
    listen: listener => { receive = listener; return () => { portUnsubscribed = true } },
  }
  const page = {
    addEventListener: (type, listener, options) => { assert.equal(type, 'pagehide'); assert.deepEqual(options, { once: true }); pageHide = listener },
    removeEventListener: (type, listener) => { assert.equal(type, 'pagehide'); removedListener = listener },
  }

  registerWebPluginPreload(contextBridge, port, page, ['--webtools-plugin-ai', '--webtools-plugin-clipboard'])
  assert.equal(exposed.key, '__webtoolsPluginBridge')
  assert.deepEqual(exposed.api.capabilityNamespaces, ['ai', 'clipboard'])
  assert.deepEqual(sent, ['{"type":"hello","protocolMajor":1}'])
  receive('{"type":"ready","protocolMajor":1,"accepted":true}')
  assert.deepEqual(await exposed.api.getReady(), { accepted: true })

  pageHide()
  assert.equal(portUnsubscribed, true)
  assert.equal(removedListener, pageHide)
})
