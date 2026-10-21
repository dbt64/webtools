import {
  parseFeatureInvocationRequest,
  type FeatureInvocationReasonCode,
  type FeatureInvocationRequest,
  type FeatureInvocationResult,
} from '../../src/shared/feature-invocation-contracts.ts'
import { createHash } from 'node:crypto'
import type { FeatureRef } from '../../src/shared/feature-contracts.ts'
import type { DeclarativeCompatibilityFeature } from '../plugins/feature-contracts.ts'
import { DECLARATIVE_V1_FEATURE_ID } from '../plugins/declarative-feature-adapter.ts'
import type { WebFeatureAuthority } from '../plugins/web-feature-authority.ts'
import type { InvocationTextContext } from '../plugins/web-host-capabilities.ts'
import type { FeatureActivationOutcome } from './feature-activation.ts'
import type { NodeCommandOptions } from '../plugins/node-command-execution.ts'
import { parseFeatureQuickResultPayload, type FeatureQuickResultPayload, type FeatureResultControl } from '../../src/shared/feature-quick-result-contracts.ts'
import type { TranslationPreviewOutcome } from './builtin-translation-preview.ts'

const BUILTIN_TRANSLATION_REF: FeatureRef = { pluginId: 'webtools.translation', featureId: 'translate-text' }
// Retain every unique Main-side invocation ID for this authenticated pipe
// session, without eviction, so a completed ID cannot become executable again.
// This service has its own bounded budget; the pipe server's inbound-message
// limit is separate because Feature invocations travel in the opposite direction.
const MAX_REPLAY_ENTRIES = 2048

export interface FeatureInvocationDependencies {
  isConnected(): boolean
  isTranslationEnabled(): boolean
  authorizeDeclarative(
    ref: FeatureRef,
    dispatch: (feature: DeclarativeCompatibilityFeature) => Promise<void>,
  ): Promise<{ completion: Promise<void> }>
  openDeclarative(requestId: string, feature: DeclarativeCompatibilityFeature): Promise<void>
  openTranslation(requestId: string, selectedText?: string): Promise<void>
  translatePreview?(requestId: string, text: string, signal: AbortSignal): Promise<TranslationPreviewOutcome | null>
  isWebFeature?(ref: FeatureRef): boolean
  authorizeWeb?(ref: FeatureRef, dispatch: (authority: WebFeatureAuthority) => Promise<void>): Promise<{ completion: Promise<void> }>
  openWeb?(requestId: string, authority: WebFeatureAuthority, context?: InvocationTextContext): Promise<void>
  activateWebFeature?(ref: FeatureRef, context?: InvocationTextContext, surface?: 'launcher' | 'super-panel', quickResult?: NodeCommandOptions): Promise<FeatureActivationOutcome | void>
  supportsQuickResult?(): boolean
  publishQuickResult?(payload: FeatureQuickResultPayload): Promise<void>
  clearQuickResult?(binding: FeatureResultControl): Promise<void>
  quickResultEffects?(binding: FeatureResultControl, signal: AbortSignal): NodeCommandOptions['effects']
  now?: () => number
}

interface ReplayEntry {
  fingerprint: string | null
  result: FeatureInvocationResult | null
  promise: Promise<FeatureInvocationResult>
  ref: FeatureRef
  abort: AbortController
  pending: boolean
}

/** Main-only execution authority for the first set of invokable Features. */
export class FeatureInvocationService {
  private readonly deps: FeatureInvocationDependencies
  private readonly replay = new Map<string, ReplayEntry>()
  private displayed: { binding: FeatureResultControl; isCurrent: () => boolean } | null = null

  constructor(deps: FeatureInvocationDependencies) { this.deps = deps }

  invoke(value: unknown): Promise<FeatureInvocationResult> {
    const request = parseFeatureInvocationRequest(value)
    if (!request) return Promise.reject(new TypeError('Invalid Feature invocation request.'))

    const fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex')
    const previous = this.replay.get(request.requestId)
    if (previous) {
      if (previous.fingerprint === null && previous.ref.pluginId === request.ref.pluginId && previous.ref.featureId === request.ref.featureId) return previous.promise
      if (previous.fingerprint === fingerprint) return previous.promise
      return Promise.resolve(result(request.requestId, 'rejected', 'stale-request'))
    }
    if (!this.makeRoom()) return Promise.resolve(result(request.requestId, 'rejected', 'queue-full'))

    const entry: ReplayEntry = { fingerprint, result: null, promise: Promise.resolve(result(request.requestId, 'failed', 'dispatch-failed')),
      ref: { ...request.ref }, abort: new AbortController(), pending: true }
    entry.promise = Promise.resolve()
      .then(() => this.execute(request, entry))
      .catch(error => failure(request.requestId, error))
      .then(value => {
        entry.result = value
        entry.pending = false
        return value
      })
    this.replay.set(request.requestId, entry)
    return entry.promise
  }

  /** A new authenticated pipe session has a fresh replay namespace. */
  clearSession(): void {
    for (const entry of this.replay.values()) if (entry.pending) entry.abort.abort()
    this.replay.clear(); this.displayed = null
  }
  cancel(requestId: string, ref: FeatureRef): boolean {
    const entry = this.replay.get(requestId)
    if (!entry) {
      if (!this.makeRoom()) return false
      const cancelled = result(requestId, 'cancelled', 'cancelled')
      this.replay.set(requestId, { fingerprint: null, ref: { ...ref }, pending: false, abort: new AbortController(), result: cancelled, promise: Promise.resolve(cancelled) })
      return true
    }
    if (entry.ref.pluginId !== ref.pluginId || entry.ref.featureId !== ref.featureId) return false
    if (entry.pending) entry.abort.abort()
    if (this.displayed?.binding.requestId === requestId) this.displayed = null
    return true
  }
  async revalidateDisplayedResult(): Promise<void> {
    const shown = this.displayed
    if (shown && !shown.isCurrent()) {
      this.displayed = null
      if (this.deps.isConnected()) await this.deps.clearQuickResult?.(shown.binding)
    }
  }

  private makeRoom(): boolean {
    return this.replay.size < MAX_REPLAY_ENTRIES
  }

  private async execute(request: FeatureInvocationRequest, entry: ReplayEntry): Promise<FeatureInvocationResult> {
    if (!this.deps.isConnected()) return result(request.requestId, 'failed', 'manager-disconnected')
    const context = request.context
    const age = () => (this.deps.now ?? Date.now)() - (context?.capturedAtUnixMs ?? (this.deps.now ?? Date.now)())
    if (context && (age() < 0 || age() >= 30000)) return result(request.requestId, 'rejected', 'stale-request')
    if (request.quickResult && (!this.deps.supportsQuickResult?.() || !this.deps.publishQuickResult))
      return result(request.requestId, 'rejected', 'unsupported-feature-kind')

    if (request.ref.pluginId === BUILTIN_TRANSLATION_REF.pluginId) {
      if (request.ref.featureId !== BUILTIN_TRANSLATION_REF.featureId) return result(request.requestId, 'rejected', 'feature-not-found')
      if (!this.deps.isTranslationEnabled()) return result(request.requestId, 'rejected', 'plugin-disabled')
      try {
        if (request.quickResult) {
          if (!this.deps.translatePreview || context?.type !== 'text' || context.source !== 'selected-text')
            return result(request.requestId, 'rejected', 'unsupported-feature-kind')
          const binding = { requestId: request.requestId, ref: request.ref }
          this.displayed = null
          const preview = await this.deps.translatePreview(request.requestId, context.text, entry.abort.signal)
          if (!preview || entry.abort.signal.aborted || this.replay.get(request.requestId) !== entry || !preview.isCurrent())
            return result(request.requestId, 'cancelled', 'cancelled')
          const payload = parseFeatureQuickResultPayload({ resultVersion: 1, ...binding, text: preview.text })
          if (!payload || !this.deps.isConnected() || !this.deps.isTranslationEnabled()) throw codeError('FEATURE_UNAVAILABLE')
          await this.deps.publishQuickResult!(payload)
          if (!entry.abort.signal.aborted && preview.isCurrent() && this.deps.isTranslationEnabled())
            this.displayed = { binding, isCurrent: preview.isCurrent }
          else if (this.deps.isConnected()) await this.deps.clearQuickResult?.(binding)
          return result(request.requestId, 'completed', 'completed')
        }
        await this.deps.openTranslation(request.requestId, request.source === 'super-panel' && context?.type === 'text' ? context.text : undefined)
        return result(request.requestId, 'accepted', 'accepted')
      } catch (error) { return failure(request.requestId, error) }
    }

    if (this.deps.isWebFeature?.(request.ref) ?? request.ref.featureId !== DECLARATIVE_V1_FEATURE_ID) {
      if (!this.deps.activateWebFeature && (!this.deps.authorizeWeb || !this.deps.openWeb)) return result(request.requestId, 'rejected', 'feature-not-found')
      const runtimeContext = (ageMs: number): InvocationTextContext | undefined => {
        if (!context) return undefined
        const { capturedAtUnixMs: _captured, ...payload } = context
        return { ...payload, ageMs }
      }
      try {
        if (this.deps.activateWebFeature) {
          const binding = { requestId: request.requestId, ref: request.ref }
          const options: NodeCommandOptions | undefined = request.quickResult ? { resultTarget: 'super-panel', signal: entry.abort.signal,
            effects: this.deps.quickResultEffects?.(binding, entry.abort.signal) } : undefined
          if (options) this.displayed = null
          const outcome = await this.deps.activateWebFeature(request.ref, runtimeContext(age()), request.source, options)
          if (entry.abort.signal.aborted || this.replay.get(request.requestId) !== entry) return result(request.requestId, 'cancelled', 'cancelled')
          if (request.quickResult && outcome?.status === 'completed' && outcome.result) {
            const payload = parseFeatureQuickResultPayload({ resultVersion: 1, ...binding, text: outcome.result.text })
            if (!payload || !outcome.isSourceCurrent?.() || !this.deps.isConnected()) throw codeError('FEATURE_UNAVAILABLE')
            await this.deps.publishQuickResult!(payload)
            if (!entry.abort.signal.aborted && outcome.isSourceCurrent()) this.displayed = { binding, isCurrent: outcome.isSourceCurrent }
            else if (this.deps.isConnected()) await this.deps.clearQuickResult?.(binding)
          }
          if (outcome?.status === 'completed') return { requestId: request.requestId, status: 'completed', reasonCode: 'completed',
            ...(request.source === 'super-panel' && outcome.externalOpened && !outcome.result ? { dismissPanel: true as const } : {}) }
          if (outcome?.status === 'cancelled') return { requestId: request.requestId, status: 'cancelled', reasonCode: 'cancelled' }
          return result(request.requestId, 'accepted', 'accepted')
        }
        const ticket = await this.deps.authorizeWeb!(request.ref, authority => {
          if (!this.deps.isConnected()) throw codeError('MANAGER_DISCONNECTED')
          const ageMs = age()
          if (context && (ageMs < 0 || ageMs >= 30000)) throw codeError('STALE_REQUEST')
          return this.deps.openWeb!(request.requestId, authority, runtimeContext(ageMs))
        })
        await ticket.completion; return result(request.requestId, 'accepted', 'accepted')
      } catch (error) { return entry.abort.signal.aborted ? result(request.requestId, 'cancelled', 'cancelled') : failure(request.requestId, error) }
    }
    if (request.ref.featureId !== DECLARATIVE_V1_FEATURE_ID) return result(request.requestId, 'rejected', 'feature-not-found')
    let completion: Promise<void> | null = null
    try {
      const ticket = await this.deps.authorizeDeclarative(request.ref, feature => {
        if (!this.deps.isConnected()) throw codeError('MANAGER_DISCONNECTED')
        if (feature.sourceKind !== 'declarative' || feature.ref.pluginId !== request.ref.pluginId
          || feature.ref.featureId !== request.ref.featureId || feature.resolvedEntry.kind !== 'declarative-compatibility')
          throw codeError('UNSUPPORTED_FEATURE_KIND')
        completion = this.deps.openDeclarative(request.requestId, feature)
        return completion
      })
      await (completion ?? ticket.completion)
      return result(request.requestId, 'accepted', 'accepted')
    } catch (error) { return failure(request.requestId, error) }
  }
}

function result(requestId: string, status: FeatureInvocationResult['status'], reasonCode: FeatureInvocationReasonCode): FeatureInvocationResult {
  if (status === 'accepted') return { requestId, status, reasonCode: 'accepted' }
  if (status === 'completed') return { requestId, status, reasonCode: 'completed' }
  if (status === 'cancelled') return { requestId, status, reasonCode: 'cancelled' }
  if (status === 'rejected') {
    const rejected: Exclude<FeatureInvocationReasonCode, 'accepted' | 'completed' | 'cancelled' | 'manager-timeout' | 'manager-disconnected' | 'dispatch-failed' | 'command-failed' | 'command-timeout'> = reasonCode === 'accepted' || reasonCode === 'completed' || reasonCode === 'cancelled'
      || reasonCode === 'manager-timeout' || reasonCode === 'manager-disconnected' || reasonCode === 'dispatch-failed' || reasonCode === 'command-failed' || reasonCode === 'command-timeout'
      ? 'feature-unavailable'
      : reasonCode
    return { requestId, status, reasonCode: rejected }
  }
  const failed = reasonCode === 'manager-timeout' || reasonCode === 'manager-disconnected' || reasonCode === 'dispatch-failed' || reasonCode === 'command-failed' || reasonCode === 'command-timeout'
    ? reasonCode : 'dispatch-failed'
  return { requestId, status, reasonCode: failed }
}

function failure(requestId: string, error: unknown): FeatureInvocationResult {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : ''
  switch (code) {
    case 'COMMAND_TIMEOUT': return result(requestId, 'failed', 'command-timeout')
    case 'COMMAND_FAILED': case 'COMMAND_EXITED': case 'COMMAND_PROCESS_ERROR': case 'COMMAND_START_FAILED': case 'COMMAND_PROTOCOL_ERROR':
      return result(requestId, 'failed', 'command-failed')
    case 'NOT_INSTALLED': case 'ACTION_NOT_DECLARED': case 'FEATURE_NOT_FOUND':
      return result(requestId, 'rejected', 'feature-not-found')
    case 'PLUGIN_DISABLED':
      return result(requestId, 'rejected', 'plugin-disabled')
    case 'PERMISSION_DENIED':
      return result(requestId, 'rejected', 'permission-denied')
    case 'QUEUE_FULL':
      return result(requestId, 'rejected', 'queue-full')
    case 'INTEGRITY_FAILED': case 'INVALID_PACKAGE': case 'INVALID_MANIFEST': case 'FEATURE_UNAVAILABLE':
      return result(requestId, 'rejected', 'feature-unavailable')
    case 'UNSUPPORTED_FEATURE_KIND':
      return result(requestId, 'rejected', 'unsupported-feature-kind')
    case 'STALE_REQUEST': case 'SESSION_EXPIRED':
      return result(requestId, 'rejected', 'stale-request')
    case 'MANAGER_TIMEOUT': case 'HANDOFF_EXPIRED': case 'INTENT_TIMEOUT':
      return result(requestId, 'failed', 'manager-timeout')
    case 'MANAGER_DISCONNECTED': case 'MANAGER_CLOSED':
      return result(requestId, 'failed', 'manager-disconnected')
    default:
      return result(requestId, 'failed', 'dispatch-failed')
  }
}

function codeError(code: string): Error & { code: string } {
  const error = new Error(code) as Error & { code: string }
  error.code = code
  return error
}
