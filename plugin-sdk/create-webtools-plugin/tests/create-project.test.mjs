import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createPluginProject } from '../src/create-project.mjs'

const packageRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const bin = path.join(packageRoot, 'bin', 'create-webtools-plugin.mjs')

function psQuote(value) { return `'${String(value).replaceAll("'", "''")}'` }
function runPnpm(args, cwd) {
  const result = process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `& pnpm.cmd ${args.map(psQuote).join(' ')}; exit $LASTEXITCODE`], { cwd, encoding: 'utf8', windowsHide: true })
    : spawnSync('pnpm', args, { cwd, encoding: 'utf8', windowsHide: true })
  return result
}

test('creates isolated Web and Node starters for each supported framework', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wt-create-template-'))
  try {
    for (const framework of ['vanilla', 'vue', 'react', 'svelte']) {
      for (const runtime of ['web', 'node']) {
        const directory = `${framework}-${runtime}`
        const result = await createPluginProject(directory, {
          projectName: directory,
          id: `org.example.${directory}`,
          displayName: `${framework} ${runtime}`,
          framework,
          runtime,
          cwd: root,
        })
        const base = path.join(root, directory)
        const manifest = JSON.parse(await readFile(path.join(base, 'manifest.json'), 'utf8'))
        const packageJson = JSON.parse(await readFile(path.join(base, 'package.json'), 'utf8'))
        const entry = await readFile(path.join(base, 'web', 'index.html'), 'utf8')
        const readme = await readFile(path.join(base, 'README.md'), 'utf8')
        const frameworkSourcePath = framework === 'vue' ? 'App.vue' : framework === 'svelte' ? 'App.svelte' : framework === 'react' ? 'main.tsx' : 'main.ts'
        const frameworkSource = await readFile(path.join(base, 'web', 'src', frameworkSourcePath), 'utf8')
        const frontendEntryName = framework === 'react' ? 'main.tsx' : 'main.ts'
        const frontendEntry = await readFile(path.join(base, 'web', 'src', frontendEntryName), 'utf8')
        assert.equal(result.manifest.runtime.kind, runtime)
        assert.equal(manifest.manifestVersion, 3)
        assert.equal(manifest.id, `org.example.${directory}`)
        assert.equal(manifest.runtime.kind, runtime)
        assert.equal(packageJson.scripts.dev, 'webtools-plugin dev')
        assert.match(packageJson.scripts.build, /webtools-plugin build/u)
        assert.equal(packageJson.scripts.validate, 'webtools-plugin validate dist --host-version 0.1.0 --project-root .')
        assert.equal(packageJson.scripts.pack, `webtools-plugin pack dist --out ${directory}.wtplugin --host-version 0.1.0 --project-root .`)
        assert.equal(packageJson.scripts.inspect, `webtools-plugin inspect ${directory}.wtplugin --host-version 0.1.0`)
        assert.match(readme, /pnpm run pack/u)
        assert.match(readme, runtime === 'node' ? /pnpm add --save-prod[\s\S]*@webtools\/plugin-sdk/u : /pnpm add --save-dev[\s\S]*@webtools\/plugin-sdk/u)
        assert.doesNotMatch(readme, /^pnpm pack$/mu)
        assert.doesNotMatch(packageJson.scripts.typecheck, /manifest\.typecheck/u)
        assert.match(frontendEntry, /import ['"]@webtools\/plugin-sdk\/theme\.css['"]/u)
        const runtimeDependencies = runtime === 'node' ? ['@webtools/plugin-sdk'] : []
        assert.deepEqual(Object.keys(packageJson.dependencies ?? {}).sort(), runtimeDependencies, `${framework}/${runtime} runtime dependency set`)
        for (const dependency of ({ vanilla: [], vue: ['vue'], react: ['react', 'react-dom'], svelte: ['svelte'] })[framework]) {
          assert.ok(packageJson.devDependencies[dependency], `${dependency} must be a development dependency`)
        }
        await assert.rejects(readFile(path.join(base, 'manifest.typecheck.ts')))
        if (runtime === 'node') {
          assert.equal(packageJson.devDependencies['@webtools/plugin-sdk'], undefined, 'Node preload SDK import must be shipped as a runtime dependency')
          assert.equal(packageJson.dependencies['@webtools/plugin-sdk'], '^1.6.0')
        } else assert.equal(packageJson.devDependencies['@webtools/plugin-sdk'], '^1.6.0')
        assert.match(entry, /id="app"/u)
        assert.match(frameworkSource, /document\.documentElement\.dataset\.framework\s*=/u)
        assert.doesNotMatch(packageJson.dependencies?.['webtools-desktop'] ?? '', /.+/u)
        if (runtime === 'node') {
          const preload = await readFile(path.join(base, 'preload', 'index.ts'), 'utf8')
          const frontendPath = framework === 'vue' ? 'App.vue' : framework === 'svelte' ? 'App.svelte' : framework === 'react' ? 'main.tsx' : 'main.ts'
          const frontend = await readFile(path.join(base, 'web', 'src', frontendPath), 'utf8')
          const frontendTypes = await readFile(path.join(base, 'web', 'src', 'plugin-api.d.ts'), 'utf8')
          assert.equal(manifest.runtime.preload, 'preload/index.cjs')
          assert.match(preload, /contextBridge/u)
          assert.match(preload, /getPluginPaths/u)
          assert.match(preload, /node:fs/u)
          assert.match(preload, /node:path/u)
          assert.match(frontendTypes, /interface Window[\s\S]*pluginSample/u)
          assert.match(frontend, /window\.pluginSample/u)
          assert.match(frontend, /readExample\(/u)
          assert.doesNotMatch(frontend, /\$\{window\.pluginSample/u)
          assert.match(frontend, /['"]WebTools API ready['"]\s*\+\s*['"] · Plugin preload: ['"]/u)
        } else {
          await assert.rejects(readFile(path.join(base, 'preload', 'index.ts')))
          await assert.rejects(readFile(path.join(base, 'web', 'src', 'plugin-api.d.ts')))
        }
        assert.doesNotMatch(await readFile(path.join(base, 'README.md'), 'utf8'), /\.\.\/\.\.\/(?:src|electron)/u)
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects unsafe names, ids, and existing destinations without modifying the destination', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wt-create-reject-'))
  try {
    await assert.rejects(createPluginProject('../escape', { projectName: 'escape', cwd: root }), { code: 'CREATE_INVALID_INPUT' })
    await assert.rejects(createPluginProject('valid-name', {
      projectName: 'valid-name', id: 'webtools.bad', cwd: root,
    }), { code: 'CREATE_INVALID_INPUT' })
    await createPluginProject('already-there', { projectName: 'already-there', cwd: root })
    await assert.rejects(createPluginProject('already-there', { projectName: 'already-there', cwd: root }), { code: 'CREATE_OUTPUT_EXISTS' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('standalone create package exposes the npm create convention and works outside the repository', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wt-create-cli-external-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'))
  const packageReadme = await readFile(path.join(packageRoot, 'README.md'), 'utf8')
  assert.equal(packageJson.name, 'create-webtools-plugin')
  assert.equal(packageJson.version, '1.1.0')
  assert.deepEqual(packageJson.bin, { 'create-webtools-plugin': 'bin/create-webtools-plugin.mjs' })
  assert.deepEqual(packageJson.dependencies ?? {}, {})
  assert.match(packageReadme, /pnpm exec create-webtools-plugin/u)
  assert.match(packageReadme, /Once the package is published[\s\S]*`pnpm create webtools-plugin`/u)

  const created = spawnSync(process.execPath, [bin, 'outside-plugin', '--framework', 'react', '--runtime', 'node', '--yes'], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  })
  assert.equal(created.status, 0, created.stderr || created.stdout)
  assert.match(created.stdout, /matching @webtools\/plugin-sdk 1\.6\.0 tarball/u)
  const manifest = JSON.parse(await readFile(path.join(root, 'outside-plugin', 'manifest.json'), 'utf8'))
  assert.equal(manifest.manifestVersion, 3)
  assert.equal(manifest.runtime.kind, 'node')
  assert.match(await readFile(path.join(root, 'outside-plugin', 'preload', 'index.ts'), 'utf8'), /contextBridge/u)
  assert.equal((await readFile(path.join(root, 'outside-plugin', 'package.json'), 'utf8')).includes(packageRoot), false)
})

test('packed create package runs its CLI through a pnpm-installed bin shim', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wt-create-package-bin-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const artifacts = path.join(root, 'artifacts')
  const tooling = path.join(root, 'tooling')
  await mkdir(artifacts, { recursive: true })
  await mkdir(tooling, { recursive: true })
  await writeFile(path.join(tooling, 'package.json'), JSON.stringify({ name: 'create-cli-consumer', private: true, packageManager: 'pnpm@9.15.9' }))

  const packed = runPnpm(['pack', '--pack-destination', artifacts], packageRoot)
  assert.equal(packed.status, 0, packed.stderr)
  const installed = runPnpm(['add', '--ignore-scripts', path.join(artifacts, 'create-webtools-plugin-1.1.0.tgz')], tooling)
  assert.equal(installed.status, 0, installed.stderr)
  const created = runPnpm(['exec', 'create-webtools-plugin', 'generated-plugin', '--framework', 'vanilla', '--runtime', 'web', '--yes'], tooling)
  assert.equal(created.status, 0, created.stderr || created.stdout)
  const manifest = JSON.parse(await readFile(path.join(tooling, 'generated-plugin', 'manifest.json'), 'utf8'))
  assert.equal(manifest.manifestVersion, 3)
  assert.equal(manifest.runtime.kind, 'web')
})
