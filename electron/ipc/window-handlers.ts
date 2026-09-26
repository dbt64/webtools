import { ipcMain } from 'electron'

export function registerWindowIpcHandlers(deps: {
  showLauncher: () => void
  hideLauncher: () => void
  setLauncherExpanded: (expanded: boolean) => void
  showManager: () => void
}): void {
  ipcMain.handle('window:show-launcher', () => deps.showLauncher())
  ipcMain.handle('window:hide-launcher', () => deps.hideLauncher())
  ipcMain.handle('window:set-launcher-expanded', (_event, expanded: unknown) => deps.setLauncherExpanded(expanded === true))
  ipcMain.handle('window:show-manager', () => deps.showManager())
}
