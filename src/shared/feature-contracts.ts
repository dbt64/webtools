/** Feature identity is distinct from Plugin catalog identity and Manifest v1. */
export interface FeatureRef {
  readonly pluginId: string
  readonly featureId: string
}

export const FEATURE_ID_MAX_SCALARS = 64
export const FEATURE_TITLE_MAX_SCALARS = 80
export const FEATURE_COMMANDS_MAX_COUNT = 8
export const FEATURE_COMMAND_MAX_SCALARS = 48

const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const featureIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const forbiddenPluginIds = new Set(['__proto__', 'prototype', 'constructor'])

export function isFeatureId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= FEATURE_ID_MAX_SCALARS
    && featureIdPattern.test(value)
}

function isPluginId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 3
    && value.length <= 128
    && pluginIdPattern.test(value)
    && !forbiddenPluginIds.has(value)
}

/** Validates the exact, closed composite identity shape used on Feature boundaries. */
export function isFeatureRef(value: unknown): value is FeatureRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false

  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false

    const keys = Reflect.ownKeys(value)
    if (keys.length !== 2 || !keys.includes('pluginId') || !keys.includes('featureId')) return false

    const pluginId = Object.getOwnPropertyDescriptor(value, 'pluginId')
    const featureId = Object.getOwnPropertyDescriptor(value, 'featureId')
    if (!pluginId?.enumerable || !featureId?.enumerable || !('value' in pluginId) || !('value' in featureId)) return false

    return isPluginId(pluginId.value) && isFeatureId(featureId.value)
  } catch {
    return false
  }
}

/** NFC-normalizes and collapses whitespace, then enforces a Unicode scalar-value limit. */
export function normalizeFeatureText(value: unknown, maxScalars: number): string | null {
  if (typeof value !== 'string' || !Number.isInteger(maxScalars) || maxScalars < 1 || maxScalars > FEATURE_TITLE_MAX_SCALARS) return null

  for (const character of value) {
    const scalar = character.codePointAt(0)!
    if (scalar >= 0xd800 && scalar <= 0xdfff) return null
  }

  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ')
  if (!normalized) return null

  let scalarCount = 0
  for (const _character of normalized) {
    scalarCount += 1
    if (scalarCount > maxScalars) return null
  }

  return normalized
}
