import assert from 'node:assert/strict'
import test from 'node:test'
import { FeatureActivationService } from './feature-activation.ts'

const ref = { pluginId: 'org.example.quick', featureId: 'quick-text' }
test('Quick Result completion checks live source independently of released runtime authority', async () => {
  for (const valid of [true, false]) {
    let released = false
    const service = new FeatureActivationService(async (_ref, dispatch) => ({ completion: dispatch({ isCurrent: () => !released }, () => valid) }),
      { present: async () => { released = true; return { status: 'completed', result: { kind: 'text', text: 'computed' } } } })
    const request = { ref, surface: 'super-panel', quickResult: { resultTarget: 'super-panel', signal: new AbortController().signal } }
    if (valid) assert.equal((await service.activate(request)).result.text, 'computed')
    else await assert.rejects(service.activate(request), error => error.code === 'FEATURE_UNAVAILABLE')
  }
})
