import { ipcMain, type WebContents } from 'electron'
import { IPC_CHANNELS, type IpcResult } from '../../src/shared/ipc'
import type { IpcSenderContext } from './window-security'

export function registerWindowIpcHandlers(deps: {
  showLauncher: () => void
  hideLauncher: () => void
  setLauncherExpanded: (sender: WebContents, expanded: boolean, expandedSectionExtraHeight: number, hasSearchResults: boolean, generation: number) => void
  moveLauncherBy: (sender: WebContents, deltaX: number, deltaY: number) => void
  markLauncherRendererReady: (sender: WebContents) => void
  acknowledgeLauncherVisibility: (sender: WebContents, generation: unknown) => void
  showManager: () => void
  openTranslation: (context: IpcSenderContext, text: unknown) => IpcResult<void>
  markManagerRendererReady: (sender: WebContents) => void
  acknowledgeTranslationPrefill: (sender: WebContents, id: unknown) => void
  acknowledgeNativeManagerIntent: (context: IpcSenderContext, requestId: unknown) => void
}): void {
  ipcMain.handle('window:show-launcher', () => deps.showLauncher())
  ipcMain.handle('window:hide-launcher', () => deps.hideLauncher())
  ipcMain.on('window:launcher-ready', (event) => deps.markLauncherRendererReady(event.sender))
  ipcMain.on(IPC_CHANNELS.acknowledgeLauncherVisibility, (event, generation: unknown) => deps.acknowledgeLauncherVisibility(event.sender, generation))
  ipcMain.handle(IPC_CHANNELS.openTranslation, (event, text: unknown) => deps.openTranslation(event, text))
  ipcMain.on(IPC_CHANNELS.managerReady, (event) => deps.markManagerRendererReady(event.sender))
  ipcMain.on(IPC_CHANNELS.acknowledgeTranslationPrefill, (event, id: unknown) => deps.acknowledgeTranslationPrefill(event.sender, id))
  ipcMain.on(IPC_CHANNELS.acknowledgeNativeManagerIntent, (event, requestId: unknown) => deps.acknowledgeNativeManagerIntent(event, requestId))
  ipcMain.handle('window:set-launcher-expanded', (event, expanded: unknown, expandedSectionExtraHeight: unknown, hasSearchResults: unknown, generation: unknown) => {
    if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 1) return
    const sectionExtraHeight = typeof expandedSectionExtraHeight === 'number' && Number.isInteger(expandedSectionExtraHeight)
      ? Math.max(0, Math.min(300, expandedSectionExtraHeight))
      : 0
    deps.setLauncherExpanded(event.sender, expanded === true, sectionExtraHeight, hasSearchResults === true, generation)
  })
  ipcMain.on('window:move-launcher-by', (event, deltaX: unknown, deltaY: unknown) => {
    if (typeof deltaX !== 'number' || !Number.isFinite(deltaX) || typeof deltaY !== 'number' || !Number.isFinite(deltaY)) return
    deps.moveLauncherBy(event.sender, deltaX, deltaY)
  })
  ipcMain.handle('window:show-manager', () => deps.showManager())
}
