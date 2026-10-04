export const MANIFEST_VERSION_V1 = 1
export const API_MAJOR_V1 = 1
export const CAPABILITIES_V1 = Object.freeze([
  'manager.page', 'plugin.config.read', 'plugin.config.write', 'plugin.storage.read',
  'plugin.storage.write', 'external.open', 'clipboard.write', 'sharedAI.complete',
])
export const BLOCK_TYPES_V1 = Object.freeze(['heading', 'paragraph', 'text-input', 'select', 'checkbox', 'divider', 'button'])
export const ACTION_TYPES_V1 = Object.freeze([
  'plugin.config.read', 'plugin.config.write', 'plugin.storage.read', 'plugin.storage.write',
  'external.open', 'clipboard.write', 'sharedAI.complete',
])
export const LIMITS_V1 = Object.freeze({
  archive: 20 * 1024 * 1024,
  entries: 256,
  expanded: 50 * 1024 * 1024,
  png: 256 * 1024,
  manifest: 64 * 1024,
  ratio: 100,
  depth: 16,
  pages: 8,
  blocks: 64,
  actions: 32,
  settings: 64,
  value: 512 * 1024,
  keys: 200,
  data: 5 * 1024 * 1024,
})
