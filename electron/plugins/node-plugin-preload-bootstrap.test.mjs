import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { loadNodePluginPreload } from './node-plugin-preload-bootstrap.ts'

function descriptor(overrides = {}) {
  const source = Buffer.from('module.exports = 1')
  return { source, value: { pluginId: 'org.example.node', packageHash: 'a'.repeat(64), preloadPath: 'C:\\plugins\\runtime.cjs', preloadHash: createHash('sha256').update(source).digest('hex'), localDataPath: 'C:\\plugins\\data', generation: 4, ...overrides } }
}
function arg(value) { return `--webtools-plugin-runtime=${Buffer.from(JSON.stringify(value)).toString('base64url')}` }

test('loads only an exact descriptor after verifying the installed preload hash', () => {
  const { source, value } = descriptor(); const seen = []
  assert.equal(loadNodePluginPreload([arg(value)], {
    readFile: path => { assert.equal(path, value.preloadPath); return source },
    setPluginData: path => seen.push(['data', path]),
    requirePlugin: path => seen.push(['require', path]),
  }), true)
  assert.deepEqual(seen, [['data', value.localDataPath], ['require', value.preloadPath]])
})

test('does nothing for ordinary Web runtime and rejects duplicate arguments', () => {
  assert.equal(loadNodePluginPreload([], {}), false)
  const { value } = descriptor()
  assert.throws(() => loadNodePluginPreload([arg(value), arg(value)], {}), /duplicate/i)
})

test('rejects descriptor path, preload type, identity, and hash tampering before require', () => {
  const { source, value } = descriptor(); let required = false
  const run = input => loadNodePluginPreload([arg(input)], { readFile: () => source, setPluginData() {}, requirePlugin() { required = true } })
  for (const bad of [
    { ...value, pluginId: '../escape' }, { ...value, packageHash: 'x' }, { ...value, preloadPath: 'relative.cjs' },
    { ...value, preloadPath: 'C:\\plugins\\runtime.js' }, { ...value, preloadHash: 'b'.repeat(64) }, { ...value, generation: 0 },
  ]) assert.throws(() => run(bad))
  assert.equal(required, false)
})

test('rejects malformed or oversized descriptors without loading code', () => {
  assert.throws(() => loadNodePluginPreload(['--webtools-plugin-runtime=%%%'], {}))
  assert.throws(() => loadNodePluginPreload([`--webtools-plugin-runtime=${'A'.repeat(90_000)}`], {}))
})
