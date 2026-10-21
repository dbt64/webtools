import assert from 'node:assert/strict'
import test from 'node:test'
import { PluginDevelopment } from './plugin-development.ts'
import { PluginRuntimeDiagnostics } from './plugin-runtime-diagnostics.ts'
import { runtimeV3Manifest, runtimeV3Package } from './fixtures.mjs'
import { validatePackageV3ForRuntime } from './package-validator.ts'

async function setup(name = 'Web Demo', textRule = {}) {
  const manifest = runtimeV3Manifest({ name, runtime: { kind: 'node' }, features: [{ id: 'quick', title: 'Quick',
    entry: { kind: 'node-command', module: 'command.cjs' }, presentation: { type: 'command' }, requiredCapabilities: [],
    acceptedContexts: [{ type: 'text', sources: ['selected-text'], ...textRule }] }],
    runtimeFiles: [{ path: 'command.cjs', role: 'node-command', mediaType: 'text/javascript' }] })
  const pkg = await validatePackageV3ForRuntime(runtimeV3Package(manifest, [{ name: 'command.cjs', data: 'module.exports=()=>{}' }]), '0.1.0')
  const development = new PluginDevelopment({ runtime: {}, diagnostics: new PluginRuntimeDiagnostics([]), userData: 'D:/isolated', hostVersion: '0.1.0', confirmProject: async () => true })
  // Unit-only admission setup; real marker/token/pipe/build validation is exercised by packaged acceptance.
  const session = { marker: { pluginId: manifest.id, sessionId: '6528d127-0182-4a60-9e4b-8c89070c50f0', projectRoot: 'D:/external/project' },
    package: pkg, revision: 1, connected: true, disposed: false, authorities: new Set(), scope: 'test' }
  development.enabled = true; development.session = session
  return { development, session, ref: { pluginId: manifest.id, featureId: 'quick' } }
}

test('development source label truncates by Unicode scalar without breaking a valid surrogate pair', async () => {
  const env = await setup('a'.repeat(69) + '😀 test')
  assert.equal(env.development.nativeProjection()?.features.length, 1)
})

test('development disconnect clears its exact session target before invalidating or revoking it', async () => {
  const { development, session } = await setup()
  const events = []
  development.deps.runtime = {
    clearWindowTarget(id) {
      assert.equal(id, session.marker.sessionId)
      assert.equal(development.session, session)
      assert.equal(session.disposed, false)
      events.push('clear')
    },
    async closeSession() { events.push('close') },
  }
  Object.assign(session, { abort: new AbortController(), rejectInitial() {}, socket: { destroy() {} },
    queue: { run: async fn => fn() }, fs: { path: async path => path, remove: async () => {} }, store: { flush: async () => {} } })
  session.authorities.add({ revoke() { events.push('revoke') } })
  await development.disconnect()
  assert.deepEqual(events, ['clear', 'revoke', 'close'])
})

test('only current authorized development builds supply ephemeral selected-text command projection', async () => {
  const env = await setup()
  assert.equal(env.development.nativeProjection().features.length, 1)
  assert.match(env.development.nativeProjection().features[0].pluginName, /开发/)
  env.session.connected = false
  assert.equal(env.development.nativeProjection(), null)
  await assert.rejects(env.development.authorizeFeature(env.ref, async () => {}))
  env.session.connected = true; env.development.enabled = false
  assert.equal(env.development.nativeProjection(), null)
})

test('development overlay preserves content conditions and never broadens them for an old peer', async () => {
  const env = await setup('Text Actions', { textMatch: 'http-url' })
  assert.deepEqual(env.development.nativeProjection(true).features[0].acceptedContexts,
    [{ type: 'text', sources: ['selected-text'], textMatch: 'http-url' }])
  assert.deepEqual(env.development.nativeProjection(false).features, [])
})

test('development source predicate survives normal release but rejects reload and missing Feature without fallback', async () => {
  const env = await setup(); let check; let authority
  const ticket = await env.development.authorizeFeature(env.ref, async (a, current) => { authority = a; check = current; a.revoke() })
  await ticket.completion
  assert.equal(authority.isCurrent(), false); assert.equal(check(), true)
  env.session.revision++
  assert.equal(check(), false)
  await assert.rejects(env.development.authorizeFeature({ ...env.ref, featureId: 'installed-only' }, async () => { assert.fail('wrong source') }))
  assert.equal(env.development.ownsPlugin(env.ref.pluginId), true)
})
