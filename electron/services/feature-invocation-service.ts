import {
  parseFeatureInvocationRequest,
  type FeatureInvocationReasonCode,
  type FeatureInvocationRequest,
  type FeatureInvocationResult,
} from '../../src/shared/feature-invocation-contracts.ts'
import type { FeatureRef } from '../../src/shared/feature-contracts.ts'
import type { DeclarativeCompatibilityFeature } from '../plugins/feature-contracts.ts'
import { DECLARATIVE_V1_FEATURE_ID } from '../plugins/declarative-feature-adapter.ts'

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
  openTranslation(requestId: string): Promise<void>
}

interface ReplayEntry {
  fingerprint: string
  result: FeatureInvocationResult | null
  promise: Promise<FeatureInvocationResult>
}

/** Main-only execution authority for the first set of invokable Features. */
export class FeatureInvocationService {
  private readonly deps: FeatureInvocationDependencies
  private readonly replay = new Map<string, ReplayEntry>()

  constructor(deps: FeatureInvocationDependencies) { this.deps = deps }

  invoke(value: unknown): Promise<FeatureInvocationResult> {
    const request = parseFeatureInvocationRequest(value)
    if (!request) return Promise.reject(new TypeError('Invalid Feature invocation request.'))

    const fingerprint = JSON.stringify(request)
    const previous = this.replay.get(request.requestId)
    if (previous) {
      if (previous.fingerprint === fingerprint) return previous.promise
      return Promise.resolve(result(request.requestId, 'rejected', 'stale-request'))
    }
    if (!this.makeRoom()) return Promise.resolve(result(request.requestId, 'rejected', 'queue-full'))

    const entry: ReplayEntry = { fingerprint, result: null, promise: Promise.resolve(result(request.requestId, 'failed', 'dispatch-failed')) }
    entry.promise = Promise.resolve()
      .then(() => this.execute(request))
      .catch(error => failure(request.requestId, error))
      .then(value => {
        entry.result = value
        return value
      })
    this.replay.set(request.requestId, entry)
    return entry.promise
  }

  /** A new authenticated pipe session has a fresh replay namespace. */
  clearSession(): void { this.replay.clear() }

  private makeRoom(): boolean {
    return this.replay.size < MAX_REPLAY_ENTRIES
  }

  private async execute(request: FeatureInvocationRequest): Promise<FeatureInvocationResult> {
    if (!this.deps.isConnected()) return result(request.requestId, 'failed', 'manager-disconnected')

    if (request.ref.pluginId === BUILTIN_TRANSLATION_REF.pluginId) {
      if (request.ref.featureId !== BUILTIN_TRANSLATION_REF.featureId) return result(request.requestId, 'rejected', 'feature-not-found')
      if (!this.deps.isTranslationEnabled()) return result(request.requestId, 'rejected', 'plugin-disabled')
      try {
        await this.deps.openTranslation(request.requestId)
        return result(request.requestId, 'accepted', 'accepted')
      } catch (error) { return failure(request.requestId, error) }
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
  if (status === 'rejected') {
    const rejected: Exclude<FeatureInvocationReasonCode, 'accepted' | 'manager-timeout' | 'manager-disconnected' | 'dispatch-failed'> = reasonCode === 'accepted'
      || reasonCode === 'manager-timeout' || reasonCode === 'manager-disconnected' || reasonCode === 'dispatch-failed'
      ? 'feature-unavailable'
      : reasonCode
    return { requestId, status, reasonCode: rejected }
  }
  const failed = reasonCode === 'manager-timeout' || reasonCode === 'manager-disconnected' || reasonCode === 'dispatch-failed'
    ? reasonCode : 'dispatch-failed'
  return { requestId, status, reasonCode: failed }
}

function failure(requestId: string, error: unknown): FeatureInvocationResult {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : ''
  switch (code) {
    case 'NOT_INSTALLED': case 'ACTION_NOT_DECLARED': case 'FEATURE_NOT_FOUND':
      return result(requestId, 'rejected', 'feature-not-found')
    case 'PLUGIN_DISABLED':
      return result(requestId, 'rejected', 'plugin-disabled')
    case 'PERMISSION_DENIED':
      return result(requestId, 'rejected', 'permission-denied')
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
