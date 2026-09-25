import type { DesktopApi } from '../../electron/preload'

declare global {
  interface Window {
    desktop: DesktopApi
  }
}

export {}
