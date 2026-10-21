import type { FeatureInvocationSurface, FeatureRef } from '../../src/shared/feature-contracts.ts'
import { isFeatureRef } from '../../src/shared/feature-contracts.ts'
import type { InvocationTextContext } from '../plugins/web-host-capabilities.ts'
import { isWebFeatureAuthority, type WebFeatureAuthority } from '../plugins/web-feature-authority.ts'
import type { PluginWindowManager } from '../plugins/plugin-window-manager.ts'
import type { NodeCommandExecutionAdapter, NodeCommandOptions } from '../plugins/node-command-execution.ts'
import type { FeatureTextResult } from '../../src/shared/feature-quick-result-contracts.ts'
import { acceptsInvocationContext, validateInvocationContext } from '../../plugin-sdk/declarative-v1/web/invocation-context.mjs'

export interface FeatureActivationRequest { ref: FeatureRef; surface: FeatureInvocationSurface; context?: InvocationTextContext; quickResult?: NodeCommandOptions }
export interface FeatureActivationOutcome { readonly status: 'opened' | 'completed' | 'cancelled'; readonly result?: FeatureTextResult; readonly externalOpened?: true; readonly isSourceCurrent?: () => boolean }

export class FeaturePresentationRouter {
  constructor(private readonly windows: PluginWindowManager, private readonly commands?: NodeCommandExecutionAdapter) {}
  async present(authority: WebFeatureAuthority, context?: InvocationTextContext, options?: NodeCommandOptions): Promise<FeatureActivationOutcome> {
    if (!isWebFeatureAuthority(authority) || !authority.isCurrent()) throw new Error('Feature authority unavailable.')
    const manifest = authority.snapshot.manifest
    if (manifest.manifestVersion !== 3) throw Object.assign(new Error('Independent Feature presentation requires Manifest v3.'), { code: 'UNSUPPORTED_FEATURE_KIND' })
    const feature = manifest.features.find(item => item.id === authority.featureId)
    if (!feature) throw new Error('Feature not found.')
    if (context) {
      const { ageMs: _age, ...payload } = context
      if (!acceptsInvocationContext(feature.acceptedContexts, validateInvocationContext(payload))) {
        if (feature.acceptedContexts.length === 0 || feature.acceptedContexts.some(rule => rule.type === 'none')) context = undefined
        else throw Object.assign(new Error('The Feature does not accept this selection.'), { code: 'FEATURE_UNAVAILABLE' })
      }
    }
    if (feature.presentation?.type === 'command') {
      if (!this.commands || manifest.runtime.kind !== 'node' || feature.entry.kind !== 'node-command') {
        authority.revoke()
        throw Object.assign(new Error('This runtime/entry combination does not support windowless command execution.'), { code: 'UNSUPPORTED_FEATURE_KIND' })
      }
      return this.commands.execute(authority, context, options)
    }
    if (options?.resultTarget) throw Object.assign(new Error('Quick Result requires a Node Command.'), { code: 'UNSUPPORTED_FEATURE_KIND' })
    await this.windows.open(authority, context)
    return { status: 'opened' }
  }
}

/** Every entry surface reaches the same live authorization and presentation path. */
export class FeatureActivationService {
  constructor(private readonly authorize: (ref: FeatureRef, dispatch: (authority: WebFeatureAuthority, isSourceCurrent: () => boolean) => Promise<void>) => Promise<{ completion: Promise<void> }>,
    private readonly router: FeaturePresentationRouter, private readonly onOwnershipChanged: (delta: number) => void = () => {}) {}
  async activate(request: FeatureActivationRequest): Promise<FeatureActivationOutcome> {
    if (!isFeatureRef(request.ref) || !['manager', 'launcher', 'super-panel'].includes(request.surface)) throw new TypeError('Invalid Feature activation.')
    const receivedAt = Date.now()
    this.onOwnershipChanged(1)
    try {
      let outcome: FeatureActivationOutcome | undefined
      const ticket = await this.authorize(request.ref, async (authority, isSourceCurrent) => {
        if (Date.now() - receivedAt >= 30_000) throw Object.assign(new Error('Feature activation expired before execution.'), { code: 'STALE_REQUEST' })
        outcome = await this.router.present(authority, request.context
          ? { ...request.context, ageMs: request.context.ageMs + Math.max(0, Date.now() - receivedAt) } : undefined, request.quickResult)
        if (request.quickResult && outcome.result) {
          if (!isSourceCurrent?.() || request.quickResult.signal?.aborted) throw Object.assign(new Error('Feature source changed before result delivery.'), { code: 'FEATURE_UNAVAILABLE' })
          outcome = { ...outcome, isSourceCurrent }
        }
      })
      await ticket.completion
      if (!outcome) throw new Error('Feature activation did not produce a result.')
      return outcome
    } finally { this.onOwnershipChanged(-1) }
  }
  async activateAuthorized(authority: WebFeatureAuthority, surface: FeatureInvocationSurface, context?: InvocationTextContext,
    options?: NodeCommandOptions, isSourceCurrent?: () => boolean): Promise<FeatureActivationOutcome> {
    if (!['manager', 'launcher', 'super-panel'].includes(surface)) return Promise.reject(new TypeError('Invalid invocation surface.'))
    this.onOwnershipChanged(1)
    try {
      const outcome = await this.router.present(authority, context, options)
      if (options?.resultTarget && outcome.result) {
        if (!isSourceCurrent?.() || options.signal?.aborted) throw Object.assign(new Error('Development source changed.'), { code: 'FEATURE_UNAVAILABLE' })
        return { ...outcome, isSourceCurrent }
      }
      return outcome
    }
    finally { this.onOwnershipChanged(-1) }
  }
}
