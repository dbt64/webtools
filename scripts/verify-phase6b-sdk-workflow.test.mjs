import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PINNED_PNPM,
  assertExternalDependencyGraph,
  assertWorkflowLayout,
  buildWorkflowCommandPlan,
  createWorkflowLayout,
  childEnvironment,
} from './verify-phase6b-sdk-workflow.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function tempRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webtools-phase6b-sdk-workflow-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test('workflow layout is unique OS-temp-only and keeps every artifact outside the checkout', async t => {
  const root = await tempRoot(t)
  const layout = createWorkflowLayout(root, repo)
  assert.equal(assertWorkflowLayout(layout, repo), true)
  for (const [key, candidate] of Object.entries(layout)) {
    if (key === 'repo' || key === 'sdk') continue
    if (typeof candidate === 'string' && path.isAbsolute(candidate)) {
      const relative = path.relative(root, candidate)
      assert.equal(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), false, candidate)
      assert.equal(path.relative(repo, candidate).startsWith('..'), true, candidate)
    }
  }
  assert.match(layout.root, /webtools-phase6b-sdk-workflow-/)
  assert.equal(layout.report, path.join(root, 'workflow-report.json'))
})

test('workflow layout rejects non-temp roots, forged output locations and repository overlap', async t => {
  const root = await tempRoot(t)
  const layout = createWorkflowLayout(root, repo)
  assert.throws(() => createWorkflowLayout(repo, repo), /isolated|temporary/i)
  assert.throws(() => createWorkflowLayout(path.join(os.homedir(), 'AppData', 'Roaming', 'Nook'), repo), /isolated|temporary/i)
  assert.throws(() => assertWorkflowLayout({ ...layout, author: path.join(repo, 'plugin-test') }, repo), /layout|temporary|isolated/i)
  assert.throws(() => assertWorkflowLayout({ ...layout, report: path.join('D:\\webtools', 'workflow-report.json') }, repo), /layout|temporary|isolated/i)
  assert.throws(() => assertWorkflowLayout({ ...layout, repo: root }, repo), /layout|temporary|isolated/i)
})

test('workflow child environment removes Node module injection variables without mutating the parent environment', () => {
  const source = { PATH: 'safe-path', NODE_PATH: 'C:\\private\\modules', NODE_OPTIONS: '--require=C:\\private\\hook.cjs', HOME: 'safe-home' }
  const child = childEnvironment(source)
  assert.deepEqual(child, { PATH: 'safe-path', HOME: 'safe-home' })
  assert.equal(source.NODE_PATH, 'C:\\private\\modules')
  assert.equal(source.NODE_OPTIONS, '--require=C:\\private\\hook.cjs')
  assert.deepEqual(childEnvironment({ node_path: 'C:\\private\\modules', node_options: '--require=hook.cjs', PATH: 'safe-path' }), { PATH: 'safe-path' })
})

test('external dependency inspection rejects checkout, workspace and absolute source links', () => {
  assert.equal(assertExternalDependencyGraph('{"name":"author","dependencies":{"@webtools/plugin-sdk":"file:../../artifacts/webtools-plugin-sdk-1.1.0.tgz"}}', 'lockfileVersion: 9.0\nresolution: file:../../artifacts/webtools-plugin-sdk-1.1.0.tgz', repo), true)
  for (const text of [
    JSON.stringify({ path: path.join(repo, 'plugin-sdk', 'declarative-v1') }),
    'specifier: workspace:*',
    'resolution: link:../../plugin-sdk/declarative-v1',
    `resolution: file:${path.join(repo, 'plugin-sdk', 'declarative-v1')}`,
  ]) assert.throws(() => assertExternalDependencyGraph(text, '', repo), /checkout|workspace|absolute|link/i)
})

test('planned subprocesses are restricted to pinned pnpm or Node inside the isolated roots', async t => {
  const root = await tempRoot(t)
  const layout = createWorkflowLayout(root, repo)
  const pnpmPath = path.join(path.dirname(process.execPath), 'node_modules', 'pnpm', 'pnpm.exe')
  const plan = buildWorkflowCommandPlan(layout, { pnpmPath, nodePath: process.execPath, sdkVersion: '1.1.0' })
  assert.ok(plan.length > 0)
  assert.ok(plan.some(command => command.executable === pnpmPath && command.args[0] === 'pack'))
  assert.ok(plan.every(command => [pnpmPath, process.execPath].includes(command.executable)))
  assert.ok(plan.every(command => command.cwd === layout.sdk || command.cwd === layout.tooling || command.cwd === layout.author))
  assert.ok(plan.every(command => !/reg(?:\.exe)?|taskkill|process\.kill|powershell|cmd\.exe|D:\\webtools|AppData\\Roaming\\Nook/i.test(`${command.executable} ${command.args.join(' ')} ${command.cwd}`)))
  assert.equal(PINNED_PNPM, '9.15.9')
  assert.throws(() => buildWorkflowCommandPlan(layout, { pnpmPath: 'powershell.exe', nodePath: process.execPath, sdkVersion: '1.1.0' }), /pnpm|executable/i)
  assert.throws(() => buildWorkflowCommandPlan({ ...layout, repo: root }, { pnpmPath, nodePath: process.execPath, sdkVersion: '1.1.0' }), /layout|temporary|isolated/i)
})
