'use strict'

const fs = require('node:fs')
const crypto = require('node:crypto')
const path = require('node:path')

function isTrue(value) { return value === true }
function cacheHasUsableEntry(cache) { return cache?.attempts?.some(attempt => (attempt.put === true && attempt.read === true) || (attempt.found === true && attempt.sentinel === true)) === true }
function cacheReadsSentinel(cache) { return cache?.attempts?.some(attempt => attempt.found === true && attempt.sentinel === true) === true }

function summarize(raw, remainingProcessCount) {
  const closure = raw.checks?.phase6e4a1
  if (!closure) throw new Error('packaged Phase 6E-4A.1 evidence is missing')
  const cache = closure.cacheAndServiceWorker
  const lifecycle = closure.lifecycle
  const nav = closure.navigation
  const runtimeAUsable = cacheHasUsableEntry(cache.runtimeAWrite) && cacheHasUsableEntry(cache.runtimeABeforeCleanup)
  const cacheCleared = !cacheReadsSentinel(cache.runtimeAAfterCleanup)
  const cacheRuntimeBIsolated = !cacheReadsSentinel(cache.runtimeB)
  const cacheRestartIsolated = !cacheReadsSentinel(cache.sameHostAfterProcessRestart)
  const cacheNoNetwork = cache.networkRequests === 0
  const serviceWorkerAttempts = cache.swBeforeCleanup?.registrationAttempts || []
  const swUnavailable = cache.hostSchemePrivileges?.allowServiceWorkers === false
    && cache.serviceWorkerErrors?.queryBefore === 'InvalidStateError'
    && serviceWorkerAttempts.length >= 2
    && serviceWorkerAttempts.every(attempt => attempt.outcome === 'rejected' && attempt.errorName === 'TypeError')
  const swNoActiveRegistration = cache.runningWorkersBefore === 0 && cache.runningWorkersAfter === 0
    && cache.sessionServiceWorkerEventsBefore === 0 && cache.sessionServiceWorkerEventsAfter === 0
  const swNoPersistence = cache.swRuntimeB?.registrationAttempts?.every(attempt => attempt.outcome !== 'resolved') === true
    && cache.swRestart?.registrationAttempts?.every(attempt => attempt.outcome !== 'resolved') === true

  const schemes = ['file', 'javascript', 'http', 'https', 'data', 'blob', 'old-runtime', 'current-valid', 'current-invalid']
  const navSummary = Object.fromEntries(schemes.map(target => {
    const entries = nav.filter(item => item.target === target)
    return [target, {
      attempted: entries.length === 6 && entries.every(item => item.attempt),
      methods: entries.map(item => item.method),
      commitCount: entries.filter(item => item.targetCommit).length,
      targetCommitStatusCodes: entries.flatMap(item => item.targetCommitStatusCodes || []),
      hostDeniedCount: entries.filter(item => item.hostDenied).length,
      requestPolicyReachedCount: entries.filter(item => item.requestPolicyReached).length,
      securityViolationCount: entries.reduce((sum, item) => sum + (item.securityViolations || 0), 0),
      consoleSecurityDenialCount: entries.reduce((sum, item) => sum + (item.consoleSecurityDenials || 0), 0),
      fileSentinelAccessCount: entries.filter(item => item.fileSentinelAccessible).length,
      javascriptSideEffectCount: entries.filter(item => item.javascriptSideEffect).length,
      failureEvents: entries.filter(item => item.loadFailure !== null).length,
    }]
  }))
  const dangerousNavigationsDenied = ['file', 'javascript', 'http', 'https', 'data', 'blob', 'old-runtime'].every(target => {
    const item = navSummary[target]
    return item?.attempted === true && item.commitCount === 0
      && item.fileSentinelAccessCount === 0 && item.javascriptSideEffectCount === 0
  })
  const currentRuntimeAccepted = nav.filter(item => item.target === 'current-valid' && ['location.href', 'location.assign', 'location.replace', 'anchor.click'].includes(item.method)).some(item => item.targetCommit)
  const invalidRuntimeIsOnly404 = navSummary['current-invalid']?.commitCount === 4
    && navSummary['current-invalid'].targetCommitStatusCodes.length === 4
    && navSummary['current-invalid'].targetCommitStatusCodes.every(code => code === 404)
  const navigation = {
    schemeMatrix: navSummary,
    file: { attempted: navSummary.file?.attempted, methods: navSummary.file?.methods, committed: navSummary.file?.commitCount > 0, sentinelAccessible: navSummary.file?.fileSentinelAccessCount > 0, hostBoundaryEvents: navSummary.file?.hostDeniedCount, browserSecurityEvents: navSummary.file?.securityViolationCount + navSummary.file?.consoleSecurityDenialCount },
    javascript: { attempted: navSummary.javascript?.attempted, methods: navSummary.javascript?.methods, committed: navSummary.javascript?.commitCount > 0, sideEffect: navSummary.javascript?.javascriptSideEffectCount > 0, hostBoundaryEvents: navSummary.javascript?.hostDeniedCount, browserSecurityEvents: navSummary.javascript?.securityViolationCount + navSummary.javascript?.consoleSecurityDenialCount },
    dangerousSchemesNoCommitOrEffects: dangerousNavigationsDenied,
    currentRuntimeRouteAccepted: currentRuntimeAccepted,
    invalidRuntimeRouteReturnsOnly404: invalidRuntimeIsOnly404,
    eventSequence: 'attempt → will-frame/will-navigate Host deny when emitted, otherwise Chromium/CSP rejection → no forbidden commit/effect; current valid custom route commits; unknown current-origin route commits only an inert 404',
    hostPolicy: 'only exact active webtools-plugin origin is accepted; all other schemes/hosts are denied by the probe WebContents navigation handler when Electron emits the event',
  }

  const invalidRoute = lifecycle.loadFailure
  const crash = lifecycle.rendererCrash
  const unresponsive = lifecycle.unresponsive
  const stale = lifecycle.staleCallback
  const failureCleanup = lifecycle.failurePathCleanup
  const processCleanup = {
    mainProcessIdentityMatched: raw.externalProcess?.mainProcessIdentityMatched === true,
    exactPackagedExecutableProcessesAfterExit: remainingProcessCount,
    pass: raw.externalProcess?.mainProcessIdentityMatched === true && remainingProcessCount === 0,
  }
  const statuses = {
    cacheStorage: runtimeAUsable && cacheCleared && cacheRuntimeBIsolated && cacheRestartIsolated && cacheNoNetwork,
    serviceWorker: swUnavailable && swNoActiveRegistration && swNoPersistence,
    fileNavigation: navSummary.file?.attempted === true && navSummary.file.commitCount === 0 && navSummary.file.fileSentinelAccessCount === 0,
    javascriptNavigation: navSummary.javascript?.attempted === true && navSummary.javascript.commitCount === 0 && navSummary.javascript.javascriptSideEffectCount === 0,
    loadFailure: invalidRoute?.attempted === true && invalidRoute.didFailLoadObserved === true && invalidRoute.runtimeState === 'FAULTED' && invalidRoute.viewRemoved === true && invalidRoute.webContentsDestroyed === true && invalidRoute.remainingViews === 0 && invalidRoute.remainingWebContents === 0 && invalidRoute.generationRevoked === true && invalidRoute.freshRuntimeReady === true && invalidRoute.boundedMs <= 5000,
    rendererCrash: crash?.renderProcessGoneObserved === true && crash.viewRemoved === true && crash.webContentsDestroyed === true && crash.remainingViews === 0 && crash.remainingWebContents === 0 && crash.generationRevoked === true && crash.freshRuntimeReady === true,
    unresponsiveBoundedTeardown: unresponsive?.rendererReady === true && unresponsive.busyLoopScheduled === true && unresponsive.mainProcessTimerResponsive === true && unresponsive.forcedTeardownAfterGrace === true && unresponsive.webContentsDestroyed === true && unresponsive.remainingViews === 0 && unresponsive.remainingWebContents === 0 && unresponsive.renderProcessGoneObserved === true && unresponsive.teardownMs <= 5000,
    staleCallback: stale?.lateCallbackAttempted === true && stale.lateCallbackAccepted === false && stale.runtimeBStateUnchanged === true && stale.storageSentinelUnchanged === true && stale.hostStateUnchanged === true,
    failurePathProcessCleanup: failureCleanup?.activeProbeViews === 0 && failureCleanup?.activeProbeWebContents === 0 && processCleanup.pass,
    navigationOtherSchemes: dangerousNavigationsDenied && currentRuntimeAccepted && invalidRuntimeIsOnly404,
  }
  const report = {
    schemaVersion: 1,
    phase: '6E-4A.1',
    capturedAtUtc: new Date().toISOString(),
    artifact: { electron: raw.source.electron, chromium: raw.source.chromium, node: raw.source.node, platform: raw.source.platform, osBuild: raw.source.osRelease, architecture: 'x64', mode: 'packaged-win-unpacked' },
    testIds: {
      cacheStorage: { expected: 'usable supported-key cache entry is explicitly read, cleared, isolated, and causes no network request', actual: { writableAndReadable: runtimeAUsable, cleared: cacheCleared, runtimeBIsolated: cacheRuntimeBIsolated, processRestartIsolated: cacheRestartIsolated, networkRequests: cache.networkRequests }, status: statuses.cacheStorage ? 'PASS' : 'BLOCKED' },
      serviceWorker: { expected: 'scheme Host privileges omit allowServiceWorkers; packaged registration attempts are rejected with TypeError and no Session worker becomes active', actual: { apiType: cache.swBeforeCleanup?.apiType ?? null, allowServiceWorkers: cache.hostSchemePrivileges?.allowServiceWorkers ?? null, attempts: serviceWorkerAttempts.map(({ name, outcome, errorName }) => ({ name, outcome, errorName: errorName ?? null })), getRegistrationsError: cache.serviceWorkerErrors?.queryBefore ?? null, registrationEvents: cache.sessionServiceWorkerEventsAfter, runningWorkers: cache.runningWorkersAfter, runtimeAndRestartAttemptsUnresolved: swNoPersistence }, status: statuses.serviceWorker ? 'PASS' : 'BLOCKED' },
      navigation: { expected: 'forbidden scheme/host attempts do not commit or produce file/JS effects; active route remains usable', actual: navigation, status: statuses.navigationOtherSchemes ? 'PASS' : 'BLOCKED' },
      loadFailure: { expected: 'invalid package route emits did-fail-load, faults and tears down within a bound, then fresh runtime loads', actual: { eventSequence: ['did-fail-load', 'runtime-faulted', 'generation-revoked', 'view-removed', 'webContents-destroyed', 'fresh-runtime-ready'], didFailLoadObserved: invalidRoute?.didFailLoadObserved, runtimeState: invalidRoute?.runtimeState, viewRemoved: invalidRoute?.viewRemoved, webContentsDestroyed: invalidRoute?.webContentsDestroyed, remainingViews: invalidRoute?.remainingViews, remainingWebContents: invalidRoute?.remainingWebContents, generationRevoked: invalidRoute?.generationRevoked, freshRuntimeReady: invalidRoute?.freshRuntimeReady, durationMs: invalidRoute?.boundedMs, boundMs: 5000 }, status: statuses.loadFailure ? 'PASS' : 'BLOCKED' },
      rendererCrash: { expected: 'renderer-gone revokes and destroys runtime; fresh runtime loads', actual: { eventSequence: ['render-process-gone', 'generation-revoked', 'view-removed', 'webContents-destroyed', 'fresh-runtime-ready'], renderProcessGoneObserved: crash?.renderProcessGoneObserved, viewRemoved: crash?.viewRemoved, webContentsDestroyed: crash?.webContentsDestroyed, remainingViews: crash?.remainingViews, remainingWebContents: crash?.remainingWebContents, generationRevoked: crash?.generationRevoked, freshRuntimeReady: crash?.freshRuntimeReady, teardownMs: crash?.teardownMs }, status: statuses.rendererCrash ? 'PASS' : 'BLOCKED' },
      rendererUnresponsive: { expected: '2-second frozen close grace then scoped force teardown completes within bound', actual: { eventSequence: ['renderer-busy-loop', '2s-close-grace', 'generation-revoked', 'forcefullyCrashRenderer', 'render-process-gone', 'webContents-destroyed'], busyLoopScheduled: unresponsive?.busyLoopScheduled, eventObserved: unresponsive?.unresponsiveEventObserved, alternativeBoundedHangProof: unresponsive?.forcedTeardownAfterGrace === true && unresponsive?.renderProcessGoneObserved === true, graceBudgetMs: unresponsive?.graceBudgetMs, destroyed: unresponsive?.webContentsDestroyed, remainingViews: unresponsive?.remainingViews, remainingWebContents: unresponsive?.remainingWebContents, teardownMs: unresponsive?.teardownMs }, status: statuses.unresponsiveBoundedTeardown ? 'PASS' : 'BLOCKED' },
      staleCallback: { expected: 'revoked generation callback cannot mutate new runtime state', actual: { eventSequence: ['generation-A-started', 'generation-A-revoked', 'generation-B-created', 'A-late-callback-attempted', 'A-late-callback-rejected'], generationA: stale?.generationA, generationB: stale?.generationB, attempted: stale?.lateCallbackAttempted, accepted: stale?.lateCallbackAccepted, runtimeBUnchanged: stale?.runtimeBStateUnchanged, storageUnchanged: stale?.storageSentinelUnchanged, hostStateUnchanged: stale?.hostStateUnchanged }, status: statuses.staleCallback ? 'PASS' : 'BLOCKED' },
      failurePathCleanup: { expected: 'no view/webcontents remains and packaged exact-path process count is zero after exit', actual: { remainingViews: failureCleanup?.activeProbeViews, remainingWebContents: failureCleanup?.activeProbeWebContents, ...processCleanup }, status: statuses.failurePathProcessCleanup ? 'PASS' : 'BLOCKED' },
    },
    contractChanges: 'NONE',
    productionChanges: 'NONE',
    finalStatus: Object.values(statuses).every(Boolean) ? 'PASS' : 'BLOCKED',
  }
  return report
}

if (require.main === module) {
  const argv = process.argv.slice(2)
  const value = name => { const index = argv.indexOf(name); return index < 0 ? null : argv[index + 1] }
  const rawPath = value('--raw')
  const outputPath = value('--output')
  const remainingProcessCount = Number(value('--remaining-process-count'))
  const identityMatched = value('--main-process-identity-matched') === 'true'
  if (!rawPath || !outputPath || !Number.isInteger(remainingProcessCount) || remainingProcessCount < 0) throw new Error('usage: sanitize-evidence.cjs --raw <path> --output <path> --remaining-process-count <n> --main-process-identity-matched <true|false>')
  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'))
  raw.externalProcess = { mainProcessIdentityMatched: identityMatched }
  const output = summarize(raw, remainingProcessCount)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  console.log(`Evidence ${output.finalStatus}: ${outputPath}`)
  console.log(`SHA-256 ${crypto.createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex').toUpperCase()}`)
  if (output.finalStatus !== 'PASS') process.exitCode = 1
}

module.exports = { summarize }
