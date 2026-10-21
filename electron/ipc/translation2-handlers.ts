import { TRANSLATION2_WEBSITE_PROVIDERS, type Translation2TabSelection } from '../../src/shared/translation2-contracts.ts'
import { TRANSLATION2_IPC_CHANNELS, type Translation2Bootstrap } from '../../src/shared/translation2-ipc.ts'
import type { IpcResult } from '../../src/shared/ipc.ts'
import type { ThemePreference } from '../../src/shared/domain.ts'
import type { TranslationLanguageCode, TranslationRequest, TranslationSourceLanguage } from '../../src/shared/translation-contracts.ts'
import type { Translation2SettingsService } from '../services/translation2-settings.ts'
import type { TranslationService } from '../services/translation-service.ts'
import { validateTranslationRequest } from '../services/translation-service.ts'
import { resolveTranslation2ExecutionTarget } from '../services/translation2-target.ts'
import type { SharedAIService } from '../services/shared-ai-service.ts'
import type { BuiltinTranslationWindow } from '../plugins/builtin-translation-window.ts'
import type { IpcSenderContext } from './window-security.ts'
import type { Translation2ImportedServiceManager } from '../services/translation2-imported-services.ts'
import type { Translation2WebsiteBounds, Translation2WebsiteHost } from '../plugins/translation2-website-host.ts'
import { isAIProviderId, safeAIModel } from '../../src/shared/ai-config.ts'
import type { Translation2AIConfiguration } from '../services/translation2-ai-configuration.ts'
import { traceWindowStartup } from '../services/window-startup.ts'

type Handler = (event: IpcSenderContext, ...args: unknown[]) => Promise<IpcResult<unknown>> | IpcResult<unknown>

interface Registry {
  handle(channel: string, handler: Handler): void
  removeHandler(channel: string): void
}

interface Dependencies {
  isTranslationMainFrame(event: IpcSenderContext): boolean
  window: Pick<BuiltinTranslationWindow, 'snapshot' | 'close' | 'isPinned' | 'setPinned' | 'minimize'>
  settings: Pick<Translation2SettingsService, 'get' | 'update' | 'restoreDefaults'>
  translation: Pick<TranslationService, 'translateWithTarget' | 'cancel'>
  sharedAI: Pick<SharedAIService, 'getProviderDescriptors' | 'getProviderInfo'>
  importedServices: Pick<Translation2ImportedServiceManager, 'credentialStatus' | 'testDraft' | 'save' | 'update' | 'test' | 'delete'> & Partial<Pick<Translation2ImportedServiceManager, 'saveDeepL' | 'testDeepLDraft'>>
  websites: Pick<Translation2WebsiteHost, 'select' | 'setBounds'>
  languageDefaults(): { sourceLanguage: TranslationSourceLanguage; targetLanguage: TranslationLanguageCode }
  theme(): ThemePreference
  aiConfiguration?: Pick<Translation2AIConfiguration, 'get' | 'save' | 'test'>
}

function fail<T>(code: string, message: string): IpcResult<T> { return { ok: false, error: { code, message } } }

function errorResult(error: unknown, fallbackCode: string, fallbackMessage: string): IpcResult<never> {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : fallbackCode
  const message = error instanceof Error && error.message ? error.message : fallbackMessage
  return fail(code, message)
}

function validTabSelection(value: unknown): value is Translation2TabSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  if (input.kind === 'webtools') return Object.keys(input).length === 1
  return input.kind === 'website' && Object.keys(input).length === 2 && typeof input.providerId === 'string'
}

function validLanguage(value: unknown, allowAuto: boolean): value is TranslationSourceLanguage | TranslationLanguageCode {
  return typeof value === 'string' && (allowAuto && value === 'auto' || ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru'].includes(value))
}

export function createTranslation2Handlers(deps: Dependencies): { handlers: Record<string, Handler> } {
  const authorized = (action: Handler): Handler => async (event, ...args) => {
    if (!deps.isTranslationMainFrame(event)) return fail('UNAUTHORIZED', '当前窗口无权执行此操作。')
    return action(event, ...args)
  }
  const handlers: Record<string, Handler> = {
    [TRANSLATION2_IPC_CHANNELS.saveDeepL]: authorized(async (_event, value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['name', 'secret', 'apiPlan'].includes(key)) || !deps.importedServices.saveDeepL) return fail('INVALID_SERVICE', 'DeepL 配置无效。')
      try { return { ok: true, data: await deps.importedServices.saveDeepL(value as Parameters<Translation2ImportedServiceManager['saveDeepL']>[0]) } }
      catch { return fail('SERVICE_SAVE_FAILED', '无法保存 DeepL 服务，请检查名称、API 类型和密钥。') }
    }),
    [TRANSLATION2_IPC_CHANNELS.testDeepL]: authorized(async (_event, value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['secret', 'apiPlan'].includes(key)) || !deps.importedServices.testDeepLDraft) return fail('INVALID_SERVICE', 'DeepL 配置无效。')
      try { return { ok: true, data: await deps.importedServices.testDeepLDraft(value as Parameters<Translation2ImportedServiceManager['testDeepLDraft']>[0]) } }
      catch { return fail('SERVICE_TEST_FAILED', 'DeepL 连接失败，请检查 API Free/Pro、API Key 和网络。') }
    }),
    [TRANSLATION2_IPC_CHANNELS.getAIConfiguration]: authorized(async (_event, id) => {
      if (!isAIProviderId(id) || !deps.aiConfiguration) return fail('INVALID_AI_SETTINGS', 'AI 提供方无效。')
      try { return { ok: true, data: await deps.aiConfiguration.get(id) } }
      catch { return fail('AI_SETTINGS_FAILED', '无法读取 AI 配置。') }
    }),
    [TRANSLATION2_IPC_CHANNELS.saveAIConfiguration]: authorized(async (_event, value) => {
      if (!value || typeof value !== 'object' || !deps.aiConfiguration) return fail('INVALID_AI_SETTINGS', 'AI 配置无效。')
      try { return { ok: true, data: await deps.aiConfiguration.save(value as Parameters<Translation2AIConfiguration['save']>[0]) } }
      catch { return fail('AI_SETTINGS_FAILED', '保存失败。请检查模型 ID、地址与 API Key；密钥必须填在独立的 API Key 输入框。') }
    }),
    [TRANSLATION2_IPC_CHANNELS.testAIConnection]: authorized(async (_event, id) => {
      if (!isAIProviderId(id) || !deps.aiConfiguration) return fail('INVALID_AI_SETTINGS', 'AI 提供方无效。')
      try { return { ok: true, data: await deps.aiConfiguration.test(id) } }
      catch { return fail('AI_CONNECTION_FAILED', '连接失败。请检查 API Key、模型 ID、服务地址和网络；没有切换到其他服务。') }
    }),
    [TRANSLATION2_IPC_CHANNELS.bootstrap]: authorized(async (): Promise<IpcResult<Translation2Bootstrap>> => {
      traceWindowStartup('translation-bootstrap-started')
      try {
        const descriptors = deps.sharedAI.getProviderDescriptors()
        const aiProviders = await Promise.all(descriptors.map(async descriptor => {
          const info = await deps.sharedAI.getProviderInfo(descriptor.id)
          return { id: descriptor.id, name: descriptor.name, model: safeAIModel(info.model), configured: info.configured }
        }))
        const machineConfigured = await deps.importedServices.credentialStatus()
        traceWindowStartup('translation-bootstrap-ready')
        return { ok: true, data: {
          open: deps.window.snapshot(),
          pinned: deps.window.isPinned(),
          settings: deps.settings.get(),
          websites: TRANSLATION2_WEBSITE_PROVIDERS.map(provider => ({ ...provider })),
          aiProviders,
          languageDefaults: deps.languageDefaults(),
          theme: deps.theme(),
          machineConfigured,
        } }
      } catch (error) {
        traceWindowStartup('translation-bootstrap-failed')
        return errorResult(error, 'TRANSLATION2_BOOTSTRAP_FAILED', '无法载入 Translation 2.0。')
      }
    }),
    [TRANSLATION2_IPC_CHANNELS.updateSettings]: authorized(async (_event, value) => {
      try { return { ok: true, data: await deps.settings.update(value) } }
      catch (error) { return errorResult(error, 'INVALID_TRANSLATION2_SETTINGS', 'Translation 2.0 设置无效。') }
    }),
    [TRANSLATION2_IPC_CHANNELS.restoreDefaults]: authorized(async () => {
      try {
        const open = deps.window.snapshot()
        const languages = deps.languageDefaults()
        await deps.websites.select(null, open.sourceText ?? '', languages.sourceLanguage, languages.targetLanguage, open.generation)
        return { ok: true, data: await deps.settings.restoreDefaults() }
      }
      catch (error) { return errorResult(error, 'TRANSLATION2_SETTINGS_FAILED', '无法恢复 Translation 2.0 默认设置。') }
    }),
    [TRANSLATION2_IPC_CHANNELS.translate]: authorized(async (_event, value) => {
      if (!validateTranslationRequest(value)) return fail('INVALID_TRANSLATION', '翻译输入无效。')
      const selected = resolveTranslation2ExecutionTarget(deps.settings.get())
      if (!selected) return fail('TRANSLATION_SERVICE_UNAVAILABLE', '所选翻译服务当前不可用。')
      try { return { ok: true, data: await deps.translation.translateWithTarget(value as TranslationRequest, selected) } }
      catch (error) { return errorResult(error, 'TRANSLATION_FAILED', '翻译失败，请稍后重试。') }
    }),
    [TRANSLATION2_IPC_CHANNELS.cancel]: authorized(async (_event, requestId) => {
      if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{8,64}$/.test(requestId)) return fail('INVALID_REQUEST', '翻译请求标识无效。')
      return { ok: true, data: { cancelled: deps.translation.cancel(requestId) } }
    }),
    [TRANSLATION2_IPC_CHANNELS.testImportedDraft]: authorized(async (_event, value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('INVALID_IMPORTED_SERVICE', '导入的翻译服务无效。')
      const input = value as Record<string, unknown>
      if (Object.keys(input).some(key => !['definition', 'secret'].includes(key)) || typeof input.secret !== 'string') return fail('INVALID_IMPORTED_SERVICE', '导入的翻译服务无效。')
      try { return { ok: true, data: await deps.importedServices.testDraft({ definition: input.definition, secret: input.secret }) } }
      catch (error) { return errorResult(error, 'IMPORTED_SERVICE_TEST_FAILED', '翻译服务测试失败。') }
    }),
    [TRANSLATION2_IPC_CHANNELS.saveImported]: authorized(async (_event, value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('INVALID_IMPORTED_SERVICE', '导入的翻译服务无效。')
      const input = value as Record<string, unknown>
      if (Object.keys(input).some(key => !['definition', 'name', 'secret'].includes(key)) || typeof input.name !== 'string' || typeof input.secret !== 'string') return fail('INVALID_IMPORTED_SERVICE', '导入的翻译服务无效。')
      try { return { ok: true, data: await deps.importedServices.save({ definition: input.definition, name: input.name, secret: input.secret }) } }
      catch (error) { return errorResult(error, 'IMPORTED_SERVICE_SAVE_FAILED', '无法保存翻译服务。') }
    }),
    [TRANSLATION2_IPC_CHANNELS.updateImported]: authorized(async (_event, instanceId, value) => {
      if (typeof instanceId !== 'string' || !/^imported-[a-z0-9-]{8,64}$/i.test(instanceId)
        || !value || typeof value !== 'object' || Array.isArray(value)) return fail('INVALID_IMPORTED_SERVICE', '导入的翻译服务无效。')
      const input = value as Record<string, unknown>
      if (Object.keys(input).some(key => !['name', 'enabled', 'secret'].includes(key))) return fail('INVALID_IMPORTED_SERVICE', '导入的翻译服务无效。')
      try { return { ok: true, data: await deps.importedServices.update(instanceId, input) } }
      catch (error) { return errorResult(error, 'IMPORTED_SERVICE_UPDATE_FAILED', '无法更新翻译服务。') }
    }),
    [TRANSLATION2_IPC_CHANNELS.testImported]: authorized(async (_event, instanceId) => {
      if (typeof instanceId !== 'string' || !/^imported-[a-z0-9-]{8,64}$/i.test(instanceId)) return fail('INVALID_IMPORTED_SERVICE', '导入的翻译服务无效。')
      try { return { ok: true, data: await deps.importedServices.test(instanceId) } }
      catch (error) { return errorResult(error, 'IMPORTED_SERVICE_TEST_FAILED', '翻译服务测试失败。') }
    }),
    [TRANSLATION2_IPC_CHANNELS.deleteImported]: authorized(async (_event, instanceId) => {
      if (typeof instanceId !== 'string' || !/^imported-[a-z0-9-]{8,64}$/i.test(instanceId)) return fail('INVALID_IMPORTED_SERVICE', '导入的翻译服务无效。')
      try { return { ok: true, data: await deps.importedServices.delete(instanceId) } }
      catch (error) { return errorResult(error, 'IMPORTED_SERVICE_DELETE_FAILED', '无法删除翻译服务。') }
    }),
    [TRANSLATION2_IPC_CHANNELS.selectTab]: authorized(async (_event, value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('INVALID_TRANSLATION_TAB', '翻译标签无效。')
      const input = value as Record<string, unknown>
      if (Object.keys(input).some(key => !['tab', 'sourceText', 'sourceLanguage', 'targetLanguage', 'openGeneration'].includes(key))
        || !validTabSelection(input.tab) || typeof input.sourceText !== 'string' || input.sourceText.length > 20_000
        || !validLanguage(input.sourceLanguage, true) || !validLanguage(input.targetLanguage, false)
        || !Number.isSafeInteger(input.openGeneration) || (input.openGeneration as number) < 0) return fail('INVALID_TRANSLATION_TAB', '翻译标签无效。')
      const open = deps.window.snapshot()
      if (input.openGeneration !== open.generation) return fail('STALE_TRANSLATION_TAB', '翻译窗口状态已更新，请重试。')
      const current = deps.settings.get()
      const tab = input.tab
      if (tab.kind === 'website') {
        const provider = TRANSLATION2_WEBSITE_PROVIDERS.find(item => item.id === tab.providerId)
        if (!provider || !current.visibleWebsiteIds.includes(tab.providerId)) {
          return fail('TRANSLATION_WEBSITE_UNAVAILABLE', '该网站翻译未启用。')
        }
      }
      try {
        const selected = await deps.websites.select(tab.kind === 'website' ? tab.providerId : null, input.sourceText,
          input.sourceLanguage as TranslationSourceLanguage, input.targetLanguage as TranslationLanguageCode, input.openGeneration as number)
        const next = deps.settings.get()
        next.activeTab = tab
        return { ok: true, data: { settings: await deps.settings.update(next), sourceText: selected.sourceText, sourceSynchronized: selected.sourceSynchronized } }
      } catch (error) { return errorResult(error, 'TRANSLATION_WEBSITE_FAILED', '无法打开网站翻译。') }
    }),
    [TRANSLATION2_IPC_CHANNELS.setWebsiteBounds]: authorized(async (_event, value) => {
      try {
        deps.websites.setBounds(value as Translation2WebsiteBounds)
        return { ok: true, data: undefined }
      } catch (error) { return errorResult(error, 'INVALID_TRANSLATION_WEBSITE_BOUNDS', '网站翻译区域无效。') }
    }),
    [TRANSLATION2_IPC_CHANNELS.close]: authorized(async () => {
      await deps.window.close()
      return { ok: true, data: undefined }
    }),
    [TRANSLATION2_IPC_CHANNELS.minimize]: authorized(async (_event, ...args) => {
      if (args.length !== 0) return fail('INVALID_WINDOW_CONTROL', '最小化操作不接受参数。')
      deps.window.minimize()
      return { ok: true, data: undefined }
    }),
    [TRANSLATION2_IPC_CHANNELS.setPinned]: authorized(async (_event, ...args) => {
      if (args.length !== 1 || typeof args[0] !== 'boolean') return fail('INVALID_WINDOW_CONTROL', '置顶状态无效。')
      return { ok: true, data: deps.window.setPinned(args[0]) }
    }),
  }
  return { handlers }
}

export function registerTranslation2Handlers(ipc: Registry, deps: Dependencies): () => void {
  const { handlers } = createTranslation2Handlers(deps)
  for (const [channel, handler] of Object.entries(handlers)) ipc.handle(channel, handler)
  return () => { for (const channel of Object.keys(handlers)) ipc.removeHandler(channel) }
}
