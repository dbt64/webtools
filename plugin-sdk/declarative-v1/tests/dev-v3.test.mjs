import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import { createPluginProject } from '../../create-webtools-plugin/src/create-project.mjs'
import { startDevSession } from '../src/cli.mjs'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../..')

async function linkPackage(project, packageName, source) {
  const parts = packageName.split('/')
  const parent = path.join(project, 'node_modules', ...parts.slice(0, -1))
  await mkdir(parent, { recursive: true })
  await symlink(source, path.join(parent, parts.at(-1)), 'junction')
}

test('dev starts loopback preview, serves the page, and rebuilds Node preload changes', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wt-plugin-dev-v3-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await createPluginProject('dev-plugin', { cwd: root, framework: 'vanilla', runtime: 'node', id: 'org.example.dev-plugin' })
  const project = path.join(root, 'dev-plugin')
  const viteConfigPath = path.join(project, 'vite.config.ts')
  const viteConfig = await readFile(viteConfigPath, 'utf8')
  const portProbe = net.createServer()
  await new Promise((resolve, reject) => { portProbe.once('error', reject); portProbe.listen(0, '127.0.0.1', resolve) })
  const testPort = portProbe.address().port
  await new Promise(resolve => portProbe.close(resolve))
  await writeFile(viteConfigPath, viteConfig.replace('export default defineConfig({', `export default defineConfig({\n  server: { host: '127.0.0.1', port: ${testPort}, strictPort: true },`))
  await linkPackage(project, 'vite', path.join(repo, 'node_modules', 'vite'))
  await linkPackage(project, 'typescript', path.join(repo, 'node_modules', 'typescript'))
  await linkPackage(project, '@types/node', path.join(repo, 'node_modules', '@types', 'node'))
  const sdkPackage = path.join(project, 'node_modules', '@webtools', 'plugin-sdk')
  await mkdir(path.dirname(sdkPackage), { recursive: true })
  await cp(path.join(repo, 'plugin-sdk', 'declarative-v1'), sdkPackage, { recursive: true })
  const rootRequire = createRequire(path.join(repo, 'package.json'))
  const yauzlEntry = rootRequire.resolve('yauzl')
  const yauzlRoot = path.dirname(await realpath(yauzlEntry))
  await cp(yauzlRoot, path.join(project, 'node_modules', 'yauzl'), { recursive: true })
  const pendEntry = createRequire(yauzlEntry).resolve('pend')
  const pendRoot = path.dirname(await realpath(pendEntry))
  await cp(pendRoot, path.join(project, 'node_modules', 'pend'), { recursive: true })

  let resolveRebuild
  const rebuilt = new Promise(resolve => { resolveRebuild = resolve })
  const session = await startDevSession(project, { onRebuild: relative => resolveRebuild(relative) })
  try {
    const address = session.server.httpServer.address()
    assert.equal(address.address, '127.0.0.1')
    const response = await fetch(`http://127.0.0.1:${address.port}/`)
    assert.equal(response.status, 200)
    const previewHtml = await response.text()
    assert.match(previewHtml, /id="app"/u)
    assert.match(previewHtml, /Hello from Vanilla/u)

    const preload = path.join(project, 'preload', 'index.ts')
    await writeFile(preload, `${await readFile(preload, 'utf8')}\n// dev-watch-change\n`)
    let timeout
    const timeoutPromise = new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Node preload change was not rebuilt')), 15_000) })
    const changedPath = await Promise.race([rebuilt, timeoutPromise]).finally(() => clearTimeout(timeout))
    assert.equal(changedPath, 'preload/index.ts')
    assert.match(await readFile(path.join(project, 'dist', 'preload', 'index.cjs'), 'utf8'), /dev-watch-change/u)
  } finally {
    await session.close()
  }
})
