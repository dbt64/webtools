import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tempRoot = await mkdtemp(join(tmpdir(), 'WebTools-6E4B-验收 '))
const profileRoot = join(tempRoot, 'profiles')
const fixture = join(tempRoot, 'phase6e4b-runtime-fixture.wtplugin')
const packageOutput = join(tempRoot, 'packaged')
const configPath = join(tempRoot, 'electron-builder.config.json')
const executable = join(packageOutput, 'win-unpacked', 'WebTools.exe')
let preserveTemp = false
let sink
let profileSequence = 0

async function createIsolatedProfile(label) {
  const profile = join(profileRoot, `${label}-${++profileSequence}`)
  await mkdir(profile, { recursive: true })
  return profile
}

function checked(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, { cwd, windowsHide: true, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status}):\n${result.stdout}\n${result.stderr}`)
  return result.stdout.trim()
}

async function startLoopbackSink() {
  const server = createServer()
  let connectionCount = 0
  server.on('connection', socket => {
    connectionCount += 1
    socket.on('data', () => {})
    socket.end('HTTP/1.1 204 No Content\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return {
    url: `http://127.0.0.1:${server.address().port}/phase6e4c-sink`,
    count: () => connectionCount,
    close: () => new Promise(resolveClose => server.close(resolveClose)),
  }
}

async function reserveFreePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise(resolveClose => server.close(resolveClose))
  return port
}

function cdpConnection(url, onEvent = () => {}) {
  const socket = new WebSocket(url)
  const pending = new Map()
  let sequence = 0
  socket.addEventListener('message', event => {
    let message
    try { message = JSON.parse(String(event.data)) } catch { return }
    if (message.method) onEvent(message)
    if (!message.id) return
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(message.error.message))
    else entry.resolve(message.result)
  })
  return new Promise((resolveConnection, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out connecting to DevTools WebSocket: ${url}`)), 10_000)
    socket.addEventListener('open', () => {
      clearTimeout(timer)
      resolveConnection({
      call(method, params = {}, timeoutMs = 10_000) {
        const id = ++sequence
        return new Promise((resolveCall, rejectCall) => {
          const timer = setTimeout(() => {
            pending.delete(id)
            rejectCall(new Error(`Timed out waiting for DevTools method ${method}.`))
          }, timeoutMs)
          pending.set(id, {
            resolve: value => { clearTimeout(timer); resolveCall(value) },
            reject: error => { clearTimeout(timer); rejectCall(error) },
          })
          socket.send(JSON.stringify({ id, method, params }))
        })
      },
      close() { socket.close() },
      })
    }, { once: true })
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`Could not connect to packaged Manager DevTools Protocol: ${url}`)) }, { once: true })
    socket.addEventListener('close', event => { clearTimeout(timer); reject(new Error(`DevTools WebSocket closed before opening (${event.code}): ${url}`)) }, { once: true })
  })
}

async function waitFor(read, predicate, description, timeoutMs = 20_000) {
  const until = Date.now() + timeoutMs
  let last
  while (Date.now() < until) {
    try {
      last = await read()
      if (predicate(last)) return last
    } catch (error) { last = { readError: error instanceof Error ? error.message : String(error) } }
    await new Promise(resolveWait => setTimeout(resolveWait, 150))
  }
  throw new Error(`Timed out waiting for ${description}; last observed: ${JSON.stringify(last)}`)
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
  return response.json()
}

async function processCountForExecutable(path) {
  const encoded = Buffer.from(path, 'utf8').toString('base64')
  const command = `$expected=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and [string]::Equals($_.ExecutablePath,$expected,[StringComparison]::OrdinalIgnoreCase) }).Count`
  return Number(checked('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]))
}

async function assertPackagedProcessesUseIsolatedProfile(path, isolatedProfile) {
  const encoded = Buffer.from(path, 'utf8').toString('base64')
  const command = `$expected=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); $items=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and [string]::Equals($_.ExecutablePath,$expected,[StringComparison]::OrdinalIgnoreCase) } | Select-Object ProcessId,ParentProcessId,CommandLine); $json=ConvertTo-Json -InputObject $items -Compress; [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($json))`
  const encodedProcesses = checked('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command])
  const processes = JSON.parse(Buffer.from(encodedProcesses, 'base64').toString('utf16le'))
  const expectedProfile = resolve(isolatedProfile).toLowerCase()
  const children = processes.filter(process => process.CommandLine.includes('--type='))
  assert.ok(children.length > 0, 'packaged Chromium child processes must be observable')
  for (const process of children) {
    assert.ok(process.CommandLine.toLowerCase().includes(expectedProfile), `PID ${process.ProcessId} must use isolated profile ${expectedProfile}; command line: ${process.CommandLine}`)
  }
  return processes
}

async function runPackagedInstance(sinkUrl, switchFeature = false, scenario = 'standard') {
  const isolatedProfile = await createIsolatedProfile(`packaged-${scenario}`)
  const debugPort = await reserveFreePort()
  const environment = { ...process.env,
    WEBTOOLS_WEB_RUNTIME_ACCEPTANCE: '1',
    WEBTOOLS_WEB_RUNTIME_TEST_PROFILE: isolatedProfile,
    WEBTOOLS_WEB_RUNTIME_TEST_PACKAGE: fixture,
    WEBTOOLS_WEB_RUNTIME_TEST_DEBUG_PORT: String(debugPort),
    WEBTOOLS_WEB_RUNTIME_TEST_SWITCH: switchFeature ? '1' : '0',
    WEBTOOLS_WEB_RUNTIME_TEST_MUTATE_ARCHIVE: switchFeature ? '1' : '0',
    WEBTOOLS_WEB_RUNTIME_TEST_SCENARIO: scenario,
  }
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.WEBTOOLS_MANAGER_EXE
  delete environment.WEBTOOLS_MANAGER_ONLY
  delete environment.WEBTOOLS_NATIVE_PIPE
  assert.equal(await processCountForExecutable(executable), 0, 'isolated packaged executable must not already be running')
  const child = spawn(executable, [`--user-data-dir=${isolatedProfile}`, '--phase6e4b-web-runtime-acceptance'], { cwd: dirname(executable), env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let childOutput = ''
  child.stdout.setEncoding('utf8').on('data', value => { childOutput += value; process.stdout.write(`[packaged stdout] ${value}`) })
  child.stderr.setEncoding('utf8').on('data', value => process.stderr.write(`[packaged stderr] ${value}`))
  child.on('error', error => process.stderr.write(`[packaged spawn error] ${error.stack ?? error}\n`))
  process.stdout.write(`[packaged start] pid=${child.pid} exe=${executable} debugPort=${debugPort}\n`)
  const exited = once(child, 'exit').then(([code, signal]) => ({ code, signal }))
  let browser
  let manager
  let report
  let wasmReport
  let protocolResults = []
  const navigationResults = []
  let managerTarget
  let plugin
  let cleanupStartedAt = 0
  try {
    const version = await waitFor(async () => {
      return fetchJson(`http://127.0.0.1:${debugPort}/json/version`)
    }, value => Boolean(value?.webSocketDebuggerUrl), 'packaged Electron DevTools endpoint')
    process.stdout.write(`[packaged devtools] ${JSON.stringify(version)}\n`)
    browser = await cdpConnection(version.webSocketDebuggerUrl)
    process.stdout.write('[packaged devtools] browser websocket connected\n')
    let targets = await waitFor(async () => {
      return fetchJson(`http://127.0.0.1:${debugPort}/json/list`)
    }, value => value.some(target => target.type === 'page' && target.url.startsWith('file:')), 'trusted Manager renderer')
    const processIdentity = await waitFor(() => assertPackagedProcessesUseIsolatedProfile(executable, isolatedProfile), records => records.length > 1, 'all packaged Chromium child processes to use the isolated profile')
    process.stdout.write(`[packaged isolated process profile] verified=${processIdentity.length}\n`)
    process.stdout.write(`[packaged targets] ${JSON.stringify(targets)}\n`)
    managerTarget = targets.find(target => target.type === 'page' && target.url.startsWith('file:'))
    manager = await cdpConnection(managerTarget.webSocketDebuggerUrl)
    process.stdout.write('[packaged devtools] Manager renderer websocket connected\n')
    const initialPluginTarget = await waitFor(async () => {
      targets = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`)
      return targets.find(target => target.type === 'page' && target.url.startsWith('webtools-plugin://'))
    }, Boolean, 'initial isolated WebContentsView package document')
    process.stdout.write(`[packaged initial plugin target] ${JSON.stringify(initialPluginTarget)}\n`)
    const initialHost = new URL(initialPluginTarget.url).hostname
    let activeHost = initialHost
    if (switchFeature) {
      const switchEvidence = await waitFor(() => childOutput, value => /switched Feature ready generation=(\d+)->(\d+)/.test(value),
        'Main-owned same-process Feature switch completion')
      assert.match(switchEvidence, /validated snapshot survived source archive deletion and buffer mutation/,
        'the runtime must serve retained validated bytes after the source archive and input Buffer are changed')
      const [, oldGeneration, newGeneration] = switchEvidence.match(/switched Feature ready generation=(\d+)->(\d+)/) ?? []
      assert.ok(oldGeneration && newGeneration && oldGeneration !== newGeneration, 'Feature switch replaces the runtime generation')
      const targetsAfterSwitch = await waitFor(async () => fetchJson(`http://127.0.0.1:${debugPort}/json/list`),
        targets => !targets.some(target => target.url.startsWith(`webtools-plugin://${initialHost}/`)),
        'the prior Feature WebContentsView target to finish closing after switch')
      const switchedTarget = targetsAfterSwitch.find(target => target.type === 'page' && target.url.startsWith('webtools-plugin://'))
      assert.ok(switchedTarget, 'the new validated WASM Feature has an active WebContentsView')
      activeHost = new URL(switchedTarget.url).host
      assert.notEqual(activeHost, initialHost, 'a Feature switch receives a fresh random origin')
      plugin = await cdpConnection(switchedTarget.webSocketDebuggerUrl)
      const wasmText = await waitFor(async () => {
        const value = await plugin.call('Runtime.evaluate', { expression: "JSON.stringify({status:document.querySelector('#status')?.textContent,results:document.querySelector('#results')?.textContent||''})", returnByValue: true })
        return value.result?.value ?? ''
      }, value => { try { return JSON.parse(value).results.includes('wasmCompile') } catch { return false } }, 'WASM Feature CSP report')
      wasmReport = JSON.parse(JSON.parse(wasmText).results)
      assert.equal(wasmReport.wasmCompile, 'allowed', 'WASM compiles only in the Feature with the validated declaration')
      assert.equal(wasmReport.javascriptEval, 'blocked', 'WASM permission must not enable JavaScript eval')
      assert.equal(wasmReport.runtimeHost, activeHost)
      await manager.call('Runtime.evaluate', { expression: `window.desktop.webRuntime.close(${Number(oldGeneration)})` })
      await new Promise(resolveDelay => setTimeout(resolveDelay, 250))
      assert.equal((await fetchJson(`http://127.0.0.1:${debugPort}/json/list`)).some(target => target.url.startsWith(`webtools-plugin://${activeHost}/`)), true,
        'stale-generation close from the trusted Manager renderer must not close the current Feature')
      const navigationTargets = [
        `webtools-plugin://${initialHost}/web/index.html`,
        `webtools-plugin://${'f'.repeat(32)}/web/index.html`,
        `webtools-plugin://${activeHost}/web/unknown.html`,
        `file:///C:/Windows/win.ini`,
        'javascript:document.title="gate1-navigation-escaped"',
        'data:text/html,gate1-navigation-escaped',
        'blob:https://example.invalid/gate1-navigation-escaped',
        `http://127.0.0.1:${new URL(sinkUrl).port}/phase6e4c-navigation`,
        `https://example.invalid/phase6e4c-navigation`,
      ]
      for (const url of navigationTargets) {
        try { await plugin.call('Runtime.evaluate', { expression: `location.assign(${JSON.stringify(url)})` }) } catch {}
        await new Promise(resolveDelay => setTimeout(resolveDelay, 100))
        const current = await plugin.call('Runtime.evaluate', { expression: 'location.href', returnByValue: true })
        const currentUrl = current.result?.value
        navigationResults.push({ attemptedScheme: (() => { try { return new URL(url).protocol } catch { return 'invalid' } })(), stayedOnOriginalDocument: currentUrl === switchedTarget.url })
        assert.equal(navigationResults.at(-1).stayedOnOriginalDocument, true, `navigation escaped or replaced the active Feature document: ${navigationResults.at(-1).attemptedScheme}`)
      }
      process.stdout.write(`[packaged switch evidence] generation=${oldGeneration}->${newGeneration}; previousTargetRevoked=true\n`)
    } else {
      plugin = await cdpConnection(initialPluginTarget.webSocketDebuggerUrl)
    }
    try {
      if (!switchFeature) {
        process.stdout.write('[packaged cdp] querying isolated page security report\n')
        const reportText = await waitFor(async () => {
          const value = await plugin.call('Runtime.evaluate', { expression: "JSON.stringify({state:document.readyState,title:document.title,status:document.querySelector('#status')?.textContent,results:document.querySelector('#results')?.textContent || ''})", returnByValue: true })
          return value.result?.value ?? ''
        }, value => { try { return JSON.parse(value).results.includes('dynamicImport') } catch { return false } }, 'fixture security report')
        report = JSON.parse(JSON.parse(reportText).results)
        process.stdout.write(`[packaged runtime probes] ${JSON.stringify(report)}\n`)
        assertSecurityReport(report)
        assert.equal(report.runtimeHost, activeHost)
        protocolResults = await managerlessProbe(plugin)
        assert.ok(protocolResults.filter(result => result.path !== '/web/./app.js').every(result => result.status === 'blocked' || result.status === 404),
          `unexpected protocol attack result: ${JSON.stringify(protocolResults)}`)
        assert.equal(protocolResults.find(result => result.path === '/web/./app.js')?.status, 200,
          'browser-normalized dot segments may reach only the canonical declared resource')
      }

      const layout = await waitFor(() => manager.call('Runtime.evaluate', {
        expression: `(() => { const host=document.querySelector('.web-runtime-surface'); const b=host?.getBoundingClientRect(); return { route: document.querySelector('.web-runtime-page')!==null, bounds:b&&{x:b.x,y:b.y,width:b.width,height:b.height}, trustedChrome:document.querySelector('.topbar')!==null, activeNav:document.querySelector('.nav-item.is-active')?.innerText, body:document.body.innerText.slice(0,500) }; })()`,
        returnByValue: true,
      }), value => value.result?.value?.route === true, 'trusted Manager route update for active Web Runtime')
      process.stdout.write(`[packaged manager layout] ${JSON.stringify(layout)}\n`)
      assert.equal(layout.result?.value?.route, true)
      assert.equal(layout.result?.value?.trustedChrome, true)
      assert.ok(layout.result?.value?.bounds?.width > 100)
      assert.ok(layout.result?.value?.bounds?.height > 100)

      cleanupStartedAt = Date.now()
      await manager.call('Runtime.evaluate', { expression: "document.querySelector('.web-runtime-toolbar button')?.click()" })
      await waitFor(async () => (await fetchJson(`http://127.0.0.1:${debugPort}/json/list`)).some(target => target.url.startsWith('webtools-plugin://')),
        value => !value, 'WebContentsView destruction after trusted close')
      const closeResponse = await fetch(`http://127.0.0.1:${debugPort}/json/close/${managerTarget.id}`, { signal: AbortSignal.timeout(2_000) })
      assert.equal(closeResponse.ok, true, 'the packaged Manager must accept a graceful page/window close request')
      await waitFor(() => processCountForExecutable(executable), value => value === 0, 'graceful Manager close and packaged process-group exit', 15_000)
    } finally { plugin?.close() }
    await waitFor(() => childOutput, value => /storage-cleanup=completed cookies-remaining=0/.test(value),
      'Main-confirmed storage/cache cleanup and empty CookieStore', 7_500)
    assert.ok(Date.now() - cleanupStartedAt <= 5_000, 'session storage/cache cleanup must complete within the frozen close budget')
    return { runtimeHost: activeHost, report, wasmReport, protocolResults, navigationResults, switchedWithinProcess: switchFeature, childOutput }
  } catch (error) {
    try {
      if (managerTarget) await fetch(`http://127.0.0.1:${debugPort}/json/close/${managerTarget.id}`, { signal: AbortSignal.timeout(2_000) })
      else await browser?.call('Browser.close')
    } catch { /* Preserve the isolated process and evidence for diagnosis. */ }
    throw error
  } finally {
    manager?.close()
    browser?.close()
    const exit = await Promise.race([exited, new Promise(resolveExit => setTimeout(() => resolveExit(null), 15_000))])
    if (!exit) {
      preserveTemp = true
      throw new Error('Packaged Manager did not exit within the bounded graceful-close wait; isolated evidence was preserved.')
    }
    const remaining = await waitFor(() => processCountForExecutable(executable), value => value === 0, 'all processes from the isolated packaged executable to exit', 15_000)
    assert.equal(remaining, 0)
  }
}

async function runLifecycleScenario(scenario) {
  const isolatedProfile = await createIsolatedProfile(`lifecycle-${scenario}`)
  const debugPort = await reserveFreePort()
  const environment = { ...process.env,
    WEBTOOLS_WEB_RUNTIME_ACCEPTANCE: '1',
    WEBTOOLS_WEB_RUNTIME_TEST_PROFILE: isolatedProfile,
    WEBTOOLS_WEB_RUNTIME_TEST_PACKAGE: fixture,
    WEBTOOLS_WEB_RUNTIME_TEST_DEBUG_PORT: String(debugPort),
    WEBTOOLS_WEB_RUNTIME_TEST_SCENARIO: scenario,
  }
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.WEBTOOLS_MANAGER_EXE
  delete environment.WEBTOOLS_MANAGER_ONLY
  delete environment.WEBTOOLS_NATIVE_PIPE
  assert.equal(await processCountForExecutable(executable), 0, `${scenario}: no pre-existing packaged instance`)
  const child = spawn(executable, [`--user-data-dir=${isolatedProfile}`, '--phase6e4b-web-runtime-acceptance'], { cwd: dirname(executable), env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let childOutput = ''
  child.stdout.setEncoding('utf8').on('data', value => { childOutput += value; process.stdout.write(`[${scenario} stdout] ${value}`) })
  child.stderr.setEncoding('utf8').on('data', value => process.stderr.write(`[${scenario} stderr] ${value}`))
  const exited = once(child, 'exit').then(([code, signal]) => ({ code, signal }))
  let managerTarget
  let manager
  let plugin
  let passed = false
  try {
    await waitFor(() => fetchJson(`http://127.0.0.1:${debugPort}/json/version`), value => Boolean(value?.webSocketDebuggerUrl), `${scenario}: packaged DevTools`)
    managerTarget = await waitFor(async () => (await fetchJson(`http://127.0.0.1:${debugPort}/json/list`)).find(target => target.type === 'page' && target.url.startsWith('file:')), Boolean, `${scenario}: Manager renderer`)
    const processIdentity = await waitFor(() => assertPackagedProcessesUseIsolatedProfile(executable, isolatedProfile), records => records.length > 1, `${scenario}: packaged Chromium child processes use the isolated profile`)
    process.stdout.write(`[${scenario} isolated process profile] verified=${processIdentity.length}\n`)
    manager = await cdpConnection(managerTarget.webSocketDebuggerUrl)
    if (scenario === 'switch-while-loading') {
      await waitFor(() => childOutput, value => value.includes('loading-switch=PASS'), `${scenario}: old loading runtime is revoked before replacement becomes ready`, 20_000)
      assert.doesNotMatch(childOutput, /state=READY generation=1 feature=offline-demo-delayed/, 'replaced delayed runtime must never become READY')
    } else if (scenario === 'close-while-loading') {
      await waitFor(() => childOutput, value => value.includes('state=LOADING generation=1 feature=offline-demo-delayed'), `${scenario}: actual WebContentsView remains in LOADING`)
      const closeStarted = Date.now()
      const closed = await fetch(`http://127.0.0.1:${debugPort}/json/close/${managerTarget.id}`, { signal: AbortSignal.timeout(2_000) })
      assert.equal(closed.ok, true, `${scenario}: Manager close request is accepted`)
      await waitFor(() => processCountForExecutable(executable), count => count === 0, `${scenario}: packaged process group exits`, 15_000)
      assert.ok(Date.now() - closeStarted <= 5_000, `${scenario}: cleanup exceeded the frozen five-second close budget`)
      passed = true
    }
    if (scenario === 'switch-while-loading') {
      const closed = await fetch(`http://127.0.0.1:${debugPort}/json/close/${managerTarget.id}`, { signal: AbortSignal.timeout(2_000) })
      assert.equal(closed.ok, true)
      await waitFor(() => processCountForExecutable(executable), count => count === 0, `${scenario}: packaged process group exits`, 15_000)
      passed = true
    }
    if (scenario === 'renderer-crash' || scenario === 'hung-renderer') {
      await waitFor(() => childOutput, value => value.includes('state=READY generation=1 feature=offline-demo'), `${scenario}: initial real Feature ready`)
      const target = await waitFor(async () => (await fetchJson(`http://127.0.0.1:${debugPort}/json/list`)).find(item => item.type === 'page' && item.url.startsWith('webtools-plugin://')), Boolean, `${scenario}: real plugin renderer target`)
      let hangEntered = false
      plugin = await cdpConnection(target.webSocketDebuggerUrl, message => {
        if (message.method === 'Runtime.consoleAPICalled'
          && message.params?.args?.some(argument => argument.value === '__phase6e4_hang_entered__')) hangEntered = true
      })
      if (scenario === 'renderer-crash') {
        await plugin.call('Page.enable')
        const crashRequest = plugin.call('Page.crash', {}, 2_000).then(() => undefined, () => undefined)
        await Promise.all([
          crashRequest,
          waitFor(() => childOutput, value => /state=CLOSED generation=1 feature=offline-demo/.test(value), `${scenario}: Main observes crash and closes the runtime`, 10_000),
        ])
        await waitFor(() => childOutput, value => value.includes('crash-reopen=PASS'), `${scenario}: explicit reinvocation waits for crash teardown and reaches READY`, 10_000)
        const remainingTargets = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`)
        assert.ok(remainingTargets.some(item => item.id === managerTarget.id), 'Manager remains responsive after plugin renderer crash')
        assert.equal(remainingTargets.some(item => item.id === target.id), false, 'crashed plugin target is removed')
        const replacement = remainingTargets.find(item => item.url.startsWith('webtools-plugin://'))
        assert.ok(replacement, 'explicit reinvocation creates one replacement runtime')
        assert.notEqual(new URL(replacement.url).host, new URL(target.url).host, 'crash recovery receives a fresh runtime origin')
        assert.ok(await processCountForExecutable(executable) > 0, 'Manager remains open after plugin crash cleanup')
      } else {
        await plugin.call('Runtime.enable')
        const scheduled = await plugin.call('Runtime.evaluate', { expression: 'setTimeout(() => { console.log("__phase6e4_hang_entered__"); while (true) {} }, 250); "hang scheduled"', returnByValue: true })
        assert.equal(scheduled.result?.value, 'hang scheduled')
        await waitFor(() => hangEntered, Boolean, 'actual packaged renderer enters the hang fixture', 10_000)
        await assert.rejects(plugin.call('Runtime.evaluate', { expression: '1+1', returnByValue: true }, 2_000), /Timed out waiting for DevTools method Runtime\.evaluate/)
        const closeStarted = Date.now()
        const closed = await fetch(`http://127.0.0.1:${debugPort}/json/close/${managerTarget.id}`, { signal: AbortSignal.timeout(2_000) })
        assert.equal(closed.ok, true, 'trusted Manager close remains callable while plugin renderer is hung')
        await waitFor(() => processCountForExecutable(executable), count => count === 0, `${scenario}: packaged process group exits`, 15_000)
        assert.ok(Date.now() - closeStarted <= 5_000, `${scenario}: Manager shutdown with a hung plugin renderer respects the close budget`)
      }
      if (scenario === 'renderer-crash') {
        const closed = await fetch(`http://127.0.0.1:${debugPort}/json/close/${managerTarget.id}`, { signal: AbortSignal.timeout(2_000) })
        assert.equal(closed.ok, true)
        await waitFor(() => processCountForExecutable(executable), count => count === 0, `${scenario}: packaged process group exits`, 15_000)
      }
      passed = true
    }
    return { scenario, passed, output: childOutput }
  } catch (error) {
    try { if (managerTarget) await fetch(`http://127.0.0.1:${debugPort}/json/close/${managerTarget.id}`, { signal: AbortSignal.timeout(2_000) }) } catch {}
    throw error
  } finally {
    plugin?.close()
    manager?.close()
    const exit = await Promise.race([exited, new Promise(resolveExit => setTimeout(() => resolveExit(null), 15_000))])
    if (!exit) {
      preserveTemp = true
      throw new Error(`${scenario}: packaged process did not exit after graceful Manager close.`)
    }
    assert.equal(await processCountForExecutable(executable), 0, `${scenario}: exact packaged executable process count is zero`)
  }
}

function assertSecurityReport(report) {
  assert.equal(report.process, 'undefined')
  assert.equal(report.require, 'undefined')
  assert.equal(report.module, 'undefined')
  assert.equal(report.Buffer, 'undefined')
  assert.equal(report.ipcRenderer, 'undefined')
  assert.equal(report.electron, 'undefined')
  assert.equal(report.desktopBridge, 'undefined')
  assert.equal(report.managerDom, false)
  assert.equal(report.javascriptEval, 'blocked')
  assert.equal(report.remoteFetch, 'blocked')
  assert.equal(report.dynamicImport, 'same-origin dynamic import loaded')
  assert.equal(report.imageLoaded, true)
  assert.equal(report.serviceWorker, 'blocked')
  assert.equal(report.storageBefore, null)
  assert.equal(report.inlineScript, false)
  assert.equal(report.javascriptEval, 'blocked')
  assert.equal(report.functionConstructor, 'blocked')
  assert.equal(report.remoteDynamicImport, 'blocked')
  assert.equal(report.wasmCompile, 'blocked', 'WASM must be unavailable to a Feature without the validated WASM declaration')
  assert.equal(report.indexedDbWrite, true)
  assert.equal(report.cookieWrite, false, 'the custom secure scheme must not persist document cookies')
  assert.equal(report.cacheWrite?.ok, false, 'CacheStorage writes are unavailable to this custom protocol origin')
  assert.match(report.cacheWrite?.error ?? '', /Request scheme 'webtools-plugin' is unsupported/i)
  assert.equal(report.notificationPermission, 'denied')
  assert.equal(report.geolocationPermission, 'denied')
  assert.equal(report.popup, 'denied')
  assert.equal(report.loopbackFetch, 'blocked')
  assert.match(report.runtimeHost, /^[0-9a-f]{32}$/)
}

async function managerlessProbe(plugin) {
  const result = await plugin.call('Runtime.evaluate', {
    expression: 'window.__gate1Run()',
    awaitPromise: true,
    returnByValue: true,
  })
  return result.result?.value ?? []
}

try {
  await mkdir(profileRoot, { recursive: true })
  sink = await startLoopbackSink()
  const packageManifest = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))
  await writeFile(configPath, JSON.stringify({
    appId: 'dev.nook.launcher',
    productName: 'WebTools',
    directories: { output: packageOutput },
    files: ['out/**/*', 'package.json'],
    extraResources: [{ from: join(repoRoot, 'resources', 'app.ico'), to: 'brand-assets/app.ico' }],
    win: { icon: join(repoRoot, 'resources', 'app.ico') },
  }, null, 2))
  checked(process.execPath, [join(repoRoot, 'scripts', 'create-phase6e4b-runtime-fixture.mjs'), '--output', fixture, '--sink-url', sink.url])
  checked(process.execPath, [join(repoRoot, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js'), '--dir', '--config', configPath])
  assert.ok(packageManifest.version)
  assert.ok((await readFile(executable)).length > 0)
  const lifecycleOnly = process.env.WEBTOOLS_GATE1_LIFECYCLE_ONLY
  if (lifecycleOnly) {
    assert.ok(['switch-while-loading', 'close-while-loading', 'renderer-crash', 'hung-renderer'].includes(lifecycleOnly), 'unknown isolated lifecycle scenario')
    const lifecycleResult = await runLifecycleScenario(lifecycleOnly)
    await sink.close()
    sink = undefined
    console.log(JSON.stringify({ status: 'PACKAGED_LIFECYCLE_SCENARIO_COMPLETE', lifecycleResult }, null, 2))
  } else {
  const first = await runPackagedInstance(sink.url)
  const second = await runPackagedInstance(sink.url, true)
  checked(process.execPath, [join(repoRoot, 'scripts', 'create-phase6e4b-runtime-fixture.mjs'), '--output', fixture, '--sink-url', sink.url])
  const sinkConnections = sink.count()
  await sink.close()
  sink = undefined
  assert.equal(sinkConnections, 0, 'network.mode:none must not open a connection to the controlled loopback sink')
  assert.equal(second.switchedWithinProcess, true)
  assert.notEqual(first.runtimeHost, second.runtimeHost)
  const downloadCancellationObserved = [first.childOutput, second.childOutput].some(output => output.includes('[web-runtime-acceptance] download-cancelled'))
  assert.equal(downloadCancellationObserved, true, 'the packaged Session must cancel an actual download attempt')
  const switchWhileLoading = await runLifecycleScenario('switch-while-loading')
  const closeWhileLoading = await runLifecycleScenario('close-while-loading')
  const rendererCrash = await runLifecycleScenario('renderer-crash')
  const hungRenderer = await runLifecycleScenario('hung-renderer')
  const lifecycleScenarios = [switchWhileLoading, closeWhileLoading, rendererCrash, hungRenderer]
  assert.ok(lifecycleScenarios.every(result => result.passed), 'all packaged lifecycle scenarios must pass before evidence is written')
  const evidencePath = join(repoRoot, 'tests', 'security', 'web-plugin-runtime-gate1', 'results', 'phase6e4c-gate1-evidence.json')
  const remaining = await processCountForExecutable(executable)
  assert.equal(remaining, 0, 'all six packaged executions must end with no remaining process')
  const snapshotMutationVerified = second.childOutput.includes('validated snapshot survived source archive deletion and buffer mutation')
  const storageCleanupVerified = [first.childOutput, second.childOutput].every(output => output.includes('storage-cleanup=completed cookies-remaining=0'))
  assert.ok(snapshotMutationVerified && storageCleanupVerified, 'snapshot authority and Session cleanup require direct runtime evidence')
  const sha256File = async path => createHash('sha256').update(await readFile(path)).digest('hex')
  const evidence = {
    schema: 'webtools.phase6e4c.gate1-evidence.v1',
    recordedAt: new Date().toISOString(),
    source: {
      branch: checked('git', ['branch', '--show-current']),
      baselineCommit: checked('git', ['rev-parse', 'HEAD']),
      buildInput: 'current working tree; baseline commit alone does not contain the runtime',
    },
    artifact: {
      productVersion: packageManifest.version,
      electronVersion: checked(process.execPath, ['-p', "require('electron/package.json').version"]),
      packagedRuntime: true,
      executableSha256: await sha256File(executable),
      appAsarSha256: await sha256File(join(dirname(executable), 'resources', 'app.asar')),
      fixtureSha256: await sha256File(fixture),
      packagedExecutions: 6,
      exactPackagedExecutableRemainingProcessCount: remaining,
    },
    environment: {
      isolatedTemporaryProfile: true,
      chromiumChildrenVerifiedAgainstIsolatedProfile: true,
      disposablePackageFixture: true,
      productionInstallTouched: false,
      applicationUserDataTouched: false,
    },
    packagedScenarios: [
      { id: 'security-and-protocol-baseline', tested: true, result: 'pass' },
      { id: 'same-process-feature-switch', tested: true, result: 'pass' },
      ...lifecycleScenarios.map(({ scenario, passed }) => ({ id: scenario, tested: true, result: passed ? 'pass' : 'fail' })),
    ],
    groups: {
      snapshotAuthority: { tested: true, result: 'pass', sourceArchiveDeletedAfterValidation: snapshotMutationVerified, validatorInputBufferMutatedAfterValidation: snapshotMutationVerified },
      pathPolicy: { tested: true, result: 'pass', packagedProtocolResults: first.protocolResults },
      rendererIsolation: { tested: true, result: 'pass', observations: first.report },
      cspAndWasm: { tested: true, result: 'pass', declaredWasmAllowed: second.wasmReport.wasmCompile === 'allowed', evalStillBlocked: second.wasmReport.javascriptEval === 'blocked' },
      navigationAndPopups: { tested: true, result: 'pass', navigationResults: second.navigationResults, popupDenied: first.report.popup === 'denied' },
      networkNone: { tested: true, result: 'pass', controlledSinkConnectionCount: sinkConnections, controlledSinkRequestCount: sinkConnections },
      permissionsAndDownloads: { tested: true, result: 'pass', notifications: first.report.notificationPermission, geolocation: first.report.geolocationPermission, downloadCancellationObserved },
      storage: { tested: true, result: 'pass', scope: 'fresh origin and teardown completion; not direct post-close store enumeration', cleanupLogged: storageCleanupVerified },
      serviceWorker: { tested: true, result: 'pass', registration: first.report.serviceWorker },
      lifecycle: { tested: true, result: 'pass', staleGenerationCloseIgnored: true, sameProcessSwitch: second.switchedWithinProcess, crashReinvocation: rendererCrash.output.includes('crash-reopen=PASS') },
      processCleanup: { tested: true, result: 'pass', exactRemainingCount: remaining },
    },
    assuranceLimitations: [
      { area: 'additional snapshot and URL permutations', tested: false, result: 'not-exercised', blocking: false },
      { area: 'uncommon browser APIs and dedicated Worker permutations', tested: false, result: 'not-exercised', blocking: false },
      { area: 'post-close storage residue enumeration', tested: false, result: 'not-exercised', blocking: false },
      { area: 'explicit load-failure and additional schedule permutations', tested: false, result: 'not-exercised', blocking: false },
      { area: 'hostile trusted-Manager scripting and repeated resize/route permutations', tested: false, result: 'not-exercised', blocking: false },
    ],
    findings: { p0: 0, p1: 0, blockingP2: 0, nonBlockingP2: 0, p3: 0 },
    decision: {
      isolatedRuntimeBaselineAccepted: true,
      gate1: 'ACCEPTED', assurance: 'BOUNDED / NON-EXHAUSTIVE',
      gate4: 'NOT_CERTIFIED', networkModeDomains: 'UNSUPPORTED',
      phase6e4: 'COMPLETE', phase6e5: 'READY',
    },
  }
  const evidenceDirectory = join(repoRoot, 'tests', 'security', 'web-plugin-runtime-gate1', 'results')
  await writeFile(join(evidenceDirectory, 'phase6e4c-gate1-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({
    status: 'PACKAGED_RUNTIME_PASS',
    productVersion: packageManifest.version,
    packagedExecutable: executable,
    managerLaunchCount: 2,
    runtimeHostChanged: first.runtimeHost !== second.runtimeHost,
    firstRendererSecurityEvidence: first.report,
    secondProcessSwitchEvidence: { finalRuntimeHost: second.runtimeHost, switchedWithinProcess: second.switchedWithinProcess },
    lifecycleScenarios: lifecycleScenarios.map(({ scenario, passed }) => ({ scenario, passed })),
    managerCloseAndProcessExit: 'PASS',
    controlledLoopbackSinkConnections: sinkConnections,
    actualDeniedSessionEvents: first.childOutput.match(/request-denied scheme=http/g)?.length ?? 0,
    gate1Evidence: join('tests', 'security', 'web-plugin-runtime-gate1', 'results', 'phase6e4c-gate1-evidence.json'),
    gate1Decision: evidence.decision.gate1,
  }, null, 2))
  }
} catch (error) {
  preserveTemp = true
  console.error(error instanceof Error ? error.stack : String(error))
  process.exitCode = 1
} finally {
  await sink?.close()
  if (!preserveTemp) {
    const tempRootReal = resolve(await realpath(tmpdir()))
    const targetReal = resolve(await realpath(tempRoot))
    const relativeTarget = relative(tempRootReal, targetReal)
    if (!relativeTarget || relativeTarget === '..' || relativeTarget.startsWith(`..${sep}`) || isAbsolute(relativeTarget)) {
      throw new Error('Refusing to remove packaged acceptance files outside the unique temporary root.')
    }
    await rm(targetReal, { recursive: true, force: true })
  }
  else console.error(`Isolated Phase 6E-4B evidence retained at: ${tempRoot}`)
}
