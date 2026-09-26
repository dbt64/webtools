import { ipcMain, type WebContents } from 'electron'

export function registerWindowIpcHandlers(deps: {
  showLauncher: () => void
  hideLauncher: () => void
  setLauncherExpanded: (expanded: boolean, expandedSections: number, hasSearchResults: boolean) => void
  moveLauncherBy: (sender: WebContents, deltaX: number, deltaY: number) => void
  markLauncherRendererReady: (sender: WebContents) => void
  showManager: () => void
}): void {
  ipcMain.handle('window:show-launcher', () => deps.showLauncher())
  ipcMain.handle('window:hide-launcher', () => deps.hideLauncher())
  ipcMain.on('window:launcher-ready', (event) => deps.markLauncherRendererReady(event.sender))
  ipcMain.handle('window:set-launcher-expanded', (_event, expanded: unknown, expandedSections: unknown, hasSearchResults: unknown) => {
    const sectionCount = typeof expandedSections === 'number' && Number.isInteger(expandedSections)
      ? Math.max(0, Math.min(2, expandedSections))
      : 0
    deps.setLauncherExpanded(expanded === true, sectionCount, hasSearchResults === true)
  })
  ipcMain.on('window:move-launcher-by', (event, deltaX: unknown, deltaY: unknown) => {
    if (typeof deltaX !== 'number' || !Number.isFinite(deltaX) || typeof deltaY !== 'number' || !Number.isFinite(deltaY)) return
    deps.moveLauncherBy(event.sender, deltaX, deltaY)
  })
  ipcMain.handle('window:show-manager', () => deps.showManager())
}
