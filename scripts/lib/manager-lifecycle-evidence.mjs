import { createHash } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

const MANAGER_ROLES = ['main', 'gpu-process', 'utility', 'renderer']

function isSameOrChildPath(root, candidate) {
  const pathFromRoot = relative(resolve(root), resolve(candidate))
  return pathFromRoot === ''
    || (pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot))
}

/** Verify the driver output root before it creates or seeds any acceptance profile files. */
export function assertSafeManagerEvidenceRoot(root, userProfilePath = join(process.env.APPDATA ?? '', 'Nook')) {
  if (!isAbsolute(root)) throw new Error('Evidence root must be an absolute path.')
  const requestedRoot = resolve(root)
  const tempPaths = [...new Set([resolve(tmpdir()), realpathSync.native(tmpdir())])]
  const containingTemp = tempPaths.find(tempPath => isSameOrChildPath(tempPath, requestedRoot) && resolve(tempPath) !== requestedRoot)
  if (!containingTemp) throw new Error('Evidence root must be a strict descendant of the current user temporary directory.')

  let current = containingTemp
  const relativeRoot = relative(containingTemp, requestedRoot)
  for (const part of relativeRoot.split(sep).filter(Boolean)) {
    current = join(current, part)
    const stats = lstatSync(current)
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error('Evidence root path must use existing directories and cannot traverse a junction or reparse point.')
    }
  }

  const realRoot = realpathSync.native(requestedRoot)
  const realTemp = realpathSync.native(tmpdir())
  if (!isSameOrChildPath(realTemp, realRoot) || resolve(realTemp) === resolve(realRoot)) {
    throw new Error('Evidence root resolves outside the current user temporary directory.')
  }
  let protectedProfile = resolve(userProfilePath)
  try { protectedProfile = realpathSync.native(protectedProfile) } catch { /* Preserve the lexical reserved path when it is not created yet. */ }
  if (isSameOrChildPath(protectedProfile, realRoot) || isSameOrChildPath(realRoot, protectedProfile)) {
    throw new Error('Evidence root cannot overlap the real WebTools user profile.')
  }
  return realRoot
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  }
  return value
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function scenarioCounts(scenarios = {}) {
  return {
    A: Array.isArray(scenarios.A) ? scenarios.A.length : 0,
    B: Array.isArray(scenarios.B?.requests) ? scenarios.B.requests.length : 0,
    C: Array.isArray(scenarios.C) ? scenarios.C.length : 0,
    D: Array.isArray(scenarios.D) ? scenarios.D.length : 0,
    E: Array.isArray(scenarios.E?.intents) ? scenarios.E.intents.length : 0,
    F: Number.isInteger(scenarios.F?.terminatedMain?.pid) && Number.isInteger(scenarios.F?.recoveredMain?.pid) ? 1 : 0,
  }
}

function parseEvents(eventsText) {
  try {
    return eventsText.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
  } catch (error) {
    throw new Error(`event log is not valid JSONL: ${String(error)}`)
  }
}

function classifySupersededFailure(event) {
  const message = String(event?.message ?? '')
  if (event?.scenario === 'A' && event?.cycle === 5 && message.includes('GetGuiResources') && message.includes('IntPtr')) {
    return 'Known process-sampler error while reading GUI counters; the final matching A cycle has an independent ready/normal-exit pair.'
  }
  if (event?.scenario === 'F-terminate-main' && event?.cycle === 0 && message.startsWith('PID creation time changed.')) {
    return 'Known CIM/Process timestamp precision mismatch aborted the earlier F attempt; the final F attempt has identity and recovery evidence.'
  }
  return null
}

/** Hashes the immutable scenario records and event log used to decide acceptance. */
export function createManagerLifecycleManifest(report, eventsText) {
  const events = parseEvents(eventsText)
  const eventCounts = Object.create(null)
  for (const event of events) {
    const key = `${event.type ?? 'unknown'}:${event.scenario ?? 'unknown'}`
    eventCounts[key] = (eventCounts[key] ?? 0) + 1
  }
  const supersededFailures = events
    .filter(event => event.type === 'failure')
    .map(event => ({
      scenario: event.scenario ?? null,
      cycle: event.cycle ?? null,
      messageSha256: sha256(String(event.message ?? '')),
      classification: classifySupersededFailure(event),
    }))

  return {
    schemaVersion: 1,
    sourceHead: report.sourceHead ?? null,
    runtimeIdentitySha256: sha256(JSON.stringify(canonical({
      sourceHead: report.sourceHead ?? null,
      nativePid: report.nativePid ?? null,
      nativeExe: report.nativeExe ?? null,
      managerExe: report.managerExe ?? null,
      artifacts: report.artifacts ?? null,
    }))),
    artifacts: canonical(report.artifacts ?? null),
    scenarioCounts: scenarioCounts(report.scenarios),
    scenarioSha256: sha256(JSON.stringify(canonical(report.scenarios ?? null))),
    eventLogSha256: sha256(eventsText),
    eventCounts: canonical(eventCounts),
    supersededFailures,
  }
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function isPositiveNumber(value) {
  return Number.isFinite(value) && value > 0
}

function normalizePath(value) {
  return typeof value === 'string' ? value.replaceAll('/', '\\').toLowerCase() : ''
}

function sameMainIdentity(left, right) {
  return Boolean(left && right)
    && left.pid === right.pid
    && left.parentPid === right.parentPid
    && left.role === 'main'
    && right.role === 'main'
    && normalizePath(left.path) === normalizePath(right.path)
    && left.created === right.created
    && JSON.stringify(left.windows) === JSON.stringify(right.windows)
}

function validMain(main, report) {
  return isPositiveInteger(main?.pid)
    && isPositiveInteger(main?.parentPid)
    && main.role === 'main'
    && normalizePath(main.path) === normalizePath(report.managerExe)
    && typeof main.created === 'string'
    && main.created.length > 0
    && Array.isArray(main.windows)
    && main.windows.length === 1
    && isPositiveInteger(main.windows[0])
    && main.exited === false
    && typeof main.commandLine === 'string'
    && main.commandLine.includes('--manager-only')
    && main.commandLine.includes('--phase4g-manager-test')
}

function validGroup(members, main, report) {
  if (!Array.isArray(members) || members.length !== MANAGER_ROLES.length) return false
  if (new Set(members.map(member => member.pid)).size !== members.length) return false
  if (!MANAGER_ROLES.every(role => members.filter(member => member.role === role).length === 1)) return false
  if (!members.every(member => normalizePath(member.path) === normalizePath(report.managerExe))) return false
  const groupMain = members.find(member => member.role === 'main')
  if (!sameMainIdentity(groupMain, main)) return false
  return members.filter(member => member.role !== 'main').every(member => member.parentPid === main.pid)
}

function findUniqueEvent(events, type, scenario, cycle, pid) {
  const matches = []
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (event.type === type && event.scenario === scenario && event.cycle === cycle && event.main?.pid === pid) {
      matches.push({ event, index })
    }
  }
  return matches.length === 1 ? matches[0] : null
}

function hasNativeProbe(events, scenario, cycle, nativePid, report) {
  return events.some(event => event.type === 'process-probe'
    && event.scenario === scenario
    && (event.cycle === cycle || event.cycle === 0)
    && Array.isArray(event.records)
    && event.records.some(record => record.role === 'native'
      && record.pid === nativePid
      && normalizePath(record.path) === normalizePath(report.nativeExe)
      && record.exited === false))
}

function addIssue(issues, scenario, message) {
  issues.push(`${scenario}: ${message}`)
}

function validateRun({ run, scenario, cycle, eventScenario = scenario, eventCycle = cycle, report, events, issues }) {
  const prefix = `${scenario}${cycle === null ? '' : `/${cycle}`}`
  if (!validMain(run?.main, report)) {
    addIssue(issues, scenario, `${prefix} lacks a valid Manager Main identity and visible HWND.`)
    return null
  }
  if (![run.processMs, run.windowMs, run.readyMs, run.exitMs].every(isPositiveNumber)) {
    addIssue(issues, scenario, `${prefix} lacks positive process/window/renderer-ready/normal-exit timings.`)
  }
  const ready = findUniqueEvent(events, 'manager-ready', eventScenario, eventCycle, run.main.pid)
  const close = findUniqueEvent(events, 'manager-normal-exit', eventScenario, eventCycle, run.main.pid)
  if (!ready || !close) {
    addIssue(issues, scenario, `${prefix} lacks a unique matching ready and normal-close event.`)
    return null
  }
  if (!sameMainIdentity(ready.event.main, run.main)
    || ready.event.processMs !== run.processMs
    || ready.event.windowMs !== run.windowMs
    || ready.event.readyMs !== run.readyMs
    || !isPositiveNumber(ready.event.processMs)
    || !isPositiveNumber(ready.event.windowMs)
    || !isPositiveNumber(ready.event.readyMs)
    || !validGroup(ready.event.members, run.main, report)) {
    addIssue(issues, scenario, `${prefix} ready event does not prove one visible, renderer-ready Manager process group.`)
  }
  if (!sameMainIdentity(close.event.main, run.main)
    || !isPositiveNumber(close.event.exitMs)
    || close.event.exitMs !== run.exitMs
    || !Array.isArray(close.event.rendererErrors)
    || close.event.rendererErrors.length !== 0) {
    addIssue(issues, scenario, `${prefix} normal-close event is missing, failed, or reports renderer errors.`)
  }
  if (!hasNativeProbe(events, eventScenario, eventCycle, run.main.parentPid, report)) {
    addIssue(issues, scenario, `${prefix} has no matching live NativeHost process identity.`)
  }
  const exitedGroup = events.slice(ready.index + 1, close.index).some(event => event.type === 'process-probe'
    && event.scenario === eventScenario
    && (event.cycle === eventCycle || event.cycle === 0)
    && Array.isArray(event.records)
    && event.records.some(record => record.role === 'native' && record.pid === run.main.parentPid && record.exited === false)
    && !event.records.some(record => normalizePath(record.path) === normalizePath(report.managerExe)))
  if (!exitedGroup) addIssue(issues, scenario, `${prefix} has no process snapshot proving the Manager group reached zero before close was recorded.`)
  return { ready, close }
}

function validReadySummary(run) {
  return run?.electronCount === MANAGER_ROLES.length && run?.rendererCount === 1
}

function validateScenarios(report, events, issues, externallyVerifiedDSections = new Set()) {
  if (!/^[a-f0-9]{40}$/i.test(report.sourceHead ?? '')
    || !isPositiveInteger(report.nativePid)
    || !normalizePath(report.nativeExe).endsWith('\\webtools.nativehost.exe')
    || !normalizePath(report.managerExe).endsWith('\\webtools.exe')
    || !report.artifacts
    || !['nativeExe', 'nativeDll', 'managerExe', 'asar'].every(key => /^[a-f0-9]{64}$/i.test(report.artifacts[key] ?? ''))) {
    addIssue(issues, 'Runtime identity', 'source, NativeHost/Manager executable paths, or release artifact hashes are invalid or incomplete.')
  }
  const scenarios = report.scenarios ?? {}
  if (!Array.isArray(scenarios.A) || scenarios.A.length !== 5) addIssue(issues, 'A', 'expected five completed rounds.')
  else scenarios.A.forEach((run, index) => {
    if (!validReadySummary(run) || (run.nativePid !== undefined && run.main?.parentPid !== run.nativePid)) {
      addIssue(issues, 'A', `round ${index + 1} has invalid process-group or NativeHost state.`)
    }
    validateRun({ run, scenario: 'A', cycle: index + 1, report, events, issues })
  })

  const requests = scenarios.B?.requests
  if (!Array.isArray(requests) || requests.length !== 20) addIssue(issues, 'B', 'expected 20 completed Manager reuse requests.')
  else {
    const first = requests[0]
    const main = first?.members?.find(member => member.role === 'main')
    const mainPid = main?.pid
    const hwnd = main?.windows?.[0]
    const groupIdentity = JSON.stringify((first?.members ?? []).map(member => [member.role, member.pid, member.parentPid, member.created]).sort())
    let priorGeneration = -Infinity
    requests.forEach((request, index) => {
      const controller = request?.controller
      const requestMain = request?.members?.find(member => member.role === 'main')
      if (request.index !== index + 1
        || controller?.processId !== mainPid
        || controller.connected !== true
        || controller.rendererReady !== true
        || controller.ensuring !== false
        || controller.pendingRequestId !== null
        || !isPositiveInteger(controller.intentGeneration)
        || controller.intentGeneration <= priorGeneration
        || !validGroup(request.members, main, report)
        || requestMain?.windows?.[0] !== hwnd
        || JSON.stringify(request.members.map(member => [member.role, member.pid, member.parentPid, member.created]).sort()) !== groupIdentity) {
        addIssue(issues, 'B', `request ${index + 1} did not reuse the same acknowledged Manager process/window.`)
      }
      priorGeneration = controller?.intentGeneration ?? priorGeneration
    })
    if (main) {
      const ready = findUniqueEvent(events, 'manager-ready', 'B', 0, mainPid)
      const close = findUniqueEvent(events, 'manager-normal-exit', 'B', 20, mainPid)
      if (!ready || !close) addIssue(issues, 'B', 'the reused Manager lacks its start/normal-close evidence.')
      else {
        const hostPid = main.parentPid
        if (!hasNativeProbe(events, 'B', 0, hostPid, report)) addIssue(issues, 'B', 'NativeHost was not observed during the reuse window.')
        const exitedGroup = events.slice(ready.index + 1, close.index).some(event => event.type === 'process-probe'
          && event.scenario === 'B'
          && event.records?.some(record => record.role === 'native' && record.pid === hostPid && record.exited === false)
          && !event.records.some(record => normalizePath(record.path) === normalizePath(report.managerExe)))
        if (!isPositiveNumber(scenarios.B.exitMs) || !isPositiveNumber(close.event.exitMs)
          || scenarios.B.exitMs !== close.event.exitMs
          || !Array.isArray(close.event.rendererErrors) || close.event.rendererErrors.length !== 0
          || !sameMainIdentity(close.event.main, main)
          || !exitedGroup) addIssue(issues, 'B', 'final Manager group did not prove normal zero-process close.')
      }
    }
  }

  if (!Array.isArray(scenarios.C) || scenarios.C.length !== 30) addIssue(issues, 'C', 'expected 30 complete open/close cycles.')
  else {
    const hostPids = new Set(scenarios.C.map(run => run.main?.parentPid))
    if (hostPids.size !== 1 || ![...hostPids].every(isPositiveInteger)) addIssue(issues, 'C', 'NativeHost identity changed during the 30-cycle scenario.')
    scenarios.C.forEach((run, index) => {
      if (!validReadySummary(run)) addIssue(issues, 'C', `cycle ${index + 1} did not exit its full four-process Manager group.`)
      validateRun({ run, scenario: 'C', cycle: index + 1, report, events, issues })
    })
  }

  const dSections = ['settings', 'favorites', 'translate', 'page-switch']
  if (!Array.isArray(scenarios.D) || scenarios.D.length !== dSections.length
    || !dSections.every(section => scenarios.D.some(run => run.section === section))) {
    addIssue(issues, 'D', 'expected settings, favorites, translation, and page-switch acceptance cases.')
  } else {
    for (const section of dSections) {
      const run = scenarios.D.find(item => item.section === section)
      const expectedProof = section === 'settings'
        ? run.operationProof?.kind === 'settings' && run.operationProof.persisted === true && run.operationProof.theme === 'light'
        : section === 'favorites'
          ? run.operationProof?.kind === 'favorites' && run.operationProof.dialogOpen === true && run.operationProof.inputValue === 'unsaved local state'
          : section === 'translate'
            ? run.operationProof?.kind === 'translate' && run.operationProof.sourceText === 'local unsent test' && run.operationProof.providerConfigured === false
            : run.operationProof?.kind === 'page-switch'
              && JSON.stringify(run.operationProof.routes) === JSON.stringify(['设置', '网址', '翻译', '网址'])
      if (!expectedProof && !externallyVerifiedDSections.has(section)) addIssue(issues, 'D', `${section} lacks persisted/observed business-operation proof.`)
      if (!validReadySummary(run)) addIssue(issues, 'D', `${section} did not exit its full four-process Manager group.`)
      const eventScenario = section === 'page-switch' ? 'D-page-switch' : `D-${section}`
      const lifecycle = validateRun({ run, scenario: 'D', cycle: null, eventScenario, eventCycle: 0, report, events, issues })
      if (expectedProof && lifecycle) validateDOperationEvent(run, section, eventScenario, report, events, issues, 'D')
    }
  }

  const e = scenarios.E
  if (!e || typeof e.exact !== 'string' || !e.exact.length || typeof e.next !== 'string' || !e.next.length
    || e.intents?.length !== 1 || e.intents[0]?.kind !== 'translation-prefill'
    || e.intents[0]?.text !== e.next || typeof e.intents[0]?.requestId !== 'string'
    || e.intents[0].requestId.length === 0 || e.mainPid === e.reopenedPid
    || !isPositiveNumber(e.firstExit) || !isPositiveNumber(e.secondExit)
    || e.shown?.windowVisible !== true
    || e.queried?.resultCount !== 1 || !e.queried.resultKinds?.includes('Website')
    || e.hidden?.windowVisible !== false || e.hidden.query !== '' || e.hidden.resultCount !== 0
    || e.hidden.resultKinds?.length !== 0) {
    addIssue(issues, 'E', 'handoff, Native website projection, close, and reconnect results are incomplete or inconsistent.')
  } else {
    for (const [eventScenario, pid, exitMs] of [
      ['E-cold-handoff', e.mainPid, e.firstExit], ['E-reconnect', e.reopenedPid, e.secondExit],
    ]) {
      const ready = events.filter(event => event.type === 'manager-ready' && event.scenario === eventScenario && event.main?.pid === pid)
      const close = events.filter(event => event.type === 'manager-normal-exit' && event.scenario === eventScenario && event.main?.pid === pid)
      if (ready.length !== 1 || close.length !== 1 || !validMain(ready[0]?.main, report)
        || !validGroup(ready[0]?.members, ready[0]?.main, report)
        || !isPositiveNumber(ready[0]?.readyMs)
        || !isPositiveNumber(close[0]?.exitMs) || close[0]?.exitMs !== exitMs
        || !sameMainIdentity(close[0]?.main, ready[0]?.main)
        || !Array.isArray(close[0]?.rendererErrors) || close[0].rendererErrors.length !== 0) {
        addIssue(issues, 'E', `${eventScenario} is missing a matching ready/normal-exit group.`)
      } else {
        const readyIndex = events.indexOf(ready[0])
        const closeIndex = events.indexOf(close[0])
        const parentPid = ready[0].main.parentPid
        const exitedGroup = events.slice(readyIndex + 1, closeIndex).some(event => event.type === 'process-probe'
          && event.scenario === eventScenario
          && event.records?.some(record => record.role === 'native' && record.pid === parentPid && record.exited === false)
          && !event.records.some(record => normalizePath(record.path) === normalizePath(report.managerExe)))
        if (!exitedGroup) addIssue(issues, 'E', `${eventScenario} did not prove Manager group exit while NativeHost remained.`)
      }
    }
  }

  const f = scenarios.F
  const fCheckpoint = (report.checkpoints ?? []).find(checkpoint => checkpoint.stage === 'F-crash-recovered-native-only')
  if (!validMain(f?.terminatedMain, report) || !validMain(f?.recoveredMain, report)
    || f.terminatedMain.pid === f.recoveredMain.pid
    || f.terminatedMain.parentPid !== report.nativePid
    || f.recoveredMain.parentPid !== report.nativePid
    || !validGroup(f.beforeCrash, f.terminatedMain, report)
    || !isPositiveNumber(f.exitMs)
    || !fCheckpoint
    || fCheckpoint.controller?.processId !== null || fCheckpoint.controller?.connected !== false
    || fCheckpoint.controller?.rendererReady !== false || fCheckpoint.controller?.ensuring !== false
    || fCheckpoint.records?.filter(record => normalizePath(record.path) === normalizePath(report.managerExe)).length !== 0
    || !fCheckpoint.records?.some(record => record.pid === report.nativePid && record.role === 'native'
      && normalizePath(record.path) === normalizePath(report.nativeExe) && record.exited === false)) {
    addIssue(issues, 'F', 'unexpected-exit identity, pre-recovery group, Native-only recovery checkpoint, or normal replacement close is missing.')
  } else {
    const firstReady = findUniqueEvent(events, 'manager-ready', 'F-terminate-main', 0, f.terminatedMain.pid)
    const recoveredReady = findUniqueEvent(events, 'manager-ready', 'F-terminate-main', 0, f.recoveredMain.pid)
    const recoveredClose = findUniqueEvent(events, 'manager-normal-exit', 'F-terminate-main', 0, f.recoveredMain.pid)
    const noGroupBeforeRecovery = firstReady && recoveredReady && events.slice(firstReady.index + 1, recoveredReady.index).some(event => event.type === 'process-probe'
      && event.scenario === 'F-terminate-main'
      && event.records?.some(record => record.role === 'native' && record.pid === report.nativePid && record.exited === false)
      && !event.records.some(record => normalizePath(record.path) === normalizePath(report.managerExe)))
    if (!firstReady || !recoveredReady || !recoveredClose
      || !sameMainIdentity(firstReady.event.main, f.terminatedMain)
      || !validGroup(firstReady.event.members, f.terminatedMain, report)
      || !validMain(recoveredReady.event.main, report)
      || !validGroup(recoveredReady.event.members, f.recoveredMain, report)
      || !isPositiveNumber(recoveredReady.event.readyMs)
      || !isPositiveNumber(recoveredClose.event.exitMs) || recoveredClose.event.exitMs !== f.exitMs
      || !sameMainIdentity(recoveredClose.event.main, f.recoveredMain)
      || !Array.isArray(recoveredClose.event.rendererErrors) || recoveredClose.event.rendererErrors.length !== 0
      || !noGroupBeforeRecovery) {
      addIssue(issues, 'F', 'the terminated isolated Main identity, product child cleanup, recovery launch, or normal close lacks matching event evidence.')
    }
  }

  const failureEvents = events.filter(event => event.type === 'failure')
  const unknownFailures = failureEvents.filter(event => !classifySupersededFailure(event))
  if (unknownFailures.length) addIssue(issues, 'Failure log', `${unknownFailures.length} unclassified failure event(s) remain.`)
  return { failureEvents, unknownFailures }
}

function hasValidRuntimeIdentity(report) {
  return /^[a-f0-9]{40}$/i.test(report.sourceHead ?? '')
    && isPositiveInteger(report.nativePid)
    && normalizePath(report.nativeExe).endsWith('\\webtools.nativehost.exe')
    && normalizePath(report.managerExe).endsWith('\\webtools.exe')
    && report.artifacts
    && ['nativeExe', 'nativeDll', 'managerExe', 'asar'].every(key => /^[a-f0-9]{64}$/i.test(report.artifacts[key] ?? ''))
}

function expectedDOperationProof(section, proof) {
  return section === 'settings'
    ? proof?.kind === 'settings' && proof.persisted === true && proof.theme === 'light'
    : section === 'favorites'
      ? proof?.kind === 'favorites' && proof.dialogOpen === true && proof.inputValue === 'unsaved local state'
      : section === 'translate'
        ? proof?.kind === 'translate' && proof.sourceText === 'local unsent test' && proof.providerConfigured === false
        : section === 'page-switch'
          && proof?.kind === 'page-switch'
          && JSON.stringify(proof.routes) === JSON.stringify(['设置', '网址', '翻译', '网址'])
}

function validateDOperationEvent(run, section, eventScenario, report, events, issues, scenarioLabel = 'D supplement') {
  const lifecycle = validateRun({ run, scenario: scenarioLabel, cycle: null, eventScenario, eventCycle: 0, report, events, issues })
  if (!expectedDOperationProof(section, run?.operationProof)) {
    addIssue(issues, scenarioLabel, `${section} has no valid observed operation result.`)
    return
  }
  const operations = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.type === 'manager-operation'
      && event.scenario === eventScenario
      && event.cycle === 0
      && event.main?.pid === run?.main?.pid)
  if (!lifecycle || operations.length !== 1) {
    addIssue(issues, scenarioLabel, `${section} lacks one operation event bracketed by its Manager lifecycle.`)
    return
  }
  const { event, index } = operations[0]
  if (!sameMainIdentity(event.main, run.main)
    || JSON.stringify(canonical(event.operationProof)) !== JSON.stringify(canonical(run.operationProof))
    || index <= lifecycle.ready.index
    || index >= lifecycle.close.index) {
    addIssue(issues, scenarioLabel, `${section} operation event is mismatched or outside the live Manager interval.`)
  }
}

/** Validate the independently built real-Manager Scenario D operation supplement. */
export function validateManagerLifecycleDSupplement(report, eventsText, manifest = report?.evidenceManifest) {
  if (typeof eventsText !== 'string') return { status: 'EVIDENCE INCOMPLETE', issues: ['Scenario D supplement event log is missing.'] }
  let events
  try { events = parseEvents(eventsText) } catch (error) { return { status: 'EVIDENCE INVALID', issues: [String(error)] } }
  if (!manifest) return { status: 'EVIDENCE INCOMPLETE', issues: ['Scenario D supplement manifest is missing.'] }
  if (JSON.stringify(canonical(manifest)) !== JSON.stringify(canonical(createManagerLifecycleManifest(report, eventsText)))) {
    return { status: 'EVIDENCE INVALID', issues: ['Scenario D supplement manifest does not match its records or raw event bytes.'] }
  }
  if (report?.result !== 'D SUPPLEMENT PASS') return { status: 'EVIDENCE INCOMPLETE', issues: [`Scenario D supplement result is ${report?.result ?? 'missing'}.`] }

  const issues = []
  if (!hasValidRuntimeIdentity(report)) addIssue(issues, 'D supplement', 'source, NativeHost/Manager identities, or release artifact hashes are invalid.')
  const sections = ['settings', 'favorites', 'translate', 'page-switch']
  if (!Array.isArray(report.scenarios?.D) || report.scenarios.D.length !== sections.length
    || !sections.every(section => report.scenarios.D.some(run => run.section === section))) {
    addIssue(issues, 'D supplement', 'expected exactly four representative operation cases.')
  } else {
    for (const section of sections) {
      const run = report.scenarios.D.find(item => item.section === section)
      if (run.main?.parentPid !== report.nativePid || !validReadySummary(run)) {
        addIssue(issues, 'D supplement', `${section} does not use the recorded isolated NativeHost and one complete Manager group.`)
      }
      validateDOperationEvent(run, section, section === 'page-switch' ? 'D-page-switch' : `D-${section}`, report, events, issues)
    }
  }
  if (events.some(event => event.type === 'failure')) addIssue(issues, 'D supplement', 'the supplement event log contains a failure record.')
  return issues.length ? { status: 'EVIDENCE INCOMPLETE', issues } : { status: 'PASS', issues: [] }
}

/** Validates both acceptance semantics and the relationship among report, manifest, and raw event log. */
export function validateManagerLifecycleEvidence(report, eventsText, manifest = report?.evidenceManifest, options = {}) {
  if (typeof eventsText !== 'string') return { status: 'EVIDENCE INCOMPLETE', issues: ['raw event log is missing.'] }
  let events
  try {
    events = parseEvents(eventsText)
  } catch (error) {
    return { status: 'EVIDENCE INVALID', issues: [String(error)] }
  }
  if (!manifest) return { status: 'EVIDENCE INCOMPLETE', issues: ['evidence manifest is missing.'] }
  const expectedManifest = createManagerLifecycleManifest(report, eventsText)
  if (JSON.stringify(canonical(manifest)) !== JSON.stringify(canonical(expectedManifest))) {
    return { status: 'EVIDENCE INVALID', issues: ['evidence manifest does not match scenario records or raw event bytes.'] }
  }
  if (report?.result !== 'A-F PASS') return { status: 'EVIDENCE INCOMPLETE', issues: [`report result is ${report?.result ?? 'missing'}.`] }

  const issues = []
  const supplement = options.scenarioDSupplement
  let externallyVerifiedDSections = new Set()
  let supplementValidation = null
  if (supplement) {
    supplementValidation = validateManagerLifecycleDSupplement(supplement.report, supplement.eventsText, supplement.report?.evidenceManifest)
    if (supplementValidation.status !== 'PASS') {
      return { status: supplementValidation.status, issues: [`Scenario D supplement: ${supplementValidation.issues.join('; ')}`] }
    }
    if (supplement.report.sourceHead !== report.sourceHead) {
      return { status: 'EVIDENCE INVALID', issues: ['Scenario D supplement source checkpoint does not match the historical A-F report.'] }
    }
    externallyVerifiedDSections = new Set(supplement.report.scenarios.D.map(run => run.section))
  }
  const evidence = validateScenarios(report, events, issues, externallyVerifiedDSections)
  if (evidence.unknownFailures.length) return { status: 'EVIDENCE INVALID', issues }
  if (issues.length) return { status: 'EVIDENCE INCOMPLETE', issues }
  return {
    status: 'PASS',
    issues: [],
    ...(supplementValidation ? { scenarioDSupplement: supplementValidation } : {}),
    supersededInfrastructureFailures: evidence.failureEvents.map(event => ({
      scenario: event.scenario,
      cycle: event.cycle,
      classification: classifySupersededFailure(event),
    })),
  }
}
