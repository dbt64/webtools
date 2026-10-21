import { contextBridge, ipcRenderer } from 'electron'
import { TRANSLATION2_IPC_CHANNELS, type Translation2Api } from '../src/shared/translation2-ipc.ts'
import type { Translation2OpenProjection } from './plugins/builtin-translation-window.ts'

function parseOpenProjection(value: unknown): Translation2OpenProjection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const projection = value as Record<string, unknown>
  if (typeof projection.generation !== 'number' || !Number.isSafeInteger(projection.generation) || projection.generation < 0) return null
  if (projection.sourceText !== null && typeof projection.sourceText !== 'string') return null
  if (typeof projection.sourceText === 'string' && projection.sourceText.length > 20_000) return null
  return { generation: projection.generation, sourceText: projection.sourceText as string | null }
}

const translation2Api: Translation2Api = {
  onWebsiteState: handler => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (!value || typeof value !== 'object') return
      const state = value as Record<string, unknown>
      if (typeof state.providerId === 'string' && ['loading', 'ready', 'error'].includes(String(state.phase)) && typeof state.message === 'string') handler(state as Parameters<typeof handler>[0])
    }
    ipcRenderer.on(TRANSLATION2_IPC_CHANNELS.websiteState, listener)
    return () => ipcRenderer.removeListener(TRANSLATION2_IPC_CHANNELS.websiteState, listener)
  },
  getAIConfiguration: id => ipcRenderer.invoke(TRANSLATION2_IPC_CHANNELS.getAIConfiguration, id),
  saveAIConfiguration: input => ipcRenderer.invoke(TRANSLATION2_IPC_CHANNELS.saveAIConfiguration, input),
  testAIConnection: id => ipcRenderer.invoke(TRANSLATION2_IPC_CHANNELS.testAIConnection, id),
  saveDeepL: input => ipcRenderer.invoke(TRANSLATION2_IPC_CHANNELS.saveDeepL, input),
  testDeepL: input => ipcRenderer.invoke(TRANSLATION2_IPC_CHANNELS.testDeepL, input),
  bootstrap: () => ipcRenderer.invoke(TRANSLATION2_IPC_CHANNELS.bootstrap),
  updateSettings: settings => ipcRenderer.invoke(TRANSLATION2_IPC_CHANNELS.updateSettings, settings),
  restoreDefaults: () => ipcRenderer.invoke(TRANSLATION2_IPC_CHANNELS.restoreDefaults),
  translate: request => ipcRenderer.invoke(TRANSLATION2_IPC_CHANNELS.translate, request),
  cancel: requestId => ipcRenderer.invoke(TRANSLATION2_IPC_CHANNELS.cancel, requestId),
  testImportedDraft: input => ipcRenderer.invoke(TRANSLATION2_IPC_CHANNELS.testImportedDraft, input),
  saveImported: input => ipcRenderer.invoke(TRANSLATION2_IPC_CHANNELS.saveImported, input),
  updateImported: (instanceId, input) => ipcRenderer.invoke(TRANSLATION2_IPC_CHANNELS.updateImported, instanceId, input),
  testImported: instanceId => ipcRenderer.invoke(TRANSLATION2_IPC_CHANNELS.testImported, instanceId),
  deleteImported: instanceId => ipcRenderer.invoke(TRANSLATION2_IPC_CHANNELS.deleteImported, instanceId),
  selectTab: input => ipcRenderer.invoke(TRANSLATION2_IPC_CHANNELS.selectTab, input),
  setWebsiteBounds: bounds => ipcRenderer.invoke(TRANSLATION2_IPC_CHANNELS.setWebsiteBounds, bounds),
  close: () => ipcRenderer.invoke(TRANSLATION2_IPC_CHANNELS.close),
  minimize: () => ipcRenderer.invoke(TRANSLATION2_IPC_CHANNELS.minimize),
  setPinned: pinned => ipcRenderer.invoke(TRANSLATION2_IPC_CHANNELS.setPinned, pinned),
  onOpened: handler => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const projection = parseOpenProjection(value)
      if (projection) handler(projection)
    }
    ipcRenderer.on(TRANSLATION2_IPC_CHANNELS.opened, listener)
    return () => ipcRenderer.removeListener(TRANSLATION2_IPC_CHANNELS.opened, listener)
  },
}

contextBridge.exposeInMainWorld('translation2', translation2Api)
