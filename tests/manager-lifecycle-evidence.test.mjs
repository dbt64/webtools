import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import {
  assertSafeManagerEvidenceRoot,
  createManagerLifecycleManifest,
  validateManagerLifecycleDSupplement,
  validateManagerLifecycleEvidence,
} from '../scripts/lib/manager-lifecycle-evidence.mjs'

const managerExe = 'C:\\acceptance\\Manager\\WebTools.exe'
const nativeExe = 'C:\\acceptance\\Native\\WebTools.NativeHost.exe'
const clone = value => structuredClone(value)

function main(pid, parentPid, hwnd) {
  return {
    pid, parentPid, path: managerExe, created: `2026-10-03T10:00:${String(pid % 60).padStart(2, '0')}.000Z`,
    role: 'main', commandLine: `"${managerExe}" --manager-only --phase4g-manager-test`,
    windows: [hwnd], privateBytes: 80_000_000, workingSet: 100_000_000, handles: 1000,
    threads: 50, gdi: 30, user: 50, exited: false,
  }
}

function group(record) {
  const pid = record.pid
  return [record, ...[
    ['gpu-process', pid + 1000], ['utility', pid + 2000], ['renderer', pid + 3000],
  ].map(([role, childPid]) => ({
    pid: childPid, parentPid: pid, path: managerExe, created: record.created, role,
    commandLine: `"${managerExe}" --type=${role}`, windows: [], exited: false,
  }))]
}

function addOpen(events, scenario, cycle, record) {
  events.push({
    type: 'manager-ready', scenario, cycle, main: record, members: group(record),
    processMs: 150, windowMs: 330, readyMs: 350,
  })
}

function addClose(events, scenario, cycle, record) {
  events.push({ type: 'manager-normal-exit', scenario, cycle, main: record, exitMs: 280, rendererErrors: [] })
}

function addExitProbe(events, scenario, cycle, record) {
  events.push({
    type: 'process-probe', scenario, cycle,
    records: [{ pid: record.parentPid, path: nativeExe, role: 'native', exited: false }],
  })
}

function fixture() {
  const events = []
  const report = {
    result: 'A-F PASS', sourceHead: 'a'.repeat(40), nativePid: 50, nativeExe, managerExe,
    artifacts: { nativeExe: '1'.repeat(64), nativeDll: '2'.repeat(64), managerExe: '3'.repeat(64), asar: '4'.repeat(64) },
    scenarios: {}, checkpoints: [],
  }

  report.scenarios.A = Array.from({ length: 5 }, (_, index) => {
    const record = main(100 + index, 50, 10_000 + index)
    addOpen(events, 'A', index + 1, record)
    addExitProbe(events, 'A', index + 1, record)
    addClose(events, 'A', index + 1, record)
    return { main: record, processMs: 150, windowMs: 330, readyMs: 350, electronCount: 4, rendererCount: 1, nativePid: 50, exitMs: 280 }
  })

  const reused = main(200, 50, 20_000)
  addOpen(events, 'B', 0, reused)
  addExitProbe(events, 'B', 0, reused)
  const reusedGroup = group(reused)
  report.scenarios.B = {
    requests: Array.from({ length: 20 }, (_, index) => ({
      index: index + 1,
      controller: { processId: reused.pid, connected: true, rendererReady: true, ensuring: false, pendingRequestId: null, pendingKind: null, intentGeneration: 3 + index },
      members: clone(reusedGroup),
    })),
    exitMs: 280,
  }
  addExitProbe(events, 'B', 20, reused)
  addClose(events, 'B', 20, reused)

  report.scenarios.C = Array.from({ length: 30 }, (_, index) => {
    const record = main(300 + index, 50, 30_000 + index)
    addOpen(events, 'C', index + 1, record)
    addExitProbe(events, 'C', index + 1, record)
    addClose(events, 'C', index + 1, record)
    return { main: record, processMs: 150, windowMs: 330, readyMs: 350, electronCount: 4, rendererCount: 1, exitMs: 280 }
  })

  report.scenarios.D = ['settings', 'favorites', 'translate', 'page-switch'].map((section, index) => {
    const record = main(400 + index, 50, 40_000 + index)
    const eventScenario = section === 'page-switch' ? 'D-page-switch' : `D-${section}`
    addOpen(events, eventScenario, 0, record)
    const operationProof = section === 'settings'
      ? { kind: section, persisted: true, theme: 'light' }
      : section === 'favorites'
        ? { kind: section, dialogOpen: true, inputValue: 'unsaved local state' }
        : section === 'translate'
          ? { kind: section, sourceText: 'local unsent test', providerConfigured: false }
          : { kind: section, routes: ['设置', '网址', '翻译', '网址'] }
    events.push({ type: 'manager-operation', scenario: eventScenario, cycle: 0, main: record, operationProof })
    addExitProbe(events, eventScenario, 0, record)
    addClose(events, eventScenario, 0, record)
    return { section, operationProof, main: record, processMs: 150, windowMs: 330, readyMs: 350, electronCount: 4, rendererCount: 1, exitMs: 280 }
  })

  const handoff = main(500, 50, 50_000)
  const reconnect = main(501, 50, 50_001)
  addOpen(events, 'E-cold-handoff', 0, handoff)
  addExitProbe(events, 'E-cold-handoff', 0, handoff)
  addClose(events, 'E-cold-handoff', 0, handoff)
  addOpen(events, 'E-reconnect', 0, reconnect)
  addExitProbe(events, 'E-reconnect', 0, reconnect)
  addClose(events, 'E-reconnect', 0, reconnect)
  report.scenarios.E = {
    exact: '  Phase G test exact text  ', next: 'Second handoff exact text',
    intents: [{ requestId: 'request-1', kind: 'translation-prefill', text: 'Second handoff exact text' }],
    mainPid: handoff.pid, reopenedPid: reconnect.pid, firstExit: 280, secondExit: 280,
    shown: { windowVisible: true },
    queried: { resultCount: 1, resultKinds: ['Website'] },
    hidden: { windowVisible: false, query: '', resultCount: 0, resultKinds: [] },
  }

  const terminated = main(600, 50, 60_000)
  const recovered = main(601, 50, 60_001)
  addOpen(events, 'F-terminate-main', 0, terminated)
  events.push({ type: 'process-probe', scenario: 'F-terminate-main', cycle: 0, records: [{ pid: 50, path: nativeExe, role: 'native', exited: false }] })
  addOpen(events, 'F-terminate-main', 0, recovered)
  addExitProbe(events, 'F-terminate-main', 0, recovered)
  addClose(events, 'F-terminate-main', 0, recovered)
  report.scenarios.F = {
    terminatedMain: terminated, beforeCrash: group(terminated), recoveredMain: recovered, exitMs: 280,
  }
  report.checkpoints = [{
    stage: 'F-crash-recovered-native-only',
    records: [{ pid: 50, path: nativeExe, role: 'native', exited: false }],
    controller: { processId: null, connected: false, rendererReady: false, ensuring: false },
  }]

  const eventsText = events.map(event => JSON.stringify(event)).join('\n') + '\n'
  report.evidenceManifest = createManagerLifecycleManifest(report, eventsText)
  return { report, eventsText }
}

function evaluate(report, eventsText) {
  return validateManagerLifecycleEvidence(report, eventsText, report.evidenceManifest)
}

test('acceptance driver validates its evidence root before creating profile data', t => {
  const parent = mkdtempSync(join(tmpdir(), 'webtools-evidence-root-test-'))
  t.after(() => rmSync(parent, { recursive: true, force: true }))
  const root = join(parent, 'evidence')
  mkdirSync(root)
  assert.equal(assertSafeManagerEvidenceRoot(root), realpathSync.native(root))
  assert.throws(() => assertSafeManagerEvidenceRoot('relative-evidence-root'), /absolute/i)
  assert.throws(() => assertSafeManagerEvidenceRoot(`${tmpdir()}-outside`), /temporary/i)
  assert.throws(() => assertSafeManagerEvidenceRoot(join(parent, 'missing')), /ENOENT|directory|reparse/i)
})

test('acceptance driver rejects an evidence-root junction into the real Nook profile', t => {
  if (process.platform !== 'win32') {
    t.skip('Windows junction/reparse-point behavior is verified on Windows')
    return
  }
  const protectedProfile = join(process.env.APPDATA ?? '', 'Nook')
  if (!existsSync(protectedProfile)) {
    t.skip('The real Nook profile is absent, so an evidence-root escape cannot be exercised on this host')
    return
  }
  const parent = mkdtempSync(join(tmpdir(), 'webtools-evidence-junction-test-'))
  const junction = join(parent, 'evidence-junction')
  t.after(() => {
    try { unlinkSync(junction) } catch { /* Link may not have been created. */ }
    rmSync(parent, { recursive: true, force: true })
  })
  symlinkSync(protectedProfile, junction, 'junction')
  assert.throws(() => assertSafeManagerEvidenceRoot(junction), /junction|reparse|temporary/i)
})

test('complete Manager lifecycle evidence is based on successful runtime facts', () => {
  const { report, eventsText } = fixture()
  assert.deepEqual(evaluate(report, eventsText), { status: 'PASS', issues: [], supersededInfrastructureFailures: [] })
})

test('completed-looking evidence without a manifest is incomplete', () => {
  const { report, eventsText } = fixture()
  delete report.evidenceManifest
  assert.equal(validateManagerLifecycleEvidence(report, eventsText).status, 'EVIDENCE INCOMPLETE')
})

test('missing Scenario E is incomplete', () => {
  const { report, eventsText } = fixture()
  delete report.scenarios.E
  report.evidenceManifest = createManagerLifecycleManifest(report, eventsText)
  assert.equal(evaluate(report, eventsText).status, 'EVIDENCE INCOMPLETE')
})

test('Scenario A with only four successful rounds fails', () => {
  const { report, eventsText } = fixture()
  report.scenarios.A.pop()
  report.evidenceManifest = createManagerLifecycleManifest(report, eventsText)
  assert.notEqual(evaluate(report, eventsText).status, 'PASS')
})

test('Scenario A rejects a round that did not reach ready state', () => {
  const { report, eventsText } = fixture()
  report.scenarios.A[0].readyMs = 0
  report.evidenceManifest = createManagerLifecycleManifest(report, eventsText)
  assert.notEqual(evaluate(report, eventsText).status, 'PASS')
})

test('Scenario B rejects a second independent Manager', () => {
  const { report, eventsText } = fixture()
  report.scenarios.B.requests[1].controller.processId += 1
  report.evidenceManifest = createManagerLifecycleManifest(report, eventsText)
  assert.notEqual(evaluate(report, eventsText).status, 'PASS')
})

test('Scenario C rejects a failed normal close', () => {
  const { report, eventsText } = fixture()
  report.scenarios.C[4].exitMs = 0
  report.evidenceManifest = createManagerLifecycleManifest(report, eventsText)
  assert.notEqual(evaluate(report, eventsText).status, 'PASS')
})

test('Scenario C rejects a residual Electron process', () => {
  const { report, eventsText } = fixture()
  report.scenarios.C[4].electronCount = 5
  report.evidenceManifest = createManagerLifecycleManifest(report, eventsText)
  assert.notEqual(evaluate(report, eventsText).status, 'PASS')
})

test('Scenario E rejects a failed reconnect', () => {
  const { report, eventsText } = fixture()
  report.scenarios.E.reopenedPid = report.scenarios.E.mainPid
  report.evidenceManifest = createManagerLifecycleManifest(report, eventsText)
  assert.notEqual(evaluate(report, eventsText).status, 'PASS')
})

test('Scenario F requires product recovery evidence before the final close', () => {
  const { report, eventsText } = fixture()
  report.checkpoints = []
  report.evidenceManifest = createManagerLifecycleManifest(report, eventsText)
  assert.notEqual(evaluate(report, eventsText).status, 'PASS')
})

test('a NativeHost PID mismatch fails identity validation', () => {
  const { report, eventsText } = fixture()
  report.scenarios.C[2].main.parentPid += 1
  report.evidenceManifest = createManagerLifecycleManifest(report, eventsText)
  assert.notEqual(evaluate(report, eventsText).status, 'PASS')
})

test('a manifest that does not match scenario records or event bytes is invalid', () => {
  const { report, eventsText } = fixture()
  report.scenarios.D[0].section = 'unexpected'
  assert.equal(evaluate(report, eventsText).status, 'EVIDENCE INVALID')
})

test('Scenario D business result must be recorded inside the live Manager interval', () => {
  const { report, eventsText } = fixture()
  const events = eventsText.split(/\r?\n/).filter(Boolean).map(JSON.parse)
  const index = events.findIndex(event => event.type === 'manager-operation' && event.scenario === 'D-favorites')
  events.splice(index, 1)
  const missingOperationText = events.map(event => JSON.stringify(event)).join('\n') + '\n'
  report.evidenceManifest = createManagerLifecycleManifest(report, missingOperationText)
  assert.equal(evaluate(report, missingOperationText).status, 'EVIDENCE INCOMPLETE')
})

test('independent Scenario D supplement closes only the historical operation-proof gap', () => {
  const { report: historical, eventsText: supplementEvents } = fixture()
  const supplement = clone(historical)
  supplement.result = 'D SUPPLEMENT PASS'
  supplement.scenarios = { D: clone(historical.scenarios.D) }
  supplement.evidenceManifest = createManagerLifecycleManifest(supplement, supplementEvents)

  const oldEvents = supplementEvents.split(/\r?\n/).filter(Boolean)
    .map(JSON.parse).filter(event => event.type !== 'manager-operation')
    .map(event => JSON.stringify(event)).join('\n') + '\n'
  const base = clone(historical)
  for (const run of base.scenarios.D) delete run.operationProof
  base.evidenceManifest = createManagerLifecycleManifest(base, oldEvents)

  assert.equal(validateManagerLifecycleDSupplement(supplement, supplementEvents).status, 'PASS')
  assert.equal(validateManagerLifecycleEvidence(base, oldEvents, base.evidenceManifest, {
    scenarioDSupplement: { report: supplement, eventsText: supplementEvents },
  }).status, 'PASS')
  assert.equal(evaluate(base, oldEvents).status, 'EVIDENCE INCOMPLETE', 'the historical evidence remains incomplete without its supplement')
})

test('an incomplete or explicitly failed resume can never report PASS', () => {
  const { report, eventsText } = fixture()
  report.result = 'INCOMPLETE'
  report.scenarios.B.requests.pop()
  report.evidenceManifest = createManagerLifecycleManifest(report, eventsText)
  assert.notEqual(evaluate(report, eventsText).status, 'PASS')
})

test('the real --resume entry rejects an incomplete completed-looking report before creating profile data', t => {
  const root = mkdtempSync(join(tmpdir(), 'webtools-manager-resume-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, 'report.json'), JSON.stringify({ result: 'A-F PASS', scenarios: {} }))
  writeFileSync(join(root, 'events.jsonl'), '')
  const driver = resolve('scripts/verify-manager-lifecycle.mjs')
  const result = spawnSync(process.execPath, ['--experimental-strip-types', driver, root, '--resume'], {
    encoding: 'utf8',
    timeout: 15_000,
  })
  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(`${result.stdout}\n${result.stderr}`, /evidence manifest is missing/i)
  assert.equal(existsSync(join(root, 'profile')), false, 'resume validation must happen before profile creation')
  assert.equal(existsSync(join(root, 'stage.json')), false, 'resume validation must happen before NativeHost startup')
})

test('unclassified failure events block final PASS', () => {
  const { report, eventsText } = fixture()
  const brokenEvents = `${eventsText}${JSON.stringify({ type: 'failure', scenario: 'C', message: 'Manager failed' })}\n`
  report.evidenceManifest = createManagerLifecycleManifest(report, brokenEvents)
  assert.notEqual(evaluate(report, brokenEvents).status, 'PASS')
})

test('known superseded harness errors are tolerated only at their recorded scenario and cycle', () => {
  const { report, eventsText } = fixture()
  const unexpected = `${eventsText}${JSON.stringify({ type: 'failure', scenario: 'A', cycle: 99, message: 'GetGuiResources(IntPtr) failed' })}\n`
  report.evidenceManifest = createManagerLifecycleManifest(report, unexpected)
  assert.equal(evaluate(report, unexpected).status, 'EVIDENCE INVALID')
})
