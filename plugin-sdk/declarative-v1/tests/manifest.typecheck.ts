import type { PluginManifestV1 } from '../types.d.ts'

const valid = {
  manifestVersion: 1,
  id: 'org.example.typecheck',
  name: 'Typecheck sample',
  description: 'A typed author manifest',
  author: { name: 'Example' },
  version: '1.0.0',
  api: { apiMajor: 1, minHostVersion: '0.1.0' },
  type: 'declarative-manager',
  entry: { pageId: 'home', label: 'Sample' },
  requestedCapabilities: ['manager.page', 'plugin.storage.write', 'plugin.storage.read'],
  settings: [],
  pages: [{ id: 'home', title: 'Home', blocks: [{ type: 'button', label: 'Save', actionId: 'write' }] }],
  actions: [{ id: 'write', type: 'plugin.storage.write', key: 'note' }, { id: 'read', type: 'plugin.storage.read', key: 'note' }],
  assets: [],
} satisfies PluginManifestV1

void valid
// @ts-expect-error executable and built-in plugin types are not third-party manifests
const executableType: PluginManifestV1['type'] = 'javascript'
// @ts-expect-error host-owned filesystem path is not a public author field
const internalPath: PluginManifestV1 = { ...valid, installPath: 'C:/host/plugin' }
void executableType
void internalPath
