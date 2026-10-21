import { isTranslationPreviewCandidate } from '../../src/shared/translation-preview.ts'
import { normalizeFeatureResultText } from '../../src/shared/feature-quick-result-contracts.ts'
import { MYMEMORY_MAX_UTF8_BYTES, type TranslationSettings } from '../../src/shared/translation-contracts.ts'
import type { SharedAISettings } from '../../src/shared/ai-config.ts'
import type { Translation2WorkspaceSettings } from '../../src/shared/translation2-contracts.ts'
import type { TranslationService } from './translation-service.ts'
import { resolveTranslation2ExecutionTarget } from './translation2-target.ts'

export interface TranslationPreviewOutcome { text: string; isCurrent(): boolean }
interface Settings { translation: TranslationSettings; translation2: Translation2WorkspaceSettings; sharedAI: SharedAISettings }

/** First-party adapter. No provider/credential implementation and no plugin authority. */
export class BuiltinTranslationPreview {
  private generation = 0
  private readonly active = new Set<string>()
  constructor(private readonly deps: {
    service: Pick<TranslationService, 'translateWithTarget' | 'cancel' | 'captureAdmissionGeneration' | 'isAdmissionGenerationCurrent'>
    settings(): Settings
    enabled(): Promise<boolean>
  }) {}

  invalidate(): void {
    this.generation++
    for (const requestId of this.active) this.deps.service.cancel(requestId)
  }

  async run(requestId: string, text: string, signal: AbortSignal): Promise<TranslationPreviewOutcome | null> {
    this.invalidate() // One panel preview at a time, including work still checking provider status.
    if (signal.aborted || !isTranslationPreviewCandidate(text)) return null
    const generation = this.generation
    const settings = this.deps.settings()
    const identity = JSON.stringify(settings)
    const admission = this.deps.service.captureAdmissionGeneration()
    if (admission === null || !await this.deps.enabled()) return null
    const isCurrent = this.currentCheck(generation, identity, admission, signal)
    const outcome = (body: string): TranslationPreviewOutcome | null => isCurrent() ? { text: body, isCurrent } : null
    if (!isCurrent()) return null
    const translation = settings.translation
    if (translation.sourceLanguage !== 'auto' && translation.sourceLanguage !== 'en')
      return outcome('自动翻译预览仅处理英文；请将翻译来源语言设为“自动检测”或“英语”。')
    if (translation.targetLanguage === 'en') return outcome('当前目标语言为英语，无需英文翻译预览。')
    const target = resolveTranslation2ExecutionTarget(settings.translation2)
    if (!target) return outcome('当前选中的翻译服务不可用；请在 Translation 设置中选择可用服务。')
    if (target.kind === 'machine' && target.adapterId === 'mymemory' && new TextEncoder().encode(text).byteLength > MYMEMORY_MAX_UTF8_BYTES)
      return outcome(`当前 MyMemory 免费翻译最多支持 ${MYMEMORY_MAX_UTF8_BYTES} UTF-8 字节；本次文字过长，未发送。`)
    // Distinct from Manager request IDs so cancelling a preview cannot cancel its explicit handoff.
    const serviceRequestId = `panel-${requestId}`
    const abort = () => this.deps.service.cancel(serviceRequestId)
    signal.addEventListener('abort', abort, { once: true })
    this.active.add(serviceRequestId)
    try {
      const result = await this.deps.service.translateWithTarget({ requestId: serviceRequestId, text,
        sourceLanguage: translation.sourceLanguage === 'auto' ? 'en' : translation.sourceLanguage,
        targetLanguage: translation.targetLanguage }, target)
      if (!isCurrent()) return null
      const label = result.provider.providerName.replace(/[\u0000-\u001f]/g, ' ').slice(0, 160)
      const translated = normalizeFeatureResultText(result.translation)
      const body = translated === null ? null : normalizeFeatureResultText(`${label}\n\n${translated}`)
      return outcome(body ?? '译文为空或超出面板显示限制；请打开翻译页面处理。')
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
      // Never forward raw provider errors: they may contain input or credential-bearing details.
      const message = code === 'TRANSLATION_TIMEOUT' ? '翻译请求超时，请稍后重新唤出面板。'
        : code === 'TRANSLATION_NOT_CONFIGURED' || code === 'AI_NOT_CONFIGURED' ? '翻译服务尚未配置；请检查翻译和 AI 设置。'
          : code === 'FREE_TRANSLATION_QUOTA' ? '免费翻译额度不足或请求过于频繁，本次预览未完成。'
            : code === 'TRANSLATION_CANCELLED' ? '翻译预览已取消。'
              : '翻译预览未完成，请检查当前服务配置和网络，或打开翻译页面。'
      return outcome(message)
    } finally {
      signal.removeEventListener('abort', abort)
      this.active.delete(serviceRequestId)
    }
  }

  private currentCheck(generation: number, identity: string, admission: number, signal: AbortSignal): () => boolean {
    // The accepted-result revalidation closure retains metadata only, never the selection.
    return () => !signal.aborted && generation === this.generation
      && this.deps.service.isAdmissionGenerationCurrent(admission) && JSON.stringify(this.deps.settings()) === identity
  }
}
