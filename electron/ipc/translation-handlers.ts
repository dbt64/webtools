import { isAIProviderId } from '../../src/shared/ai-config.ts'
import { isTranslationLanguage } from '../../src/shared/translation-contracts.ts'
import type { IpcResult } from '../../src/shared/ipc.ts'
import { buildGoogleTranslateUrl } from '../services/google-translate.ts'
import type { AIProviderCredentialStore } from '../services/ai-credentials.ts'
import type { SharedAIService } from '../services/shared-ai-service.ts'
import type { TranslationService } from '../services/translation-service.ts'
import { validateTranslationRequest } from '../services/translation-service.ts'
import { ServiceError } from '../services/service-error.ts'
import type { IpcSenderContext } from './window-security.ts'

const MAX_API_KEY_LENGTH = 4096
type TranslationHandler = (event: IpcSenderContext, ...args: unknown[]) => Promise<IpcResult<unknown>> | IpcResult<unknown>

function fail<T>(code: string, message: string): IpcResult<T> { return { ok: false, error: { code, message } } }
function providerError(error: unknown, fallbackCode: string, fallbackMessage: string): { code: string; message: string } {
  if (error instanceof ServiceError) return { code: error.code, message: error.message }
  if (error instanceof Error && error.name === 'TimeoutError') return { code: `${fallbackCode}_TIMEOUT`, message: '请求超时，请检查网络后重试。' }
  return { code: fallbackCode, message: fallbackMessage }
}

export function createTranslationIpcHandlers(deps: {
  translationService: TranslationService
  sharedAIService: SharedAIService
  aiCredentials: AIProviderCredentialStore
  openExternal: (url: string) => Promise<void>
  isManagerMainFrame: (event: IpcSenderContext) => boolean
}): { handlers: Record<string, TranslationHandler>; dispose(): void } {
  const activeConnectionTests = new Set<AbortController>()
  const handlers: Record<string, TranslationHandler> = {
    'ai:list-providers': (event) => deps.isManagerMainFrame(event)
      ? { ok: true, data: deps.sharedAIService.getProviderDescriptors().map(({ id, name, defaultModel, documentationUrl, modelHint, requiresQwenWorkspace }) => ({ id, name, defaultModel, documentationUrl, modelHint, requiresQwenWorkspace })) }
      : fail('UNAUTHORIZED', '当前窗口无权执行此操作。'),
    'ai:provider-status': async (event, providerId): Promise<IpcResult<Awaited<ReturnType<SharedAIService['getProviderInfo']>>>> => {
      if (!deps.isManagerMainFrame(event)) return fail('UNAUTHORIZED', '当前窗口无权读取 AI 服务状态。')
      if (!isAIProviderId(providerId)) return fail('INVALID_PROVIDER', 'AI 服务类型无效。')
      try { return { ok: true, data: await deps.sharedAIService.getProviderInfo(providerId) } }
      catch { return fail('AI_STATUS_UNAVAILABLE', '无法读取该服务的安全配置信息。') }
    },
    'ai:save-provider-key': async (event, providerId, apiKey): Promise<IpcResult<void>> => {
      if (!deps.isManagerMainFrame(event)) return fail('UNAUTHORIZED', '当前窗口无权保存 AI API Key。')
      if (!isAIProviderId(providerId)) return fail('INVALID_PROVIDER', 'AI 服务类型无效。')
      if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.trim().length > MAX_API_KEY_LENGTH) return fail('INVALID_API_KEY', '请输入有效的 API Key。')
      try { await deps.aiCredentials.set(providerId, apiKey.trim()); return { ok: true, data: undefined } }
      catch { return fail('SECURE_STORAGE_UNAVAILABLE', 'Windows 安全存储不可用，API Key 未保存。') }
    },
    'ai:clear-provider-key': async (event, providerId): Promise<IpcResult<void>> => {
      if (!deps.isManagerMainFrame(event)) return fail('UNAUTHORIZED', '当前窗口无权删除 AI API Key。')
      if (!isAIProviderId(providerId)) return fail('INVALID_PROVIDER', 'AI 服务类型无效。')
      try { await deps.aiCredentials.clear(providerId); return { ok: true, data: undefined } }
      catch { return fail('SECURE_STORAGE_UNAVAILABLE', 'Windows 安全存储不可用，无法删除 API Key。') }
    },
    'ai:qwen-regions': (event) => deps.isManagerMainFrame(event)
      ? { ok: true, data: deps.sharedAIService.getQwenRegions() }
      : fail('UNAUTHORIZED', '当前窗口无权执行此操作。'),
    'translate:provider-info': async (event): Promise<IpcResult<Awaited<ReturnType<TranslationService['getProviderInfo']>>>> => {
      if (!deps.isManagerMainFrame(event)) return fail('UNAUTHORIZED', '当前窗口无权读取翻译服务状态。')
      try { return { ok: true, data: await deps.translationService.getProviderInfo() } }
      catch { return fail('TRANSLATION_STATUS_UNAVAILABLE', '无法读取翻译服务状态。') }
    },
    'translate:run': async (event, request: unknown): Promise<IpcResult<Awaited<ReturnType<TranslationService['translate']>>>> => {
      if (!deps.isManagerMainFrame(event)) return fail('UNAUTHORIZED', '当前窗口无权调用翻译服务。')
      if (!validateTranslationRequest(request)) return fail('INVALID_TRANSLATION', '翻译输入无效。')
      try { return { ok: true, data: await deps.translationService.translate(request) } }
      catch (error) { return { ok: false, error: providerError(error, 'TRANSLATION_FAILED', '翻译失败，请稍后重试。') } }
    },
    'translate:cancel': (event, requestId: unknown): IpcResult<{ cancelled: boolean }> => {
      if (!deps.isManagerMainFrame(event)) return fail('UNAUTHORIZED', '当前窗口无权取消翻译请求。')
      if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{8,64}$/.test(requestId)) return fail('INVALID_REQUEST_ID', '翻译请求编号无效。')
      return { ok: true, data: { cancelled: deps.translationService.cancel(requestId) } }
    },
    'ai:test-connection': async (event): Promise<IpcResult<{ providerName: string; model: string }>> => {
      if (!deps.isManagerMainFrame(event)) return fail('UNAUTHORIZED', '当前窗口无权测试 AI 服务。')
      const controller = new AbortController()
      activeConnectionTests.add(controller)
      const timeout = setTimeout(() => controller.abort(new DOMException('Connection test timed out.', 'TimeoutError')), 30_000)
      try {
        const result = await deps.sharedAIService.testConnection(controller.signal)
        if (controller.signal.aborted) throw controller.signal.reason
        return { ok: true, data: { providerName: result.providerName, model: result.model } }
      } catch (error) { return { ok: false, error: providerError(error, 'AI_CONNECTION_FAILED', '无法连接 AI 服务，请检查网络和设置。') } }
      finally { clearTimeout(timeout); activeConnectionTests.delete(controller) }
    },
    'translate:open-google': async (event, input: unknown): Promise<IpcResult<void>> => {
      if (!deps.isManagerMainFrame(event)) return fail('UNAUTHORIZED', '当前窗口无权打开翻译网站。')
      if (typeof input !== 'object' || input === null || Array.isArray(input)) return fail('INVALID_TRANSLATION', '翻译输入无效。')
      const value = input as Record<string, unknown>
      if (Object.keys(value).some((key) => !['text', 'targetLanguage'].includes(key)) || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 20_000 || !isTranslationLanguage(value.targetLanguage)) return fail('INVALID_TRANSLATION', '翻译输入无效。')
      const generation = deps.translationService.captureAdmissionGeneration()
      if (generation === null) return fail('TRANSLATION_DISABLED', '翻译功能当前不可用。')
      if (!deps.translationService.isAdmissionGenerationCurrent(generation)) return fail('TRANSLATION_DISABLED', '翻译功能当前不可用。')
      try {
        await deps.openExternal(buildGoogleTranslateUrl(value.text, value.targetLanguage))
        if (!deps.translationService.isAdmissionGenerationCurrent(generation)) return fail('TRANSLATION_DISABLED', '翻译功能当前不可用。')
        return { ok: true, data: undefined }
      } catch { return fail('GOOGLE_TRANSLATE_FAILED', '无法打开 Google Translate。') }
    },
  }
  return {
    handlers,
    dispose() { for (const controller of activeConnectionTests) controller.abort(new DOMException('Manager lifecycle ended.', 'AbortError')) },
  }
}

export function registerTranslationIpcHandlers(
  ipcMain: { handle(channel: string, handler: TranslationHandler): void },
  deps: Parameters<typeof createTranslationIpcHandlers>[0],
): () => void {
  const created = createTranslationIpcHandlers(deps)
  for (const [channel, handler] of Object.entries(created.handlers)) ipcMain.handle(channel, handler)
  return created.dispose
}
