import type { PluginManifestV1 } from '@webtools/plugin-sdk'

export const manifest = {
  manifestVersion: 1,
  id: 'org.example.webtools.private-notes',
  name: 'Private Notes',
  description: "Save and load one small note in this plugin's private data store.",
  author: { name: 'WebTools Example Authors' },
  version: '1.0.0',
  api: { apiMajor: 1, minHostVersion: '0.1.0' },
  type: 'declarative-manager',
  entry: { pageId: 'home', label: 'Private Notes' },
  requestedCapabilities: ['manager.page', 'plugin.storage.read', 'plugin.storage.write'],
  settings: [],
  pages: [{ id: 'home', title: 'Private note', blocks: [
    { type: 'heading', text: 'A note stored only for this plugin' },
    { type: 'paragraph', text: "Save note asks for plain text and stores it in the plugin's private data. Load note reads that value back." },
    { type: 'button', label: 'Save note', actionId: 'save-note' },
    { type: 'button', label: 'Load saved note', actionId: 'load-note' },
  ] }],
  actions: [
    { id: 'save-note', type: 'plugin.storage.write', key: 'note' },
    { id: 'load-note', type: 'plugin.storage.read', key: 'note' },
  ],
  assets: [],
} satisfies PluginManifestV1
