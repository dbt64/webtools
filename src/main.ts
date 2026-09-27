import { createApp } from 'vue'
import App from './App.vue'
import { applyTheme } from './shared/theme'
import type { ThemePreference } from './shared/domain'
import './styles/tokens.css'

async function startManager(): Promise<void> {
  let theme: ThemePreference = 'dark'
  try {
    theme = await window.desktop.getThemePreference()
  } catch {
    // Keep the default palette if settings cannot be read during startup.
  }
  applyTheme(theme)
  createApp(App).mount('#app')
}

void startManager()
