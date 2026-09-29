import type { LauncherDisplayMode, ThemePreference } from './domain'

export type LauncherVisibilityEvent =
  | { kind: 'shown'; generation: number; launcherDisplayMode: LauncherDisplayMode; theme: ThemePreference }
  | { kind: 'hidden'; generation: number }

export class LauncherVisibilitySequence {
  private generation = 0
  private pendingAcknowledgements = new Map<number, () => void>()

  next(): number {
    for (const release of this.pendingAcknowledgements.values()) release()
    this.pendingAcknowledgements.clear()
    return ++this.generation
  }
  isCurrent(generation: number): boolean { return generation === this.generation }

  waitForAcknowledgement(generation: number): Promise<void> {
    if (!this.isCurrent(generation)) return Promise.resolve()
    return new Promise((resolve) => { this.pendingAcknowledgements.set(generation, resolve) })
  }

  acknowledge(generation: number): void {
    if (!this.isCurrent(generation)) return
    const release = this.pendingAcknowledgements.get(generation)
    if (!release) return
    this.pendingAcknowledgements.delete(generation)
    release()
  }
}

export function isNewerLauncherVisibilityEvent(lastGeneration: number, generation: number): boolean {
  return Number.isSafeInteger(generation) && generation > lastGeneration
}
