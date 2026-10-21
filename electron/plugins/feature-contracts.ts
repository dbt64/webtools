import type { PluginCapability } from '../../src/shared/plugin-contracts.ts'
import type { FeatureRef } from '../../src/shared/feature-contracts.ts'

export type FeatureIconToken = 'plugin' | 'translation'

interface ResolvedFeatureBase {
  readonly ref: FeatureRef
  readonly title: string
  readonly commands: readonly string[]
  readonly icon: FeatureIconToken
  readonly requiredCapabilities: readonly PluginCapability[]
  readonly acceptedContexts: readonly []
}

export interface DeclarativeCompatibilityFeature extends ResolvedFeatureBase {
  readonly sourceKind: 'declarative'
  readonly icon: 'plugin'
  readonly requiredCapabilities: readonly ['manager.page']
  readonly resolvedEntry: {
    readonly kind: 'declarative-compatibility'
    readonly pageId: string
  }
}

export interface BuiltInResolvedFeature extends ResolvedFeatureBase {
  readonly sourceKind: 'built-in'
  readonly resolvedEntry: {
    readonly kind: 'built-in'
    readonly key: 'translation'
  }
}

export interface RuntimeResolvedFeature {
  readonly ref: FeatureRef
  readonly sourceKind: 'runtime-v3'
  readonly title: string
  readonly description?: string
  readonly commands: readonly string[]
  readonly acceptedContexts: readonly import('../../src/shared/feature-contracts.ts').FeatureProjectionAcceptedContextV2[]
  readonly iconToken: import('../../src/shared/feature-contracts.ts').FeatureProjectionIconToken
  readonly iconDataUrl?: string
  readonly presentation: 'window' | 'command'
}
export type MainResolvedFeature = DeclarativeCompatibilityFeature | BuiltInResolvedFeature | RuntimeResolvedFeature

export interface DeclarativeFeatureCandidate {
  readonly pluginName: string
  readonly feature: DeclarativeCompatibilityFeature
}

/** Metadata identity only; enablement remains owned by BuiltinTranslationLifecycle. */
export const BUILTIN_TRANSLATION_FEATURE: BuiltInResolvedFeature = Object.freeze({
  ref: Object.freeze({ pluginId: 'webtools.translation', featureId: 'translate-text' }),
  sourceKind: 'built-in',
  title: '翻译',
  commands: Object.freeze(['Translate', 'Translation']),
  icon: 'translation',
  requiredCapabilities: Object.freeze([]),
  acceptedContexts: Object.freeze([] as const),
  resolvedEntry: Object.freeze({ kind: 'built-in', key: 'translation' }),
})
