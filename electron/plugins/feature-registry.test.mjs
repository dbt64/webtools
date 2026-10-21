import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FeatureRegistry } from './feature-registry.ts'
import { PluginManager } from './plugin-manager.ts'
import { BuiltinTranslationLifecycle } from './builtin-translation-lifecycle.ts'
import { manifest, packageBytes } from './fixtures.mjs'

const translationRef = { pluginId: 'webtools.translation', featureId: 'translate-text' }

test('content rules reach capable peers and constrained rows are omitted for old Native peers', async () => {
  const registry = new FeatureRegistry({ listDeclarativeFeatures: async () => [], isTranslationEnabled: () => true,
    listRuntimeFeatures: async () => [{ pluginName: 'Text Actions', feature: { ref: { pluginId: 'org.example.actions', featureId: 'open-link' },
      sourceKind: 'runtime-v3', title: 'Open link', commands: [], acceptedContexts: [{ type: 'text', sources: ['selected-text'], textMatch: 'http-url' }],
      iconToken: 'globe', presentation: 'command' } }] })
  await registry.refresh()
  assert.equal(registry.snapshot(true, true, true).features.find(row => row.ref.featureId === 'open-link').acceptedContexts[0].textMatch, 'http-url')
  assert.deepEqual(registry.snapshot(true, true, false).features.map(row => row.ref), [translationRef])
  registry.close()
})

function declarative(pluginId, title = 'Private Notes', featureId = 'legacy-manager-page') {
  return {
    pluginName: `${title} Plugin`,
    feature: {
      ref: { pluginId, featureId },
      sourceKind: 'declarative',
      title,
      commands: [title],
      icon: 'plugin',
      requiredCapabilities: ['manager.page'],
      acceptedContexts: [],
      resolvedEntry: { kind: 'declarative-compatibility', pageId: 'home' },
    },
  }
}

function setup(rows = [], translationEnabled = false, options = {}) {
  let candidates = structuredClone(rows)
  let enabled = translationEnabled
  const registry = new FeatureRegistry({
    listDeclarativeFeatures: async () => structuredClone(candidates),
    isTranslationEnabled: () => enabled,
    now: options.now ?? (() => 1791296400000),
    hostSessionId: options.hostSessionId ?? '2e83e777-81e5-47bb-8a5e-1f52e5d7bd34',
  })
  return {
    registry,
    candidates: value => { candidates = structuredClone(value) },
    translation: value => { enabled = value },
  }
}

test('FeatureRegistry starts empty, remains non-persistent, and returns defensive snapshots', async () => {
  const { registry } = setup()
  const first = await registry.refresh()
  assert.deepEqual(first.features, [])
  const revision = registry.contentRevision
  first.features.push({})
  assert.deepEqual(registry.snapshot().features, [])
  await registry.refresh()
  assert.equal(registry.contentRevision, revision)
  assert.equal('persist' in registry, false)
})

test('FeatureRegistry aggregates enabled declarative candidates and strips internal routes from projection', async () => {
  const { registry } = setup([declarative('org.example.private-notes')])
  const snapshot = await registry.refresh()
  assert.equal(snapshot.features.length, 1)
  assert.deepEqual(snapshot.features[0].ref, { pluginId: 'org.example.private-notes', featureId: 'legacy-manager-page' })
  assert.equal(snapshot.features[0].pluginName, 'Private Notes Plugin')
  assert.equal(snapshot.features[0].featureKind, 'declarative-compatibility')
  for (const secretField of ['pageId', 'requiredCapabilities', 'granted', 'path', 'archive', 'assets', 'store', 'secret']) {
    assert.equal(JSON.stringify(snapshot).includes(secretField), false, `projection leaked ${secretField}`)
  }
  assert.equal(registry.resolve({ pluginId: 'org.example.private-notes', featureId: 'legacy-manager-page' }).feature.resolvedEntry.pageId, 'home')
})

test('FeatureRegistry aggregates built-in Translation only while enabled with stable Host aliases', async () => {
  const { registry, translation } = setup([], true)
  const enabled = await registry.refresh()
  assert.equal(enabled.features.length, 1)
  assert.deepEqual(enabled.features[0].ref, translationRef)
  assert.equal(enabled.features[0].featureKind, 'built-in')
  assert.equal(enabled.features[0].iconToken, 'translate')
  assert.deepEqual(enabled.features[0].commands, ['Translate', 'Translation'])
  assert.equal(registry.resolve(translationRef).feature.resolvedEntry.key, 'translation')
  translation(false)
  assert.equal((await registry.refresh()).features.length, 0)
})

test('built-in Translation and same-ID declarative Plugin have distinct composite Feature identities', async () => {
  const { registry } = setup([declarative('webtools.translation')], true)
  const snapshot = await registry.refresh()
  assert.deepEqual(snapshot.features.map(row => row.ref.featureId), ['legacy-manager-page', 'translate-text'])
  assert.equal(registry.resolve({ pluginId: 'webtools.translation', featureId: 'legacy-manager-page' }).feature.resolvedEntry.pageId, 'home')
  assert.equal(registry.resolve(translationRef).feature.resolvedEntry.key, 'translation')
})

test('FeatureRegistry revisions follow normalized content and stable identity ordering only', async () => {
  let now = 1791296400000
  const { registry, candidates } = setup([declarative('org.example.zed'), declarative('org.example.alpha')], false, { now: () => now })
  const first = await registry.refresh()
  const firstRevision = first.revision
  assert.deepEqual(first.features.map(row => row.ref.pluginId), ['org.example.alpha', 'org.example.zed'])
  now += 10_000
  const repeated = await registry.refresh()
  assert.equal(repeated.revision, firstRevision)
  assert.notEqual(repeated.generatedAtUnixMs, first.generatedAtUnixMs)
  candidates([declarative('org.example.alpha', 'Changed'), declarative('org.example.zed')])
  const changed = await registry.refresh()
  assert.equal(changed.revision, firstRevision + 1)
  candidates([declarative('org.example.zed'), declarative('org.example.alpha', 'Changed')])
  assert.equal((await registry.refresh()).revision, changed.revision)
})

test('FeatureRegistry revision does not change when source text normalizes to the same projection', async () => {
  const { registry, candidates } = setup([declarative('org.example.normalized')])
  const first = await registry.refresh()
  const row = declarative('org.example.normalized')
  row.pluginName = '  Private\tNotes Plugin  '
  row.feature.title = '  Private\tNotes  '
  row.feature.commands = [' Private\tNotes ']
  candidates([row])
  const second = await registry.refresh()
  assert.equal(second.revision, first.revision)
  assert.deepEqual(second.features, first.features)
})

test('FeatureRegistry rejects duplicate FeatureRefs without replacing the last valid snapshot', async () => {
  const { registry, candidates } = setup([declarative('org.example.one')])
  const valid = await registry.refresh()
  candidates([declarative('org.example.one'), declarative('org.example.one', 'Second label')])
  await assert.rejects(registry.refresh(), /duplicate FeatureRef/i)
  assert.deepEqual(registry.snapshot(), valid)
})

test('late FeatureRegistry refreshes cannot overwrite a newer requested snapshot', async () => {
  let releaseFirst
  let calls = 0
  let current = [declarative('org.example.old')]
  const registry = new FeatureRegistry({
    listDeclarativeFeatures: async () => {
      calls += 1
      if (calls === 1) await new Promise(resolve => { releaseFirst = resolve })
      return structuredClone(current)
    },
    isTranslationEnabled: () => false,
    hostSessionId: '2e83e777-81e5-47bb-8a5e-1f52e5d7bd34',
    now: () => 1791296400000,
  })
  const first = registry.refresh()
  await new Promise(resolve => setImmediate(resolve))
  current = [declarative('org.example.new')]
  const second = registry.refresh()
  releaseFirst()
  await Promise.all([first, second])
  assert.deepEqual(registry.snapshot().features.map(row => row.ref.pluginId), ['org.example.new'])
})

test('PluginManager feature candidates follow persisted enablement and manager.page grants without starting runtimes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'webtools-feature-registry-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const manager = new PluginManager({ userData: root, hostVersion: '0.1.0', confirm: async () => true, externalOpen: async () => {}, clipboardWrite: () => {}, ai: {} })
  t.after(() => manager.close())
  await manager.initialize()
  const plugin = manifest({ id: 'org.example.private-notes', name: 'Private Notes' })
  await manager.install(packageBytes(plugin), manager.session)
  assert.deepEqual(await manager.listFeatureCandidates(), [])
  await manager.setEnabled(plugin.id, true, manager.session)
  const [candidate] = await manager.listFeatureCandidates()
  assert.equal(candidate.pluginName, 'Private Notes')
  assert.equal(candidate.feature.ref.featureId, 'legacy-manager-page')
  assert.equal(candidate.feature.resolvedEntry.pageId, 'home')
  const runtimeBefore = manager.runtimes.get(plugin.id)
  await manager.listFeatureCandidates()
  assert.equal(manager.runtimes.get(plugin.id), runtimeBefore, 'metadata projection must not create or replace a runtime')
  assert.equal((await manager.list())[0].status, 'active')

  await manager.setGrants(plugin.id, [], manager.session)
  assert.deepEqual(await manager.listFeatureCandidates(), [])
  await manager.setEnabled(plugin.id, false, manager.session)
  assert.deepEqual(await manager.listFeatureCandidates(), [])
  assert.deepEqual((await readdir(join(root, 'plugins'))).filter(name => name.includes('feature-registry')), [])
})

test('tampered current package is excluded from the derived projection', async t => {
  const root = await mkdtemp(join(tmpdir(), 'webtools-feature-integrity-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const manager = new PluginManager({ userData: root, hostVersion: '0.1.0', confirm: async () => true, externalOpen: async () => {}, clipboardWrite: () => {}, ai: {} })
  t.after(() => manager.close())
  await manager.initialize()
  const plugin = manifest({ id: 'org.example.tampered' })
  await manager.install(packageBytes(plugin), manager.session)
  await manager.setEnabled(plugin.id, true, manager.session)
  assert.equal((await manager.listFeatureCandidates()).length, 1)
  const current = (await manager.list())[0]
  await writeFile(join(root, 'plugins', 'packages', current.id, current.version, `${current.hash}.wtplugin`), 'tampered package bytes')
  assert.deepEqual(await manager.listFeatureCandidates(), [])
})

test('PluginManager publishes Feature authority revocation and successful mutation changes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'webtools-feature-events-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const manager = new PluginManager({ userData: root, hostVersion: '0.1.0', confirm: async () => true, externalOpen: async () => {}, clipboardWrite: () => {}, ai: {} })
  t.after(() => manager.close())
  await manager.initialize()
  const events = []
  const unsubscribe = manager.subscribeFeatureAuthorityChanged(() => events.push('changed'))
  t.after(unsubscribe)
  const plugin = manifest({ id: 'org.example.events' })
  manager.deps.confirm = async () => false
  assert.equal((await manager.install(packageBytes(plugin), manager.session)).outcome, 'cancelled')
  assert.deepEqual(events, [])
  manager.deps.confirm = async () => true
  const save = manager.registry.save.bind(manager.registry)
  manager.registry.save = async () => { throw new Error('simulated registry commit failure') }
  await assert.rejects(manager.install(packageBytes(plugin), manager.session), /simulated registry commit failure/)
  assert.deepEqual(events, [])
  manager.registry.save = save
  await manager.install(packageBytes(plugin), manager.session)
  await manager.setEnabled(plugin.id, true, manager.session)
  await manager.setGrants(plugin.id, [], manager.session)
  await manager.uninstall(plugin.id, manager.session)
  // Uninstall publishes once when it blocks/revokes the runtime, once after
  // persisting the disabled state, and once after removing the package.
  assert.deepEqual(events, ['changed', 'changed', 'changed', 'changed', 'changed', 'changed'])
})

test('PluginManager enable, update, disable, and uninstall commits update the derived registry without persisted Feature state', async t => {
  const root = await mkdtemp(join(tmpdir(), 'webtools-feature-refresh-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const manager = new PluginManager({ userData: root, hostVersion: '0.1.0', confirm: async () => true, externalOpen: async () => {}, clipboardWrite: () => {}, ai: {} })
  t.after(() => manager.close())
  await manager.initialize()
  const registry = new FeatureRegistry({
    listDeclarativeFeatures: () => manager.listFeatureCandidates(),
    isTranslationEnabled: () => false,
  })
  t.after(() => registry.close())
  let pending = registry.refresh()
  const dispose = manager.subscribeFeatureAuthorityChanged(() => { pending = registry.refresh() })
  t.after(dispose)
  await pending
  const startRevision = registry.contentRevision

  const plugin = manifest({ id: 'org.example.lifecycle', name: 'Lifecycle Plugin', entry: { pageId: 'home', label: 'Home' } })
  await manager.install(packageBytes(plugin), manager.session)
  await pending
  assert.deepEqual(registry.snapshot().features, [])
  assert.equal(registry.contentRevision, startRevision, 'installing disabled metadata does not change the active projection')

  await manager.setEnabled(plugin.id, true, manager.session)
  await pending
  let snapshot = registry.snapshot()
  assert.equal(snapshot.features.length, 1)
  assert.equal(snapshot.features[0].pluginName, 'Lifecycle Plugin')
  assert.equal(snapshot.features[0].title, 'Home')
  let revision = registry.contentRevision
  assert.equal(revision, startRevision + 1)

  const updatedPlugin = manifest({ id: plugin.id, name: 'Lifecycle Notes', version: '2.0.0', entry: { pageId: 'home', label: 'Updated Notes' } })
  await manager.install(packageBytes(updatedPlugin), manager.session)
  await pending
  snapshot = registry.snapshot()
  assert.equal(snapshot.features.length, 1, 'an enabled feature remains projected after a valid in-place package update')
  assert.equal(snapshot.features[0].pluginName, 'Lifecycle Notes')
  assert.equal(snapshot.features[0].title, 'Updated Notes')
  assert.equal(registry.contentRevision, revision + 1, 'changed package metadata changes projection content and revision')
  revision = registry.contentRevision

  const updatedSummary = await manager.list()
  assert.deepEqual(updatedSummary[0].granted, ['manager.page'], 'disable test retains the manager.page grant')
  await manager.setEnabled(plugin.id, false, manager.session)
  await pending
  assert.deepEqual(registry.snapshot().features, [])
  assert.equal(registry.contentRevision, revision + 1, 'disabling an active feature removes it from the projection')
  revision = registry.contentRevision

  await manager.setEnabled(plugin.id, true, manager.session)
  await pending
  assert.equal(registry.snapshot().features.length, 1)
  assert.equal(registry.contentRevision, revision + 1)
  revision = registry.contentRevision

  assert.deepEqual(await manager.uninstall(plugin.id, manager.session), { removed: true })
  await pending
  assert.deepEqual(registry.snapshot().features, [])
  assert.equal(registry.contentRevision, revision + 1, 'uninstalling an active feature removes it from the projection')
  assert.deepEqual((await readdir(join(root, 'plugins'))).filter(name => name.includes('feature-registry')), [])
})

test('Translation lifecycle notifications refresh the same derived registry after stable state transitions', async t => {
  let enabled = false
  const lifecycle = new BuiltinTranslationLifecycle({
    load: async () => ({ status: 'ready', enabled }),
    setEnabled: async (_id, value, mayCommit = () => true) => {
      if (!mayCommit()) throw Object.assign(new Error(), { code: 'SESSION_EXPIRED' })
      enabled = value
      return { status: 'ready', enabled }
    },
    recoverToDefault: async (mayCommit = () => true) => {
      if (!mayCommit()) throw Object.assign(new Error(), { code: 'SESSION_EXPIRED' })
      enabled = true
      return { status: 'ready', enabled }
    },
  }, () => {})
  await lifecycle.initialize()
  const registry = new FeatureRegistry({
    listDeclarativeFeatures: async () => [],
    isTranslationEnabled: () => lifecycle.isEnabled(),
  })
  t.after(() => registry.close())
  let pending = registry.refresh()
  const dispose = lifecycle.subscribeFeatureStateChanged(() => { pending = registry.refresh() })
  t.after(() => { dispose(); lifecycle.close() })
  await pending
  const emptyRevision = registry.contentRevision
  await lifecycle.setEnabled(true)
  await pending
  assert.equal(registry.snapshot().features[0].featureKind, 'built-in')
  assert.equal(registry.contentRevision, emptyRevision + 1)
  await lifecycle.setEnabled(false)
  await pending
  assert.deepEqual(registry.snapshot().features, [])
  assert.equal(registry.contentRevision, emptyRevision + 2)
})
