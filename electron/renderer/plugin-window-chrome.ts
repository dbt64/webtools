import type { PluginWindowAction, PluginWindowChromeState } from '../plugins/plugin-window-chrome-contract.ts'

const titlebar = document.querySelector<HTMLElement>('#plugin-window-titlebar')!
const title = document.querySelector<HTMLElement>('#plugin-window-title')!
const icon = document.querySelector<HTMLImageElement>('#plugin-window-icon')!
const rightIcon = document.querySelector<HTMLImageElement>('#plugin-window-right-icon')!
const loadingIcon = document.querySelector<HTMLImageElement>('#plugin-window-loading-icon')!
const loadingState = document.querySelector<HTMLElement>('#plugin-window-loading')!
const root = document.querySelector<HTMLElement>('#plugin-window-root')!
const maximizeButton = document.querySelector<HTMLButtonElement>('.maximize-button')!
const maximizeIcon = maximizeButton.querySelector<SVGElement>('.maximize-icon')!
const restoreIcon = maximizeButton.querySelector<SVGElement>('.restore-icon')!
const removeStateListener = window.pluginWindowChrome.onState(applyState)

function applyState(state: PluginWindowChromeState): void {
  title.textContent = state.title
  icon.src = state.iconDataUrl
  icon.hidden = !state.iconDataUrl
  rightIcon.src = state.iconDataUrl
  rightIcon.hidden = state.mode !== 'attached' || !state.iconDataUrl
  loadingIcon.src = state.iconDataUrl
  loadingIcon.hidden = !state.iconDataUrl
  loadingState.hidden = !state.loading
  root.dataset.mode = state.mode
  root.dataset.loading = String(state.loading)
  root.dataset.pinned = String(state.alwaysOnTop)
  root.dataset.maximized = String(state.maximized)
  root.dataset.theme = /--webtools-color-scheme:\s*dark/.test(state.themeCss) ? 'dark' : 'light'
  document.querySelector<HTMLButtonElement>('.menu-trigger')!.textContent = state.mode === 'attached' ? '⋮' : '☰'
  let style = document.querySelector<HTMLStyleElement>('#plugin-window-theme')
  if (!style) { style = document.createElement('style'); style.id = 'plugin-window-theme'; document.head.append(style) }
  style.textContent = state.themeCss
  document.querySelectorAll<HTMLElement>('.detached-only').forEach(element => { element.hidden = state.mode !== 'detached' })
  document.querySelector<HTMLElement>('.attached-close')!.hidden = state.mode === 'detached'
  const pinButton = document.querySelector<HTMLButtonElement>('.pin-button')!
  pinButton.setAttribute('aria-label', state.alwaysOnTop ? '取消置顶' : '置顶')
  pinButton.title = state.alwaysOnTop ? '取消置顶' : '置顶'
  pinButton.setAttribute('aria-pressed', String(state.alwaysOnTop))
  const activeMaximizeIcon = state.maximized ? restoreIcon : maximizeIcon
  activeMaximizeIcon.removeAttribute('hidden')
  maximizeButton.replaceChildren(activeMaximizeIcon)
  maximizeButton.setAttribute('aria-label', state.maximized ? '还原' : '最大化')
  maximizeButton.title = state.maximized ? '还原' : '最大化'
}

async function perform(action: PluginWindowAction): Promise<void> {
  await window.pluginWindowChrome.perform(action).catch(() => false)
}

titlebar.addEventListener('click', event => {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action]') : null
  const action = target?.dataset.action as PluginWindowAction | undefined
  if (action) { event.preventDefault(); event.stopPropagation(); void perform(action); return }
  if (event.target instanceof Element && event.target.closest('.menu-trigger')) {
    event.preventDefault(); event.stopPropagation(); void perform('toggle-menu')
    return
  }
})

document.addEventListener('pointerdown', event => {
  if (event.target instanceof Element && event.target.closest('#plugin-window-titlebar')
    && !event.target.closest('.menu-trigger') && !event.target.closest('[data-action]')) void perform('close-menu')
})

void window.pluginWindowChrome.getState().then(state => { if (state) applyState(state) })
window.addEventListener('beforeunload', removeStateListener, { once: true })
