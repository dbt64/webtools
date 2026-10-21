import test from 'node:test'
import assert from 'node:assert/strict'
const { PluginConfigurationEditorModel: Model } = await import('./plugin-configuration-editor-model.ts').catch(() => ({}))
const identity = id => ({ pluginId: id, version: '1.0.0', hash: 'a'.repeat(64) })
const dto = id => ({ identity: identity(id), status: 'ready', schemaVersion: 1, revision: 'missing',
  settings: [{ key: 'count', label: 'Count', type: 'number', min: 1, max: 10, default: 2 }], values: { count: 2 } })

test('configuration editor ignores late reads after switching plugin', async () => {
  assert.equal(typeof Model, 'function')
  let release
  const model = new Model({ getConfiguration: request => request.pluginId === 'first' ? new Promise(done => { release = done }) : Promise.resolve({ ok: true, data: dto('second') }) })
  const first = model.select(identity('first')); await model.select(identity('second'))
  release({ ok: true, data: dto('first') }); await first
  assert.equal(model.state.identity.pluginId, 'second'); assert.equal(model.loading, false)
})

test('configuration draft rejects invalid numbers, cancel restores Host values and saves use Host revision', async () => {
  assert.equal(typeof Model, 'function')
  const requests = []
  const model = new Model({ getConfiguration: async () => ({ ok: true, data: dto('first') }), updateConfiguration: async request => { requests.push(request); return { ok: true, data: { ...dto('first'), values: request.values, revision: 'b'.repeat(64) } } } })
  await model.select(identity('first')); model.draft.count = NaN
  await model.save(); assert.equal(requests.length, 0); assert.ok(model.errors.count)
  model.cancel(); assert.equal(model.draft.count, 2); assert.equal(model.dirty, false)
  model.draft.count = 7; await model.save()
  assert.deepEqual(requests[0], { ...identity('first'), revision: 'missing', values: { count: 7 } })
  assert.equal(model.dirty, false)
})

test('stale save reports conflict while retaining unsaved draft; disposed editor ignores callbacks', async () => {
  assert.equal(typeof Model, 'function')
  const model = new Model({ getConfiguration: async () => ({ ok: true, data: dto('first') }), updateConfiguration: async () => ({ ok: false, error: { code: 'CONFIG_STALE', message: 'raw sensitive error' } }) })
  await model.select(identity('first')); model.draft.count = 7; await model.save()
  assert.equal(model.draft.count, 7); assert.equal(model.dirty, true); assert.ok(model.message.includes('重新加载')); assert.ok(!model.message.includes('sensitive'))
  model.dispose(); assert.equal(model.busy, false)
})
