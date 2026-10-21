import type { AIProviderId, AIProviderConfig } from './ai-config.ts'
import type { IpcResult } from './ipc.ts'
import type { ThemePreference } from './domain.ts'
import type { TranslationRequest, TranslationResult, TranslationSourceLanguage, TranslationLanguageCode } from './translation-contracts.ts'
import type { Translation2OpenProjection } from '../../electron/plugins/builtin-translation-window.ts'
import type { Translation2TabSelection, Translation2WebsiteProviderDescriptor, Translation2WorkspaceSettings } from './translation2-contracts.ts'

export const TRANSLATION2_IPC_CHANNELS = {
  bootstrap: 'translation2:bootstrap',
  getAIConfiguration: 'translation2:ai-get',
  saveAIConfiguration: 'translation2:ai-save',
  testAIConnection: 'translation2:ai-test',
  saveDeepL: 'translation2:deepl-save',
  testDeepL: 'translation2:deepl-test',
  updateSettings: 'translation2:settings-update',
  restoreDefaults: 'translation2:settings-restore-defaults',
  translate: 'translation2:translate',
  cancel: 'translation2:cancel',
  testImportedDraft: 'translation2:imported-test-draft',
  saveImported: 'translation2:imported-save',
  updateImported: 'translation2:imported-update',
  testImported: 'translation2:imported-test',
  deleteImported: 'translation2:imported-delete',
  selectTab: 'translation2:tab-select',
  setWebsiteBounds: 'translation2:website-bounds',
  close: 'translation2:close',
  minimize: 'translation2:minimize',
  setPinned: 'translation2:set-pinned',
  opened: 'translation2:opened',
  websiteState: 'translation2:website-state',
} as const

export interface Translation2AIProviderProjection {
  id: AIProviderId
  name: string
  model: string
  configured: boolean
}

export interface Translation2Bootstrap {
  pinned: boolean
  open: Translation2OpenProjection
  settings: Translation2WorkspaceSettings
  websites: Translation2WebsiteProviderDescriptor[]
  aiProviders: Translation2AIProviderProjection[]
  languageDefaults: { sourceLanguage: TranslationSourceLanguage; targetLanguage: TranslationLanguageCode }
  theme: ThemePreference
  machineConfigured: Record<string, boolean>
}

export interface Translation2Api {
  onWebsiteState(handler: (state: { providerId: string; phase: 'loading' | 'ready' | 'error'; message: string }) => void): () => void
  getAIConfiguration(providerId: AIProviderId): Promise<IpcResult<{ providerId: AIProviderId; name: string; defaultModel: string; config: AIProviderConfig; hasApiKey: boolean; configured: boolean }>>
  saveAIConfiguration(input: { providerId: AIProviderId; config: AIProviderConfig; secret?: string }): Promise<IpcResult<unknown>>
  testAIConnection(providerId: AIProviderId): Promise<IpcResult<{ connected: true }>>
  saveDeepL(input: { name: string; secret: string; apiPlan: 'free' | 'pro' }): Promise<IpcResult<Translation2WorkspaceSettings>>
  testDeepL(input: { secret: string; apiPlan: 'free' | 'pro' }): Promise<IpcResult<{ translation: string }>>
  bootstrap(): Promise<IpcResult<Translation2Bootstrap>>
  updateSettings(settings: Translation2WorkspaceSettings): Promise<IpcResult<Translation2WorkspaceSettings>>
  restoreDefaults(): Promise<IpcResult<Translation2WorkspaceSettings>>
  translate(request: TranslationRequest): Promise<IpcResult<TranslationResult>>
  cancel(requestId: string): Promise<IpcResult<{ cancelled: boolean }>>
  testImportedDraft(input: { definition: unknown; secret: string }): Promise<IpcResult<{ translation: string }>>
  saveImported(input: { definition: unknown; name: string; secret: string }): Promise<IpcResult<Translation2WorkspaceSettings>>
  updateImported(instanceId: string, input: { name?: string; enabled?: boolean; secret?: string }): Promise<IpcResult<Translation2WorkspaceSettings>>
  testImported(instanceId: string): Promise<IpcResult<{ translation: string; settings: Translation2WorkspaceSettings }>>
  deleteImported(instanceId: string): Promise<IpcResult<Translation2WorkspaceSettings>>
  selectTab(input: { tab: Translation2TabSelection; sourceText: string; sourceLanguage: TranslationSourceLanguage; targetLanguage: TranslationLanguageCode; openGeneration: number }): Promise<IpcResult<{ settings: Translation2WorkspaceSettings; sourceText: string; sourceSynchronized: boolean }>>
  setWebsiteBounds(bounds: { x: number; y: number; width: number; height: number }): Promise<IpcResult<void>>
  close(): Promise<IpcResult<void>>
  minimize(): Promise<IpcResult<void>>
  setPinned(pinned: boolean): Promise<IpcResult<{ pinned: boolean }>>
  onOpened(handler: (projection: Translation2OpenProjection) => void): () => void
}
