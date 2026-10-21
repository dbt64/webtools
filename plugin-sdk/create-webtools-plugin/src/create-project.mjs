import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'

const FRAMEWORKS = new Set(['vanilla', 'vue', 'react', 'svelte'])
const RUNTIMES = new Set(['web', 'node'])
const MANAGERS = new Set(['pnpm', 'npm'])
const SDK_VERSION = '1.6.0'

function invalid() { return Object.assign(new Error('Invalid create options or unsafe project path.'), { code: 'CREATE_INVALID_INPUT' }) }
function exists() { return Object.assign(new Error('The target directory already exists.'), { code: 'CREATE_OUTPUT_EXISTS' }) }
function safeSlug(value) {
  const slug = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9-]+/gu, '-').replace(/^-+|-+$/gu, '').replace(/-{2,}/gu, '-')
  if (!slug || slug.length > 48) throw invalid()
  return slug
}
function validateId(value) {
  if (typeof value !== 'string' || value.length > 128 || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(value)
    || value === 'webtools' || value.startsWith('webtools.')) throw invalid()
  return value
}
function json(value) { return `${JSON.stringify(value, null, 2)}\n` }

function frameworkSource(framework, nodeRuntime) {
  const nodeSample = nodeRuntime ? " + ' · Plugin preload: ' + window.pluginSample.runtime + ', launch #' + window.pluginSample.count + '; ' + window.pluginSample.readExample()" : ''
  if (framework === 'vue') return {
    files: {
      'web/src/main.ts': `import { createApp } from 'vue'\nimport App from './App.vue'\nimport './style.css'\n\ncreateApp(App).mount('#app')\n`,
      'web/src/App.vue': `<script setup lang="ts">\nimport { onMounted, ref } from 'vue'\nimport { connectWebTools } from '@webtools/plugin-sdk/web'\n\nconst status = ref('Connecting to WebTools…')\nonMounted(async () => {\n  try { await connectWebTools().ready; document.documentElement.dataset.framework = 'vue'; status.value = 'WebTools API ready'${nodeSample} }\n  catch { status.value = 'Standalone preview' }\n})\n</script>\n\n<template><main><p class="eyebrow">WEBTOOLS PLUGIN</p><h1>Hello from Vue</h1><p>{{ status }}</p></main></template>\n`,
    },
    plugin: "import vue from '@vitejs/plugin-vue'\n",
    plugins: 'plugins: [vue()],',
    dependency: { vue: '^3.5.43' },
    devDependency: { '@vitejs/plugin-vue': '^6.0.9', 'vue-tsc': '^3.3.12' },
    buildCheck: 'vue-tsc --noEmit -p tsconfig.web.json && webtools-plugin build',
  }
  if (framework === 'react') return {
    files: {
      'web/src/main.tsx': `import React from 'react'\nimport { createRoot } from 'react-dom/client'\nimport { connectWebTools } from '@webtools/plugin-sdk/web'\nimport './style.css'\n\nfunction App() {\n  const [status, setStatus] = React.useState('Connecting to WebTools…')\n  React.useEffect(() => { connectWebTools().ready.then(() => { document.documentElement.dataset.framework = 'react'; setStatus('WebTools API ready'${nodeSample}) }, () => setStatus('Standalone preview')) }, [])\n  return <main><p className="eyebrow">WEBTOOLS PLUGIN</p><h1>Hello from React</h1><p>{status}</p></main>\n}\n\ncreateRoot(document.getElementById('app')!).render(<App />)\n`,
    },
    plugin: "import react from '@vitejs/plugin-react'\n",
    plugins: 'plugins: [react()],',
    dependency: { react: '^19.3.0', 'react-dom': '^19.3.0' },
    devDependency: { '@types/react': '^19.3.0', '@types/react-dom': '^19.3.0', '@vitejs/plugin-react': '^6.1.2' },
    buildCheck: 'webtools-plugin build',
  }
  if (framework === 'svelte') return {
    files: {
      'web/src/main.ts': `import { mount } from 'svelte'\nimport App from './App.svelte'\nimport './style.css'\n\nmount(App, { target: document.getElementById('app')! })\n`,
      'web/src/App.svelte': `<script lang="ts">\n  import { onMount } from 'svelte'\n  import { connectWebTools } from '@webtools/plugin-sdk/web'\n  let status = $state('Connecting to WebTools…')\n  onMount(() => { connectWebTools().ready.then(() => { document.documentElement.dataset.framework = 'svelte'; status = 'WebTools API ready'${nodeSample} }, () => status = 'Standalone preview') })\n</script>\n\n<main><p class="eyebrow">WEBTOOLS PLUGIN</p><h1>Hello from Svelte</h1><p>{status}</p></main>\n`,
    },
    plugin: "import { svelte } from '@sveltejs/vite-plugin-svelte'\n",
    plugins: 'plugins: [svelte()],',
    dependency: { svelte: '^5.57.1' },
    devDependency: { '@sveltejs/vite-plugin-svelte': '^7.3.1', 'svelte-check': '^4.7.6' },
    buildCheck: 'svelte-check --tsconfig ./tsconfig.web.json && webtools-plugin build',
  }
  return {
    files: {
      'web/src/main.ts': `import { connectWebTools } from '@webtools/plugin-sdk/web'\nimport './style.css'\n\nconst status = document.querySelector<HTMLParagraphElement>('#status')!\nconnectWebTools().ready.then(() => { document.documentElement.dataset.framework = 'vanilla'; status.textContent = 'WebTools API ready'${nodeSample} }, () => { status.textContent = 'Standalone preview' })\n`,
    },
    plugin: '',
    plugins: '',
    dependency: {},
    devDependency: {},
    buildCheck: 'webtools-plugin build',
  }
}

function filesFor({ name, id, displayName, framework, runtime, packageManager }) {
  const node = runtime === 'node'
  const view = frameworkSource(framework, node)
  for (const [relativePath, contents] of Object.entries(view.files)) {
    if (/^web\/src\/main\.(?:ts|tsx)$/u.test(relativePath)) {
      view.files[relativePath] = contents.replace(
        "import './style.css'\n",
        "import '@webtools/plugin-sdk/theme.css'\nimport './style.css'\n",
      )
    }
  }
  const manifest = {
    manifestVersion: 3,
    id,
    name: displayName,
    description: `${displayName} WebTools plugin`,
    author: { name: 'Plugin author' },
    version: '1.0.0',
    api: { apiMajor: 1, minHostVersion: '0.1.0' },
    type: 'plugin',
    requestedCapabilities: [],
    runtime: node ? { kind: 'node', preload: 'preload/index.cjs' } : { kind: 'web' },
    compatibility: { platforms: ['win32'], architectures: ['x64'], ...(node ? { nodeAbi: '149' } : {}) },
    features: [{ id: 'home', title: 'Home', entry: { kind: 'web-bundle', document: 'web/index.html' } }],
    runtimeFiles: [{ path: 'web/index.html', role: 'web', mediaType: 'text/html' }, ...(node ? [{ path: 'preload/index.cjs', role: 'node-preload', mediaType: 'text/javascript' }] : [])],
    dependencies: [],
    package: { format: 'wtplugin', packageVersion: 1 },
  }
  const frameworkTypecheck = framework === 'vue' ? 'vue-tsc --noEmit -p tsconfig.web.json'
    : framework === 'svelte' ? 'svelte-check --tsconfig ./tsconfig.web.json'
      : 'tsc --noEmit -p tsconfig.web.json'
  const sdkInstall = packageManager === 'pnpm'
    ? `pnpm add ${node ? '--save-prod' : '--save-dev'} "@webtools/plugin-sdk@file:<path-to-webtools-plugin-sdk-${SDK_VERSION}.tgz>"`
    : `npm install ${node ? '--save' : '--save-dev'} "@webtools/plugin-sdk@file:<path-to-webtools-plugin-sdk-${SDK_VERSION}.tgz>"`
  const authorCommands = packageManager === 'pnpm'
    ? `${sdkInstall}\npnpm install\npnpm dev\npnpm build\npnpm validate\npnpm run pack`
    : `${sdkInstall}\nnpm install\nnpm run dev\nnpm run build\nnpm run validate\nnpm run pack`
  const scripts = {
    dev: 'webtools-plugin dev',
    build: 'webtools-plugin build',
    typecheck: `${frameworkTypecheck}${node ? ' && tsc --noEmit -p tsconfig.preload.json' : ''}`,
    validate: 'webtools-plugin validate dist --host-version 0.1.0 --project-root .',
    pack: `webtools-plugin pack dist --out ${name}.wtplugin --host-version 0.1.0 --project-root .`,
    inspect: `webtools-plugin inspect ${name}.wtplugin --host-version 0.1.0`,
  }
  const sdkDependency = `^${SDK_VERSION}`
  const dependencies = node ? { '@webtools/plugin-sdk': sdkDependency } : {}
  const devDeps = {
    ...(!node ? { '@webtools/plugin-sdk': sdkDependency } : {}),
    '@types/node': '^24.19.1',
    typescript: '~6.0.2',
    vite: '^8.3.3',
    ...view.dependency,
    ...view.devDependency,
  }
  const files = {
    'package.json': json({ name, version: '1.0.0', private: true, type: 'module', ...(packageManager === 'pnpm' ? { packageManager: 'pnpm@9.15.9' } : {}), scripts, dependencies, devDependencies: devDeps }),
    'manifest.json': json(manifest),
    'tsconfig.web.json': json({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true, skipLibCheck: true, ...(framework === 'react' ? { jsx: 'react-jsx' } : {}), ...(framework === 'svelte' ? { allowJs: true, checkJs: true } : {}), lib: ['ES2022', 'DOM', 'DOM.Iterable'], types: ['vite/client', ...(framework === 'react' ? ['react', 'react-dom'] : [])] }, include: ['web/src/**/*'] }),
    'vite.config.ts': `import { defineConfig } from 'vite'\n${view.plugin}export default defineConfig({\n  base: './',\n  ${view.plugins}\n  build: { outDir: '../dist/web', emptyOutDir: true, rollupOptions: { output: { entryFileNames: 'assets/[name].js', chunkFileNames: 'assets/[name].js', assetFileNames: 'assets/[name][extname]' } } },\n})\n`,
    'web/index.html': `<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${displayName}</title></head><body><div id="app">${framework === 'vanilla' ? '<main><p class="eyebrow">WEBTOOLS PLUGIN</p><h1>Hello from Vanilla</h1><p id="status">Connecting to WebTools…</p></main>' : ''}</div><script type="module" src="/src/main.${framework === 'react' ? 'tsx' : 'ts'}"></script></body></html>\n`,
    'web/src/style.css': `:root{font:16px/1.5 system-ui,sans-serif;color:#f4f4f5;background:#17181b}*{box-sizing:border-box}body{margin:0}main{max-width:720px;margin:12vh auto;padding:32px}.eyebrow{color:#f49b42;font-size:12px;font-weight:700;letter-spacing:.14em}h1{font-size:clamp(32px,6vw,56px);margin:12px 0}p{color:#b8bac2}\n`,
    'README.md': `# ${displayName}\n\nAn independent WebTools Manifest v3 ${runtime.toUpperCase()} plugin using ${framework}.\n\n## Workflow\n\n\`\`\`sh\n${authorCommands}\n\`\`\`\n\nThe build writes a Host-ready directory to \`dist/\`; validate and pack operate on that output. Packing writes \`${name}.wtplugin\` beside this README so later builds can safely regenerate \`dist/\`. The WebTools Host repeats authoritative validation during installation. In pnpm, \`pnpm pack\` creates a Node package tarball; use \`pnpm run pack\` to create this plugin's \`.wtplugin\` file.\n`,
    '.gitignore': 'node_modules/\ndist/\n.webtools/\n*.wtplugin\n',
  }
  files['web/src/style.css'] = files['web/src/style.css']
    .replace('color:#f4f4f5;background:#17181b', 'color:var(--webtools-color-text,#1b2633);background:var(--webtools-color-background,#f3f5f8)')
    .replace('color:#f49b42', 'color:var(--webtools-color-accent,#2477f3)')
    .replace('color:#b8bac2', 'color:var(--webtools-color-muted,#5f6f80)')
  files['README.md'] += '\n## Optional theme support\n\nThe starter imports the optional `@webtools/plugin-sdk/theme.css` stylesheet. It consumes the Host theme tokens for page color-scheme, text, and background; remove the import if you want to manage those styles yourself. It does not impose a component library or page layout.\n'
  for (const [relative, content] of Object.entries(view.files)) files[relative] = content
  if (node) {
    files['preload/package.json'] = json({ type: 'commonjs' })
    files['tsconfig.preload.json'] = json({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, skipLibCheck: true, types: ['node'], outDir: 'dist/preload', rootDir: 'preload', esModuleInterop: true }, include: ['preload/**/*.ts'] })
    files['preload/index.ts'] = `import { readFileSync, writeFileSync } from 'node:fs'\nimport { join } from 'node:path'\nimport { getPluginPaths } from '@webtools/plugin-sdk/node'\n\ndeclare const __dirname: string\ndeclare function require(id: string): { contextBridge: { exposeInMainWorld(key: string, value: unknown): void } }\nconst { contextBridge } = require('electron')\nconst paths = getPluginPaths(__dirname)\nconst countFile = join(paths.localDataDirectory, 'launch-count.json')\nlet count = 0\ntry { count = Number(JSON.parse(readFileSync(countFile, 'utf8')).count) || 0 } catch {}\ncount += 1\nwriteFileSync(countFile, JSON.stringify({ count }), 'utf8')\ncontextBridge.exposeInMainWorld('pluginSample', {\n  runtime: 'node',\n  count,\n  readResource(name: string) { return readFileSync(join(paths.packageDirectory, 'resources', name), 'utf8') },\n})\n`
    files['preload/index.ts'] = `import { readFileSync, writeFileSync } from 'node:fs'\nimport { join } from 'node:path'\nimport { getPluginPaths } from '@webtools/plugin-sdk/node'\n\ndeclare const __dirname: string\ndeclare function require(id: string): { contextBridge: { exposeInMainWorld(key: string, value: unknown): void } }\nconst { contextBridge } = require('electron')\nconst paths = getPluginPaths(__dirname)\nconst countFile = join(paths.localDataDirectory, 'launch-count.json')\nlet count = 0\ntry { count = Number(JSON.parse(readFileSync(countFile, 'utf8')).count) || 0 } catch {}\ncount += 1\nwriteFileSync(countFile, JSON.stringify({ count }), 'utf8')\ncontextBridge.exposeInMainWorld('pluginSample', {\n  runtime: 'node',\n  count,\n  readExample() { return readFileSync(join(paths.packageDirectory, 'resources', 'example.txt'), 'utf8').trim() },\n})\n`
    files['web/src/plugin-api.d.ts'] = `export {}\n\ndeclare global {\n  interface Window {\n    readonly pluginSample: {\n      readonly runtime: 'node'\n      readonly count: number\n      readExample(): string\n    }\n  }\n}\n`
    files['assets/example.txt'] = 'This text came from the Node plugin package resources.\n'
  }
  return files
}

async function ensureSafeTarget(cwd, directory) {
  const rootStat = await lstat(cwd).catch(() => undefined)
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) throw invalid()
  const root = await realpath(cwd)
  const targetText = String(directory ?? '').trim()
  if (!targetText || path.isAbsolute(targetText) || targetText.split(/[\\/]/u).some(part => !part || part === '.' || part === '..')) throw invalid()
  const target = path.resolve(root, targetText)
  const rel = path.relative(root, target)
  if (!rel || rel.startsWith(`..${path.sep}`) || rel === '..' || path.isAbsolute(rel)) throw invalid()
  let parent = root
  for (const segment of rel.split(path.sep).slice(0, -1)) {
    parent = path.join(parent, segment)
    const info = await lstat(parent).catch(() => undefined)
    if (!info?.isDirectory() || info.isSymbolicLink() || await realpath(parent) !== parent) throw invalid()
  }
  const existing = await lstat(target).catch(() => undefined)
  if (existing) throw exists()
  return { root, target }
}

export async function createPluginProject(directory, options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const { root, target } = await ensureSafeTarget(cwd, directory)
  const projectName = safeSlug(options.projectName ?? path.basename(target))
  const framework = options.framework ?? 'vanilla'
  const runtime = options.runtime ?? 'web'
  const packageManager = options.packageManager ?? 'pnpm'
  if (!FRAMEWORKS.has(framework) || !RUNTIMES.has(runtime) || !MANAGERS.has(packageManager)) throw invalid()
  const id = validateId(options.id ?? `org.example.${projectName}`)
  const displayName = String(options.displayName ?? projectName).trim()
  if (!displayName || displayName.length > 80) throw invalid()
  const files = filesFor({ name: projectName, id, displayName, framework, runtime, packageManager })
  const created = []
  try {
    await mkdir(target)
    created.push(target)
    for (const folder of ['assets', 'dist', 'web', 'web/src', ...(runtime === 'node' ? ['preload'] : [])]) {
      await mkdir(path.join(target, folder))
      created.push(path.join(target, folder))
    }
    const verifiedRoot = await realpath(root)
    if (await realpath(target) !== path.join(verifiedRoot, path.relative(root, target))) throw invalid()
    for (const [relative, contents] of Object.entries(files)) {
      const output = path.join(target, ...relative.split('/'))
      const parent = await realpath(path.dirname(output))
      const rel = path.relative(target, parent)
      if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw invalid()
      await writeFile(output, contents, { flag: 'wx' })
      created.push(output)
    }
    return { directory: path.relative(cwd, target).split(path.sep).join('/'), manifest: JSON.parse(files['manifest.json']) }
  } catch (error) {
    // The destination was proven absent; remove only paths created by this call.
    for (const item of created.reverse()) await import('node:fs/promises').then(fs => fs.rm(item, { recursive: true, force: true })).catch(() => {})
    throw error
  }
}
