import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { LauncherDataService } from '../services/launcher-data'
import type { LauncherDataVersions } from '../../src/shared/domain'
import { IPC_CHANNELS } from '../../src/shared/ipc'

function isVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= -1
}

function isVersions(value: unknown): value is LauncherDataVersions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const versions = value as Record<string, unknown>
  return isVersion(versions.apps) && isVersion(versions.websites)
}

export function registerLauncherDataIpcHandlers(deps: {
  launcherData: LauncherDataService
  isLauncherMainFrame: (event: IpcMainInvokeEvent) => boolean
}): void {
  ipcMain.handle(IPC_CHANNELS.getLauncherData, (event, knownVersions: unknown) => {
    if (!deps.isLauncherMainFrame(event)) throw new Error('当前窗口无权读取启动器数据。')
    if (!isVersions(knownVersions)) throw new Error('启动器数据版本无效。')
    return deps.launcherData.getChanges(knownVersions)
  })

  ipcMain.handle(IPC_CHANNELS.getWebsiteIcons, (event, rawIds: unknown): Record<string, string | null> => {
    if (!deps.isLauncherMainFrame(event)) throw new Error('当前窗口无权读取网站图标。')
    if (!Array.isArray(rawIds) || rawIds.length > 64 || !rawIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 128)) {
      throw new Error('网站图标请求无效。')
    }
    const ids = [...new Set(rawIds as string[])]
    return deps.launcherData.getWebsiteIcons(ids)
  })
}
