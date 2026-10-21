import { randomUUID } from 'node:crypto'
import { BridgeWireError } from '../../plugin-sdk/declarative-v1/web/protocol.mjs'
import { hasExactResultFields, parseFeatureResultControl, type FeatureResultControl } from '../../src/shared/feature-quick-result-contracts.ts'
import { isFeatureInvocationRequestId } from '../../src/shared/feature-invocation-contracts.ts'
import type { FeatureRef } from '../../src/shared/feature-contracts.ts'
import type { PluginConsent } from '../plugins/permission-broker.ts'

export interface FeatureAIConfirmation extends FeatureResultControl {
  readonly consentId: string
  readonly pluginName: string
  readonly providerName: string
  readonly preview: string
}
interface Pending { binding: FeatureResultControl; resolve(approved: boolean): void }
interface Approval { ref: FeatureRef; identity: string; removeAbort(): void }

/** Presentation adapter only. Existing capabilities own grants and the one-use gesture. */
export class FeatureQuickResultConsent {
  private readonly pending = new Map<string, Pending>()
  private readonly approved = new Map<string, Approval>()
  private closed = false
  constructor(private readonly deps: {
    provider(): Promise<{ identity: string; label: string }>
    send(value: FeatureAIConfirmation): Promise<void>
  }) {}
  private clearApproval(id: string): void { this.approved.get(id)?.removeAbort(); this.approved.delete(id) }
  async confirm(requestId: string, ref: FeatureRef, consent: PluginConsent, signal: AbortSignal): Promise<boolean> {
    if (this.closed || signal.aborted || consent.kind !== 'ai' || consent.pluginId !== ref.pluginId || this.pending.size >= 8) return false
    const binding = { requestId, ref: { ...ref } }
    const provider = await this.deps.provider()
    if (signal.aborted || this.closed) return false
    const consentId = randomUUID()
    let decide!: (value: boolean) => void
    const decision = new Promise<boolean>(resolve => { decide = resolve })
    const abort = () => decide(false)
    signal.addEventListener('abort', abort, { once: true })
    this.pending.set(consentId, { binding, resolve: decide })
    try {
      const preview = Array.from(consent.preview ?? '').slice(0, 4096).map(c => {
        const code = c.codePointAt(0)!
        return code >= 0xd800 && code <= 0xdfff ? '\ufffd' : c
      }).join('')
      await this.deps.send({ ...binding, consentId, pluginName: consent.name.slice(0, 160), providerName: provider.label.slice(0, 160), preview })
      if (!await decision || signal.aborted || this.closed || (await this.deps.provider()).identity !== provider.identity) return false
      if (signal.aborted || this.closed) return false
      this.clearApproval(requestId)
      const release = () => this.clearApproval(requestId)
      signal.addEventListener('abort', release, { once: true })
      this.approved.set(requestId, { ref: { ...ref }, identity: provider.identity, removeAbort: () => signal.removeEventListener('abort', release) })
      return true
    } catch { return false }
    finally { this.pending.delete(consentId); signal.removeEventListener('abort', abort) }
  }
  decide(value: unknown): boolean {
    if (!hasExactResultFields(value, ['requestId', 'ref', 'consentId', 'approved']) || !isFeatureInvocationRequestId(value.consentId) || typeof value.approved !== 'boolean') return false
    const binding = parseFeatureResultControl({ requestId: value.requestId, ref: value.ref })
    const pending = this.pending.get(value.consentId)
    if (!binding || !pending || pending.binding.requestId !== binding.requestId
      || pending.binding.ref.pluginId !== binding.ref.pluginId || pending.binding.ref.featureId !== binding.ref.featureId) return false
    this.pending.delete(value.consentId); pending.resolve(value.approved); return true
  }
  async runApproved<T>(binding: FeatureResultControl, signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    const approval = this.approved.get(binding.requestId)
    if (!approval || signal.aborted || this.closed || approval.ref.pluginId !== binding.ref.pluginId || approval.ref.featureId !== binding.ref.featureId) throw new BridgeWireError('USER_CANCELLED')
    const provider = await this.deps.provider()
    this.clearApproval(binding.requestId)
    if (signal.aborted || this.closed || provider.identity !== approval.identity) throw new BridgeWireError('USER_CANCELLED')
    return operation()
  }
  close(): void {
    this.closed = true
    for (const entry of this.pending.values()) entry.resolve(false)
    this.pending.clear()
    for (const id of this.approved.keys()) this.clearApproval(id)
  }
}
