export const PLUGIN_WINDOW_CHROME_CHANNELS = {
  getState: 'plugin-window-chrome:get-state',
  action: 'plugin-window-chrome:action',
  state: 'plugin-window-chrome:state',
} as const

export type PluginWindowMode = 'attached' | 'detached'

export type PluginWindowAction =
  | 'toggle-menu'
  | 'close-menu'
  | 'detach'
  | 'about'
  | 'settings'
  | 'exit-background'
  | 'end-run'
  | 'pin'
  | 'minimize'
  | 'toggle-maximize'
  | 'close'

export interface PluginWindowChromeState {
  title: string
  iconDataUrl: string
  mode: PluginWindowMode
  alwaysOnTop: boolean
  maximized: boolean
  loading: boolean
  themeCss: string
}

export interface PluginWindowChromeApi {
  getState(): Promise<PluginWindowChromeState | null>
  perform(action: PluginWindowAction): Promise<boolean>
  onState(handler: (state: PluginWindowChromeState) => void): () => void
}

declare global {
  interface Window { pluginWindowChrome: PluginWindowChromeApi }
}
