/** Feature identity is distinct from Plugin catalog identity and Manifest v1. */
export interface FeatureRef {
  readonly pluginId: string
  readonly featureId: string
}

export const FEATURE_ID_MAX_SCALARS = 64
export const FEATURE_TITLE_MAX_SCALARS = 80
export const FEATURE_COMMANDS_MAX_COUNT = 8
export const FEATURE_COMMAND_MAX_SCALARS = 48
export const FEATURE_PROJECTION_VERSION = 2
export const FEATURE_PROJECTION_MAX_PER_PLUGIN = 16
export const FEATURE_PROJECTION_MAX_FEATURES = 2000
export const FEATURE_PROJECTION_MAX_BYTES = 3 * 1024 * 1024

export type FeatureProjectionIconToken = 'plugin' | 'sparkles' | 'document' | 'globe' | 'translate'
export type FeatureProjectionKind = 'declarative-compatibility' | 'built-in'
export type FeatureProjectionContextSource = 'launcher-input' | 'clipboard'

export interface FeatureProjectionAcceptedContextV2 {
  readonly type: 'text'
  readonly sources: readonly FeatureProjectionContextSource[]
}

export interface FeatureProjectionRowV2 {
  readonly ref: FeatureRef
  readonly pluginName: string
  readonly title: string
  readonly commands: readonly string[]
  readonly acceptedContexts: readonly FeatureProjectionAcceptedContextV2[]
  readonly iconToken: FeatureProjectionIconToken
  readonly featureKind: FeatureProjectionKind
  readonly group: 'plugin-features'
}

export interface FeatureProjectionV2 {
  readonly projectionVersion: 2
  readonly hostSessionId: string
  readonly revision: number
  readonly generatedAtUnixMs: number
  readonly features: readonly FeatureProjectionRowV2[]
}

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

const projectionIconTokens = new Set<FeatureProjectionIconToken>(['plugin', 'sparkles', 'document', 'globe', 'translate'])
const projectionKinds = new Set<FeatureProjectionKind>(['declarative-compatibility', 'built-in'])
const projectionContextSources = new Set<FeatureProjectionContextSource>(['launcher-input', 'clipboard'])
const hostSessionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function hasExactDataFields(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    const keys = Reflect.ownKeys(value)
    if (keys.length !== expected.length || keys.some(key => typeof key !== 'string' || !expected.includes(key))) return false
    return expected.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return Boolean(descriptor?.enumerable && 'value' in descriptor)
    })
  } catch {
    return false
  }
}

function hasOnlyArrayValues(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return false
    const keys = Reflect.ownKeys(value)
    if (keys.some(key => typeof key === 'symbol')) return false
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor?.enumerable || !('value' in descriptor)) return false
    }
    return keys.length === value.length + 1 && keys.includes('length')
  } catch {
    return false
  }
}

function readProjectionContext(value: unknown): FeatureProjectionAcceptedContextV2 | null {
  if (!hasExactDataFields(value, ['type', 'sources']) || value.type !== 'text' || !hasOnlyArrayValues(value.sources)) return null
  if (value.sources.length < 1 || value.sources.length > projectionContextSources.size) return null
  const sources: FeatureProjectionContextSource[] = []
  const seen = new Set<string>()
  for (const source of value.sources) {
    if (typeof source !== 'string' || !projectionContextSources.has(source as FeatureProjectionContextSource) || seen.has(source)) return null
    seen.add(source)
    sources.push(source as FeatureProjectionContextSource)
  }
  sources.sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
  return { type: 'text', sources }
}

function readProjectionRow(value: unknown): FeatureProjectionRowV2 | null {
  if (!hasExactDataFields(value, ['ref', 'pluginName', 'title', 'commands', 'acceptedContexts', 'iconToken', 'featureKind', 'group'])) return null
  if (!isFeatureRef(value.ref)) return null
  const pluginName = normalizeFeatureText(value.pluginName, FEATURE_TITLE_MAX_SCALARS)
  const title = normalizeFeatureText(value.title, FEATURE_TITLE_MAX_SCALARS)
  if (!pluginName || !title || typeof value.iconToken !== 'string' || !projectionIconTokens.has(value.iconToken as FeatureProjectionIconToken)) return null
  if (typeof value.featureKind !== 'string' || !projectionKinds.has(value.featureKind as FeatureProjectionKind) || value.group !== 'plugin-features') return null
  if (!hasOnlyArrayValues(value.commands) || value.commands.length > FEATURE_COMMANDS_MAX_COUNT) return null
  const commands: string[] = []
  const commandKeys = new Set<string>()
  for (const input of value.commands) {
    const command = normalizeFeatureText(input, FEATURE_COMMAND_MAX_SCALARS)
    if (!command) return null
    const key = command.toLocaleLowerCase('en-US')
    if (commandKeys.has(key)) return null
    commandKeys.add(key)
    commands.push(command)
  }
  if (!hasOnlyArrayValues(value.acceptedContexts) || value.acceptedContexts.length > 1) return null
  const acceptedContexts: FeatureProjectionAcceptedContextV2[] = []
  for (const context of value.acceptedContexts) {
    const parsed = readProjectionContext(context)
    if (!parsed) return null
    acceptedContexts.push(parsed)
  }

  return {
    ref: { pluginId: value.ref.pluginId, featureId: value.ref.featureId },
    pluginName,
    title,
    commands,
    acceptedContexts,
    iconToken: value.iconToken as FeatureProjectionIconToken,
    featureKind: value.featureKind as FeatureProjectionKind,
    group: 'plugin-features',
  }
}

/** Closed, bounded parser for the Main/Native Feature Projection v2 payload. */
export function parseFeatureProjectionV2(value: unknown): FeatureProjectionV2 | null {
  if (!hasExactDataFields(value, ['projectionVersion', 'hostSessionId', 'revision', 'generatedAtUnixMs', 'features'])) return null
  if (value.projectionVersion !== FEATURE_PROJECTION_VERSION
    || typeof value.hostSessionId !== 'string'
    || !hostSessionPattern.test(value.hostSessionId)
    || !Number.isSafeInteger(value.revision)
    || (value.revision as number) < 1
    || !Number.isSafeInteger(value.generatedAtUnixMs)
    || (value.generatedAtUnixMs as number) < 0
    || !hasOnlyArrayValues(value.features)
    || value.features.length > FEATURE_PROJECTION_MAX_FEATURES) return null

  const features: FeatureProjectionRowV2[] = []
  const featureRefs = new Set<string>()
  const perPlugin = new Map<string, number>()
  for (const input of value.features) {
    const row = readProjectionRow(input)
    if (!row) return null
    const identity = `${row.ref.pluginId}\u0000${row.ref.featureId}`
    if (featureRefs.has(identity)) return null
    featureRefs.add(identity)
    const pluginCount = (perPlugin.get(row.ref.pluginId) ?? 0) + 1
    if (pluginCount > FEATURE_PROJECTION_MAX_PER_PLUGIN) return null
    perPlugin.set(row.ref.pluginId, pluginCount)
    features.push(row)
  }

  const projection: FeatureProjectionV2 = {
    projectionVersion: FEATURE_PROJECTION_VERSION,
    hostSessionId: value.hostSessionId,
    revision: value.revision as number,
    generatedAtUnixMs: value.generatedAtUnixMs as number,
    features,
  }
  if (new TextEncoder().encode(JSON.stringify(projection)).byteLength > FEATURE_PROJECTION_MAX_BYTES) return null
  return projection
}

/** Stable content identity; diagnostics and session/revision sequencing are excluded. */
export function featureProjectionContentIdentity(value: FeatureProjectionV2): string {
  return JSON.stringify(value.features)
}
