/** Main-only handoff projection. Renderer may receive exact text only after Translation is enabled. */
export interface TranslationHandoffToken {
  requestId: string
  generation: number
  uiGeneration: number
}

export type BuiltinTranslationHandoffProjection =
  | { status: 'none'; uiGeneration: number }
  | (TranslationHandoffToken & {
      status: 'blocked'
      reason: 'disabled' | 'faulted' | 'unavailable' | 'transitioning'
      errorCode?: string
      retryEnabled?: boolean
      hasPrefill: boolean
    })
  | (TranslationHandoffToken & { status: 'ready'; text: string | null })

export type TranslationHandoffDisposition = 'gate-presented' | 'enable-and-open' | 'applied' | 'cancel'

export interface ResolveTranslationHandoffRequest extends TranslationHandoffToken {
  disposition: TranslationHandoffDisposition
}
