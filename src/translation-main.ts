import { createApp } from 'vue'
import TranslationApp from './features/translation2/TranslationApp.vue'
import { applyTheme } from './shared/theme.ts'
import './styles/tokens.css'

async function start(): Promise<void> {
  const bootstrap = await window.translation2.bootstrap()
  if (bootstrap.ok) applyTheme(bootstrap.data.theme)
  createApp(TranslationApp, { initialBootstrap: bootstrap.ok ? bootstrap.data : null }).mount('#app')
  document.documentElement.dataset.translationReady = 'true'
  document.dispatchEvent(new Event('webtools-translation-ready'))
}

void start()
