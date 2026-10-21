import type { DesktopApi } from '../shared/ipc'
import type { Translation2Api } from '../shared/translation2-ipc'
import type { PluginWindowChromeApi } from '../../electron/plugins/plugin-window-chrome-contract.ts'

declare global {
  interface Window {
    desktop: DesktopApi
    translation2: Translation2Api
    pluginWindowChrome: PluginWindowChromeApi
  }
}

export {}
