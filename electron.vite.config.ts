import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'electron/main.ts'), 'plugin-command': resolve(__dirname, 'electron/plugins/plugin-command-entry.ts') } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: {
      index: resolve(__dirname, 'electron/preload.ts'),
      'plugin-window-chrome': resolve(__dirname, 'electron/plugin-window-chrome-preload.ts'),
      'node-web-plugin': resolve(__dirname, 'electron/node-web-plugin-preload.ts'),
      translation: resolve(__dirname, 'electron/translation-preload.ts'),
    } } },
  },
  renderer: {
    root: resolve(__dirname),
    resolve: { alias: { '@': resolve(__dirname, 'src') } },
    plugins: [vue()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'index.html'), translation: resolve(__dirname, 'translation.html'), 'plugin-window': resolve(__dirname, 'plugin-window.html'), 'plugin-window-menu': resolve(__dirname, 'plugin-window-menu.html') } } },
  },
})
