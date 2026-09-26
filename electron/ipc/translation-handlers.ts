import { ipcMain } from 'electron'
import type { SecretStore } from '../services/secret-store'
import type { AiTranslationService } from '../services/ai-translation'
import { buildGoogleTranslateUrl } from '../services/google-translate'
import type { IpcResult } from '../../src/shared/ipc'

function fail<T>(code: string, message: string): IpcResult<T> { return { ok: false, error: { code, message } } }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

export function registerTranslationIpcHandlers(deps: { aiTranslationService: AiTranslationService; secretStore: SecretStore; openExternal: (url: string) => Promise<void> }): void {
  ipcMain.handle('ai:has-key', async () => { try { return await deps.secretStore.hasSecret('ai-api-key') } catch { return false } })
  ipcMain.handle('ai:save-key', async (_event, apiKey: unknown): Promise<IpcResult<void>> => {
    if (typeof apiKey !== 'string' || apiKey.length > 1000) return fail('INVALID_API_KEY', 'API Key 无效。')
    if (!apiKey.trim()) return fail('INVALID_API_KEY', '请输入 API Key。')
    try { await deps.secretStore.setSecret('ai-api-key', apiKey.trim()); return { ok: true, data: undefined } } catch (error) { return fail('SAVE_API_KEY_FAILED', error instanceof Error ? error.message : '无法安全保存 API Key。') }
  })
  ipcMain.handle('ai:clear-key', async (): Promise<IpcResult<void>> => { try { await deps.secretStore.deleteSecret('ai-api-key'); return { ok: true, data: undefined } } catch (error) { return fail('CLEAR_API_KEY_FAILED', error instanceof Error ? error.message : '无法删除 API Key。') } })
  ipcMain.handle('ai:translate', async (_event, input: unknown): Promise<IpcResult<{ translation: string }>> => {
    if (!isRecord(input) || typeof input.text !== 'string' || typeof input.targetLanguage !== 'string') return fail('INVALID_TRANSLATION', '翻译输入无效。')
    try { return { ok: true, data: { translation: await deps.aiTranslationService.translate(input.text, input.targetLanguage) } } } catch (error) { return fail('TRANSLATION_FAILED', error instanceof Error ? error.message : '翻译失败，请稍后再试。') }
  })
  ipcMain.handle('ai:test-connection', async (): Promise<IpcResult<{ model: string }>> => { try { return { ok: true, data: { model: await deps.aiTranslationService.testConnection() } } } catch (error) { return fail('AI_CONNECTION_FAILED', error instanceof Error ? error.message : '无法连接 AI 服务。') } })
  ipcMain.handle('translate:open-google', async (_event, input: unknown): Promise<IpcResult<void>> => {
    if (!isRecord(input) || typeof input.text !== 'string' || typeof input.targetLanguage !== 'string') return fail('INVALID_TRANSLATION', '翻译输入无效。')
    try { await deps.openExternal(buildGoogleTranslateUrl(input.text, input.targetLanguage)); return { ok: true, data: undefined } } catch (error) { return fail('GOOGLE_TRANSLATE_FAILED', error instanceof Error ? error.message : '无法打开 Google Translate。') }
  })
}
