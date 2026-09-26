import type { ThemePreference } from './domain'

let activeMediaQuery: MediaQueryList | undefined
let activeChangeHandler: ((event: MediaQueryListEvent) => void) | undefined

function setResolvedTheme(theme: 'light' | 'dark'): void {
  const root = document.documentElement
  root.dataset.theme = theme
  root.style.colorScheme = theme
}

/** Apply a saved theme preference and track system changes only in system mode. */
export function applyTheme(theme: ThemePreference): void {
  if (activeMediaQuery && activeChangeHandler) {
    activeMediaQuery.removeEventListener('change', activeChangeHandler)
  }
  activeMediaQuery = undefined
  activeChangeHandler = undefined

  if (theme !== 'system') {
    setResolvedTheme(theme)
    return
  }

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  const applySystemTheme = (event: MediaQueryList | MediaQueryListEvent) => {
    setResolvedTheme(event.matches ? 'dark' : 'light')
  }
  activeMediaQuery = mediaQuery
  activeChangeHandler = applySystemTheme
  mediaQuery.addEventListener('change', applySystemTheme)
  applySystemTheme(mediaQuery)
}
