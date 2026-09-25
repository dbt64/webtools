import { createApp } from 'vue'
import LauncherView from './features/search/LauncherView.vue'
import './styles/tokens.css'

document.documentElement.classList.add('launcher-mode')
createApp(LauncherView).mount('#app')
