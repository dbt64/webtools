import type { ValidatedManifest } from './manifest.ts'
import { FEATURE_COMMAND_MAX_SCALARS, isFeatureRef, normalizeFeatureText } from '../../src/shared/feature-contracts.ts'
import type { DeclarativeCompatibilityFeature } from './feature-contracts.ts'

export const DECLARATIVE_V1_FEATURE_ID = 'legacy-manager-page'

/**
 * Produces one read-time compatibility Feature from validated Manifest v1 metadata.
 * This adapter deliberately does not decide whether the plugin is enabled or granted.
 */
export function adaptDeclarativeV1Feature(manifest: ValidatedManifest): DeclarativeCompatibilityFeature | null {
  if (!manifest || typeof manifest !== 'object') return null

  const ref = { pluginId: manifest.id, featureId: DECLARATIVE_V1_FEATURE_ID }
  if (!isFeatureRef(ref)) return null

  const pluginName = normalizeFeatureText(manifest.name, 80)
  const pageId = manifest.entry?.pageId
  const title = normalizeFeatureText(manifest.entry?.label, 80)
  if (!title || typeof pageId !== 'string' || pageId.length < 1 || pageId.length > 64) return null
  if (!Array.isArray(manifest.requestedCapabilities) || !manifest.requestedCapabilities.includes('manager.page')) return null
  if (!Array.isArray(manifest.pages) || !manifest.pages.some(page => page?.id === pageId)) return null

  const commands: string[] = []
  const seen = new Set<string>()
  for (const candidate of [pluginName, title]) {
    const command = normalizeFeatureText(candidate, FEATURE_COMMAND_MAX_SCALARS)
    if (!command) continue
    const key = command.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    if (commands.length < 8) commands.push(command)
  }

  return {
    ref,
    sourceKind: 'declarative',
    title,
    commands,
    icon: 'plugin',
    requiredCapabilities: ['manager.page'],
    acceptedContexts: [],
    resolvedEntry: { kind: 'declarative-compatibility', pageId },
  }
}
