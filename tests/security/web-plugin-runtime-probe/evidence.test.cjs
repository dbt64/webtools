'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const evidencePath = path.join(__dirname, 'results', 'phase6e4a1-security-evidence.json')

test('packaged Phase 6E-4A.1 evidence exists and closes every required probe gate', t => {
  if (!fs.existsSync(evidencePath)) return t.skip('run the packaged probe runner to generate machine evidence')
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'))
  assert.equal(evidence.phase, '6E-4A.1')
  assert.equal(evidence.finalStatus, 'PASS')
  for (const id of ['cacheStorage', 'serviceWorker', 'navigation', 'loadFailure', 'rendererCrash', 'rendererUnresponsive', 'staleCallback', 'failurePathCleanup']) {
    assert.equal(evidence.testIds[id].status, 'PASS', `${id} must pass in packaged Electron evidence`)
  }
  assert.equal(evidence.testIds.cacheStorage.actual.networkRequests, 0)
  assert.equal(evidence.testIds.serviceWorker.actual.allowServiceWorkers, false)
  assert.equal(evidence.testIds.navigation.actual.invalidRuntimeRouteReturnsOnly404, true)
  assert.equal(evidence.testIds.serviceWorker.actual.allowServiceWorkers, false)
  assert.equal(evidence.testIds.navigation.actual.invalidRuntimeRouteReturnsOnly404, true)
  assert.equal(evidence.testIds.rendererUnresponsive.actual.graceBudgetMs, 2000)
  assert.equal(evidence.testIds.failurePathCleanup.actual.exactPackagedExecutableProcessesAfterExit, 0)
  const serialized = JSON.stringify(evidence)
  assert.doesNotMatch(serialized, /[A-Z]:\\|[A-Z]:\//i, 'evidence must not include absolute drive paths')
  assert.doesNotMatch(serialized, /\\Users\\|\\Documents\\|AppData\\/i, 'evidence must not include user profile paths')
})
