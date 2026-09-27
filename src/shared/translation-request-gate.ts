export interface TranslationRequestToken {
  requestId: string
  generation: number
}

export class TranslationRequestGate {
  private currentGeneration = 0
  private activeRequestId: string | null = null

  get generation(): number { return this.currentGeneration }
  get currentRequestId(): string | null { return this.activeRequestId }

  begin(requestId: string): TranslationRequestToken {
    this.currentGeneration += 1
    this.activeRequestId = requestId
    return { requestId, generation: this.currentGeneration }
  }

  invalidate(): string | null {
    const previousRequestId = this.activeRequestId
    this.activeRequestId = null
    this.currentGeneration += 1
    return previousRequestId
  }

  isCurrent(token: TranslationRequestToken): boolean {
    return token.generation === this.currentGeneration && token.requestId === this.activeRequestId
  }

  isGenerationCurrent(generation: number): boolean { return generation === this.currentGeneration }

  finish(token: TranslationRequestToken): boolean {
    if (!this.isCurrent(token)) return false
    this.activeRequestId = null
    return true
  }
}
