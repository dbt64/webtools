import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { ManagedFs } from './managed-fs.ts'

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'webtools-atomic-lock-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fs = new ManagedFs(root)
  await fs.initialize()
  await fs.atomicJson('config/settings.json', { message: 'before' })
  return { fs, root, target: join(root, 'config', 'settings.json') }
}

// Hold a real Windows handle without FILE_SHARE_DELETE, matching a temporary
// external reader that prevents atomic replacement. No product files are used.
async function lockTarget(target) {
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$f=[IO.File]::Open($env:WEBTOOLS_ATOMIC_TEST_PATH,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read); try { [Console]::Out.WriteLine("locked"); [void][Console]::In.ReadLine() } finally { $f.Dispose() }'],
  { env: { ...process.env, WEBTOOLS_ATOMIC_TEST_PATH: target }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const exited = once(child, 'exit')
  const lines = createInterface({ input: child.stdout })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`File-lock helper did not become ready: ${stderr}`)), 5000)
      lines.once('line', line => { clearTimeout(timer); line === 'locked' ? resolve() : reject(new Error(line)) })
      child.once('error', error => { clearTimeout(timer); reject(error) })
      exited.then(() => { clearTimeout(timer); reject(new Error(`File-lock helper exited early: ${stderr}`)) })
    })
  } catch (error) { child.stdin.end('\n'); await exited; lines.close(); throw error }
  let releasing
  return {
    release() {
      return releasing ??= (async () => { child.stdin.end('\n'); const [code] = await exited; lines.close(); assert.equal(code, 0, stderr) })()
    },
  }
}

test('atomic replacement survives a short Windows file lock without deleting prior data', { skip: process.platform !== 'win32' }, async t => {
  const { fs, root, target } = await setup(t)
  const lock = await lockTarget(target)
  let releaseTimer
  try {
    await fs.atomicJson('config/settings.json', { message: 'after' }, () => {
      releaseTimer ??= setTimeout(() => { void lock.release() }, 60)
      return true
    })
    assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), { message: 'after' })
    assert.deepEqual(await readdir(join(root, 'config')), ['settings.json'])
  } finally { clearTimeout(releaseTimer); await lock.release() }
})

test('revocation during Windows replacement retry preserves the original file', { skip: process.platform !== 'win32' }, async t => {
  const { fs, root, target } = await setup(t)
  const lock = await lockTarget(target)
  let allowed = true
  try {
    await assert.rejects(fs.atomicJson('config/settings.json', { message: 'forbidden' }, () => {
      const result = allowed
      queueMicrotask(() => { allowed = false })
      return result
    }), error => error.code === 'SESSION_EXPIRED')
    assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), { message: 'before' })
    assert.deepEqual(await readdir(join(root, 'config')), ['settings.json'])
  } finally { await lock.release() }
})

test('persistent Windows file lock fails within the bounded retry and cleans its temporary file', { skip: process.platform !== 'win32' }, async t => {
  const { fs, root, target } = await setup(t)
  const lock = await lockTarget(target)
  let attempts = 0
  try {
    await assert.rejects(fs.atomicJson('config/settings.json', { message: 'blocked' }, () => { attempts++; return true }),
      error => ['EPERM', 'EBUSY'].includes(error.code))
    assert.ok(attempts > 1 && attempts <= 6, `bounded attempts: ${attempts}`)
    assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), { message: 'before' })
    assert.deepEqual(await readdir(join(root, 'config')), ['settings.json'])
  } finally { await lock.release() }
})
