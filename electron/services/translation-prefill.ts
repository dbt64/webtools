import type { TranslationPrefillRequest } from '../../src/shared/domain'

export type { TranslationPrefillRequest } from '../../src/shared/domain'

export function isValidTranslationText(text: unknown): text is string {
  return typeof text === 'string' && text.length > 0 && text.length <= 20_000
}

export class TranslationPrefillQueue {
  private pending: TranslationPrefillRequest | null = null
  private managerReady = false

  enqueue(request: TranslationPrefillRequest): void {
    this.pending = request
  }

  markReady(): TranslationPrefillRequest | null {
    this.managerReady = true
    return this.pending
  }

  resetReadiness(): void {
    this.managerReady = false
  }

  getReadyRequest(): TranslationPrefillRequest | null {
    return this.managerReady ? this.pending : null
  }

  acknowledge(id: string): boolean {
    if (!this.managerReady || this.pending?.id !== id) return false
    this.pending = null
    return true
  }

  discard(id: string): boolean {
    if (this.pending?.id !== id) return false
    this.pending = null
    return true
  }
}
