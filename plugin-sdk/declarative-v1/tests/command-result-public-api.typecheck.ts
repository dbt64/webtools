import { defineCommand, type FeatureTextResult } from '../node.mjs'
defineCommand(() => {})
defineCommand(async invocation => {
  if (invocation.resultTarget !== 'super-panel') return
  const value: FeatureTextResult = { kind: 'text', text: 'bounded' }
  return value
})
// @ts-expect-error HTML is not a supported command result
defineCommand(() => ({ kind: 'html', html: '<b>no</b>' }))
