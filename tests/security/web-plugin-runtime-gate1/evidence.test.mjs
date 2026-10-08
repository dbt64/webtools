import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const evidence = JSON.parse(await readFile(new URL('./results/phase6e4c-gate1-evidence.json', import.meta.url), 'utf8'))

test('Gate 1 evidence distinguishes bounded baseline acceptance from unexercised assurance limitations', () => {
  assert.equal(evidence.schema, 'webtools.phase6e4c.gate1-evidence.v1')
  assert.equal(evidence.environment.productionInstallTouched, false)
  assert.equal(evidence.environment.applicationUserDataTouched, false)
  assert.equal(evidence.decision.gate1, 'ACCEPTED')
  assert.equal(evidence.decision.isolatedRuntimeBaselineAccepted, true)
  assert.equal(evidence.decision.assurance, 'BOUNDED / NON-EXHAUSTIVE')
  assert.equal(evidence.decision.gate4, 'NOT_CERTIFIED')
  assert.equal(evidence.decision.networkModeDomains, 'UNSUPPORTED')
  assert.equal(evidence.decision.phase6e5, 'READY')
  assert.ok(evidence.assuranceLimitations.length > 0)
  for (const limitation of evidence.assuranceLimitations) {
    assert.equal(limitation.tested, false)
    assert.equal(limitation.result, 'not-exercised')
    assert.equal(limitation.blocking, false)
  }
  for (const group of Object.values(evidence.groups)) {
    assert.equal(group.tested, true)
    assert.equal(group.result, 'pass')
  }
  assert.match(evidence.source.baselineCommit, /^[a-f0-9]{40}$/)
  assert.match(evidence.source.buildInput, /working tree/)
  assert.match(evidence.artifact.appAsarSha256, /^[a-f0-9]{64}$/)
  assert.equal(evidence.findings.p0 + evidence.findings.p1 + evidence.findings.blockingP2, 0)
  assert.equal(evidence.groups.snapshotAuthority.sourceArchiveDeletedAfterValidation, true)
  assert.equal(evidence.groups.snapshotAuthority.validatorInputBufferMutatedAfterValidation, true)
  assert.equal(evidence.groups.rendererIsolation.result, 'pass')
  assert.equal(evidence.groups.processCleanup.exactRemainingCount, 0)
  assert.equal(evidence.groups.networkNone.controlledSinkRequestCount, 0)
  assert.equal(evidence.groups.permissionsAndDownloads.downloadCancellationObserved, true)
  assert.equal(evidence.artifact.packagedExecutions, 6)
  assert.equal(evidence.artifact.exactPackagedExecutableRemainingProcessCount, 0)
  assert.equal(evidence.groups.lifecycle.staleGenerationCloseIgnored, true)
  assert.equal(evidence.groups.lifecycle.crashReinvocation, true)
  for (const scenario of evidence.packagedScenarios) {
    assert.equal(scenario.tested, true)
    assert.equal(scenario.result, 'pass')
  }
  const serialized = JSON.stringify(evidence)
  assert.doesNotMatch(serialized, /[A-Z]:\\|\\\\Users\\|%APPDATA%|Nook|token|secret|clipboard content/i)
})
