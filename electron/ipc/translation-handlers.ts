import { isAIProviderId } from '../../src/shared/ai-config.ts'
import type { IpcResult } from '../../src/shared/ipc.ts'
import type { AIProviderCredentialStore } from '../services/ai-credentials.ts'
import type { SharedAIService } from '../services/shared-ai-service.ts'
import { ServiceError } from '../services/service-error.ts'
import { createManagerInvokeRegistry, type IpcSenderContext, type ManagerInvokeRegistry } from './window-security.ts'

const MAX_API_KEY_LENGTH = 4096
type TranslationHandler = (event: IpcSenderContext, ...args: unknown[]) => Promise<IpcResult<unknown>> | IpcResult<unknown>

function fail<T>(code: string, message: string): IpcResult<T> { return { ok: false, error: { code, message } } }

export function createTranslationIpcHandlers(deps: {
  sharedAIService: SharedAIService
  aiCredentials: AIProviderCredentialStore
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
    'ai:test-connection': async (event, providerId): Promise<IpcResult<{ providerName: string; model: string }>> => {
      if (!deps.isManagerMainFrame(event)) return fail('UNAUTHORIZED', '当前窗口无权测试 AI 服务。')
      if (providerId !== undefined && !isAIProviderId(providerId)) return fail('INVALID_PROVIDER', 'AI 服务类型无效。')
      const controller = new AbortController()
      activeConnectionTests.add(controller)
      const timeout = setTimeout(() => controller.abort(new DOMException('Connection test timed out.', 'TimeoutError')), 30_000)
      try {
        const result = await deps.sharedAIService.testConnection(controller.signal, providerId)
        if (controller.signal.aborted) throw controller.signal.reason
        return { ok: true, data: { providerName: result.providerName, model: result.model } }
      } catch (error) {
        // Only fixed product copy crosses this credential-bearing operation's boundary.
        if (error instanceof ServiceError && error.code === 'AI_NOT_CONFIGURED') return fail('AI_NOT_CONFIGURED', '请先保存模型、服务配置和 API Key。')
        if (error instanceof ServiceError && error.code === 'AI_CONFIGURATION_INVALID') return fail('AI_CONFIGURATION_INVALID', '请检查已保存的服务地址、地区和工作空间。')
        if (error instanceof Error && error.name === 'TimeoutError') return fail('AI_CONNECTION_FAILED_TIMEOUT', '请求超时，请检查网络后重试。')
        return fail('AI_CONNECTION_FAILED', '无法连接 AI 服务，请检查网络、模型、服务地址和凭据。')
      }
      finally { clearTimeout(timeout); activeConnectionTests.delete(controller) }
    },

  }
  return {
    handlers,
    dispose() { for (const controller of activeConnectionTests) controller.abort(new DOMException('Manager lifecycle ended.', 'AbortError')) },
  }
}

export function registerTranslationIpcHandlers(
  ipcMain: ManagerInvokeRegistry,
  deps: Parameters<typeof createTranslationIpcHandlers>[0],
): () => void {
  const created = createTranslationIpcHandlers(deps)
  const managerIpc = createManagerInvokeRegistry(ipcMain, deps.isManagerMainFrame)
  for (const [channel, handler] of Object.entries(created.handlers)) managerIpc.handle(channel, handler)
  return created.dispose
}
