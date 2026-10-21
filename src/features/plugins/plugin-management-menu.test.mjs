import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, nextTick } from 'vue'
import vue from '@vitejs/plugin-vue'
import { createServer } from 'vite'

const server = await createServer({ configFile: false, plugins: [vue()], optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom' })
after(() => server.close())
const { default: View } = await server.ssrLoadModule('/src/features/plugins/PluginManagerView.vue')
View.render = () => null
const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null })

class FocusNode {
  constructor(children = []) { this.children = children }
  contains(target) { return target === this || this.children.includes(target) }
  focus() { document.activeElement = this }
}

function mount(t) {
  const previous = { Node: globalThis.Node, document: globalThis.document, window: globalThis.window }
  const body = new FocusNode(), trigger = new FocusNode(), replace = new FocusNode(), uninstall = new FocusNode()
  const root = new FocusNode([trigger, replace, uninstall])
  const calls = []
  globalThis.Node = FocusNode
  globalThis.document = { activeElement: body, addEventListener() {}, removeEventListener() {} }
  globalThis.window = { addEventListener() {}, removeEventListener() {}, desktop: { plugins: {
    installFromUserDialog: async () => { calls.push('replace'); return { ok: true, data: { outcome: 'cancelled' } } },
    uninstall: async () => { calls.push('uninstall'); return { ok: true, data: { removed: false } } },
    stopRuntime: async () => { calls.push('stop'); return { ok: true, data: { stopped: true } } },
  } } }
  const entry = { kind: 'web', id: 'org.example.menu', source: 'local-unsigned', icon: { kind: 'fallback' }, entry: { kind: 'web-features' },
    management: { canToggle: true, canManageGrants: true, canUninstall: true, canReplacePackage: true },
    package: { id: 'org.example.menu', manifestVersion: 3, name: 'Menu', version: '1.0.0', hash: 'a'.repeat(64), enabled: true,
      status: 'enabled', requested: [], granted: [], installedVersions: ['1.0.0'], source: 'local-unsigned',
      webFeatures: [{ id: 'home', title: 'Home', available: true }] } }
  const app = renderer.createApp(View, { entries: [entry], selection: { kind: 'web', id: entry.id }, loading: false })
  app.provide(Symbol.for('v-scx'), { modules: new Set() })
  const vm = app.mount({}); const state = vm.$.setupState
  state.actionRoot = root; state.managementMenuTrigger = trigger
  t.after(() => {
    app.unmount()
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value }
  })
  return { state, body, trigger, replace, uninstall, calls }
}

for (const action of ['replace', 'uninstall']) {
  test(`mouse focus transfer inside management menu preserves ${action} until click`, async t => {
    const env = mount(t)
    await nextTick()
    env.state.managementMenuOpen = true
    // Real Chromium exposes BODY between blur/focusout and the next focusin.
    // The event already identifies the intended menu button during that gap.
    document.activeElement = env.body
    env.state.handleActionFocusOut({ relatedTarget: env[action] })
    await nextTick()
    assert.equal(env.state.managementMenuOpen, true, 'the pressed button must survive until mouseup/click')
    env[action].focus()
    env.state.runManagementAction(action)
    await nextTick()
    assert.deepEqual(env.calls, [action])
    assert.equal(env.state.managementMenuOpen, false)
  })
}

test('focus returning to menu trigger stays open until trigger click toggles it', async t => {
  const env = mount(t); await nextTick(); env.state.managementMenuOpen = true
  env.state.handleActionFocusOut({ relatedTarget: env.trigger }); await nextTick()
  assert.equal(env.state.managementMenuOpen, true)
  env.state.toggleManagementMenu(); await nextTick()
  assert.equal(env.state.managementMenuOpen, false)
})

test('focus leaving the action group or window closes the menu', async t => {
  const env = mount(t); await nextTick()
  for (const relatedTarget of [env.body, null]) {
    env.state.managementMenuOpen = true
    env.state.handleActionFocusOut({ relatedTarget }); await nextTick()
    assert.equal(env.state.managementMenuOpen, false)
  }
})

test('Manager exposes a stop-running action that ends background work without toggling enablement', async t => {
  const env = mount(t); await nextTick()
  assert.equal(env.state.managementActions.some(action => action.id === 'stop'), true)
  env.state.managementMenuOpen = true
  env.state.runManagementAction('stop')
  await nextTick(); await nextTick()
  assert.deepEqual(env.calls, ['stop'])
  assert.match(env.state.feedback.text, /保持启用/)
  assert.equal(env.state.managementMenuOpen, false)
})
