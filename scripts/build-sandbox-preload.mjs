import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'vite'

const root = process.cwd()
const output = resolve(root, 'out/preload/web-plugin.js')

await build({
  configFile: false,
  root,
  build: {
    outDir: resolve(root, 'out/preload'),
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(root, 'electron/web-plugin-preload.ts'),
      external: ['electron'],
      output: {
        format: 'cjs',
        inlineDynamicImports: true,
        entryFileNames: 'web-plugin.js',
      },
    },
  },
})

const bundle = await readFile(output, 'utf8')
if (/require\(["'](?:node:|\.\/)/.test(bundle)) {
  throw new Error('Sandboxed Web Plugin preload must be a single file and use no Node.js modules.')
}
