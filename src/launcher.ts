import { createApp } from 'vue'
import LauncherView from './features/search/LauncherView.vue'
import { applyTheme } from './shared/theme'
import type { ThemePreference } from './shared/domain'
import './styles/tokens.css'

document.documentElement.classList.add('launcher-mode')

async function startLauncher(): Promise<void> {
  let theme: ThemePreference = 'dark'
  try {
    theme = (await window.desktop.getSettings()).theme
  } catch {
    // Keep the default palette if settings cannot be read during startup.
  }
  applyTheme(theme)
  createApp(LauncherView).mount('#app')
}

void startLauncher()
