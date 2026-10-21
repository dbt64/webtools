import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, createConnection } from 'node:net'
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { preparePluginV3 } from './pack-v3.mjs'

// The CLI owns the listener. Manager connects only after the user selects this
// project; there is no development control server listening inside WebTools.
export async function createDevelopmentConnection(projectRoot, options) {
  if (process.platform !== 'win32') return null
  const root = await realpath(projectRoot)
  const directory = path.join(root, '.webtools')
  await mkdir(directory, { recursive: true })
  if ((await lstat(directory)).isSymbolicLink() || await realpath(directory) !== directory) throw new Error('Unsafe .webtools development directory.')
  const markerPath = path.join(directory, 'development.json')
  let previous
  try {
    const info = await lstat(markerPath)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) throw new Error('Unsafe development session marker.')
    previous = JSON.parse(await readFile(markerPath, 'utf8'))
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (previous?.pipeName && /^WebTools\.PluginDevelopment\.[a-f0-9-]{36}$/u.test(previous.pipeName)) {
    const running = await new Promise(resolve => {
      const probe = createConnection(`\\\\.\\pipe\\${previous.pipeName}`)
      const finish = value => { probe.destroy(); resolve(value) }
      probe.once('connect', () => finish(true))
      probe.once('error', () => finish(false))
      probe.setTimeout(2000, () => finish(true))
    })
    if (running) throw new Error('A WebTools development session is already running for this project.')
  }
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'))
  const sessionId = randomUUID()
  const pipeName = `WebTools.PluginDevelopment.${sessionId}`
  const token = randomBytes(32).toString('hex')
  const sessionRoot = path.join(directory, sessionId)
  await mkdir(sessionRoot)
  let socket
  let latest
  let inFlight
  let lastDiagnostic
  let revision = 0
  let closed = false
  const archives = new Map()
  const send = value => { if (socket && !socket.destroyed) socket.write(`${JSON.stringify(value)}\n`) }
  const sendLatest = () => {
    if (!latest || inFlight !== undefined || !socket || socket.destroyed) return
    inFlight = latest.revision
    send({ type: 'build', ...latest })
  }
  const server = createServer(candidate => {
    let authenticated = false
    let buffer = ''
    candidate.setEncoding('utf8')
    candidate.setTimeout(5000, () => { if (!authenticated) candidate.destroy() })
    candidate.on('error', () => {})
    candidate.on('data', chunk => {
      buffer += chunk
      if (buffer.length > 16_384) { candidate.destroy(); return }
      let newline
      while ((newline = buffer.indexOf('\n')) >= 0) {
        let message
        try { message = JSON.parse(buffer.slice(0, newline)) } catch { candidate.destroy(); return }
        buffer = buffer.slice(newline + 1)
        if (!message || typeof message !== 'object' || Array.isArray(message)) { candidate.destroy(); return }
        if (!authenticated) {
          const offered = typeof message.token === 'string' ? Buffer.from(message.token, 'utf8') : Buffer.alloc(0)
          const expected = Buffer.from(token, 'utf8')
          if (message.type !== 'attach' || message.sessionId !== sessionId || offered.length !== expected.length
            || !timingSafeEqual(offered, expected) || (socket && !socket.destroyed)) { candidate.destroy(); return }
          authenticated = true
          candidate.setTimeout(0)
          socket = candidate
          inFlight = undefined
          send({ type: 'ready', sessionId, pluginId: manifest.id, projectRoot: root })
          options.onStatus?.('Connected to WebTools Developer Mode. Successful rebuilds now reload the active Host Feature.')
          sendLatest()
          // Restore the last valid snapshot first. A later failed rebuild must
          // remain visible after that snapshot finishes loading in the Host.
          if (lastDiagnostic) send(lastDiagnostic)
        } else if (message.type === 'ack' && message.revision === inFlight) {
          inFlight = undefined
          for (const [key, file] of archives) {
            if (key < latest?.revision) { archives.delete(key); void rm(file, { force: true }).catch(() => {}) }
          }
          if (latest && latest.revision > message.revision) sendLatest()
        }
      }
    })
    candidate.on('close', () => {
      if (socket !== candidate) return
      socket = undefined; inFlight = undefined
      options.onStatus?.('WebTools development connection closed. The preview and watcher remain available; reconnect this project in Plugin Center.')
    })
  })
  const temporaryMarker = path.join(directory, `${sessionId}.json.tmp`)
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(`\\\\.\\pipe\\${pipeName}`, () => { server.removeListener('error', reject); resolve() }) })
    server.on('error', error => options.onError?.(error))
    const marker = { protocolVersion: 1, pluginId: manifest.id, projectRoot: root, sessionId, pipeName, token }
    await writeFile(temporaryMarker, JSON.stringify(marker), { flag: 'wx', mode: 0o600 })
    await rename(temporaryMarker, markerPath)
  } catch (error) {
    server.close()
    await rm(temporaryMarker, { force: true })
    await rm(sessionRoot, { recursive: true, force: true })
    throw error
  }
  options.onStatus?.('Waiting for WebTools. In Manager → Plugin Center, enable Developer Mode and connect this project directory.')
  return {
    async publishBuild() {
      if (closed) return
      const prepared = await preparePluginV3(path.join(root, 'dist'), options.hostVersion, { projectRoot: root, host: options.host })
      if (prepared.manifest.id !== manifest.id) throw Object.assign(new Error('The Plugin ID changed. Restart pnpm dev and authorize the new project identity in WebTools.'), { code: 'DEV_PLUGIN_ID_CHANGED', path: 'manifest.json' })
      const next = ++revision
      const archivePath = path.join(sessionRoot, `build-${next}.wtplugin`)
      await writeFile(archivePath, prepared.archive, { flag: 'wx' })
      if (closed) { await rm(archivePath, { force: true }); return }
      archives.set(next, archivePath)
      latest = { revision: next, archivePath }
      lastDiagnostic = undefined
      // Keep the currently delivered archive and the latest build, not every edit.
      for (const [key, file] of archives) {
        if (key !== next && key !== inFlight) { archives.delete(key); await rm(file, { force: true }) }
      }
      sendLatest()
    },
    reportError(error) {
      if (closed) return
      lastDiagnostic = { type: 'diagnostic', phase: /PRELOAD/u.test(error.code ?? '') ? 'preload' : 'build',
        code: String(error.code ?? 'DEV_BUILD_FAILED').slice(0, 128), message: String(error.message ?? error).slice(0, 4096),
        source: String(error.path ?? 'manifest.json').slice(0, 512), stack: String(error.stack ?? '').slice(0, 8192) }
      send(lastDiagnostic)
    },
    async close() {
      if (closed) return
      closed = true
      socket?.end()
      socket?.destroy()
      await new Promise(resolve => server.close(resolve))
      try { const current = JSON.parse(await readFile(markerPath, 'utf8')); if (current.sessionId === sessionId) await rm(markerPath) } catch (error) { if (error.code !== 'ENOENT') options.onError?.(error) }
      await rm(sessionRoot, { recursive: true, force: true })
    },
  }
}
