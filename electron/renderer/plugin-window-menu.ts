import type { PluginWindowAction, PluginWindowChromeState } from '../plugins/plugin-window-chrome-contract.ts'

const menu = document.querySelector<HTMLElement>('#plugin-window-menu')!
const status = document.querySelector<HTMLElement>('#plugin-window-status')!
const removeStateListener = window.pluginWindowChrome.onState(applyState)

function applyState(state: PluginWindowChromeState): void {
  document.documentElement.dataset.theme = /--webtools-color-scheme:\s*dark/.test(state.themeCss) ? 'dark' : 'light'
  let style = document.querySelector<HTMLStyleElement>('#plugin-window-theme')
  if (!style) { style = document.createElement('style'); style.id = 'plugin-window-theme'; document.head.append(style) }
  style.textContent = state.themeCss
  menu.querySelector<HTMLElement>('[data-action="detach"]')!.hidden = state.mode === 'detached'
  menu.querySelector<HTMLElement>('.detached-only')!.hidden = state.mode !== 'detached'
}

async function perform(action: PluginWindowAction): Promise<void> {
  status.hidden = true
  status.textContent = ''
  try {
    if (await window.pluginWindowChrome.perform(action)) return
  } catch { /* Keep the menu open and show the action failure in this Host view. */ }
  status.textContent = '操作未完成，请重试。'
  status.hidden = false
}

menu.addEventListener('click', event => {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action]') : null
  const action = target?.dataset.action as PluginWindowAction | undefined
  if (action) { event.preventDefault(); event.stopPropagation(); void perform(action) }
})

void window.pluginWindowChrome.getState().then(state => { if (state) applyState(state) })
window.addEventListener('beforeunload', removeStateListener, { once: true })
