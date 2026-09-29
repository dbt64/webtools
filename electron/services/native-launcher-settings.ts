import type { AppSettings, WebsiteEntry } from '../../src/shared/domain'
import type { NativeLauncherState } from './native-manager-client'

export function overlayNativeLauncherSettings(base: AppSettings, nativeState: NativeLauncherState): AppSettings {
  return {
    ...base,
    quickSearchShortcut: nativeState.quickSearchShortcut,
    theme: nativeState.theme,
    launcherDisplayMode: nativeState.launcherDisplayMode,
    launchOnStartup: nativeState.launchOnStartup,
    searchEngines: structuredClone(nativeState.searchEngines),
    defaultSearchEngineId: nativeState.defaultSearchEngineId,
    everythingEnabled: nativeState.everythingEnabled,
    everythingEsPath: nativeState.everythingEsPath,
  }
}

export function projectWebsitesForNative(entries: readonly WebsiteEntry[]) {
  return {
    websites: entries.map(({ id, name, url, description, folderIds }) => ({
      id,
      name,
      url,
      description: description ?? '',
      folderIds: [...folderIds],
    })),
  }
}
