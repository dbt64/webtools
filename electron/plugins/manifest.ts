import type { PluginCapability, PluginJson, PluginManifest, PluginSetting } from '../../src/shared/plugin-contracts.ts'
import * as canonical from '../../plugin-sdk/declarative-v1/runtime/manifest-v1.mjs'
import { fail } from './errors.ts'

declare const validated: unique symbol
export type ValidatedManifest = PluginManifest & { readonly [validated]: true }
export const LIMITS = canonical.LIMITS_V1
export const pluginIdPattern = canonical.pluginIdPattern

function adapt<T>(operation: () => T): T {
  try { return operation() }
  catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    if (typeof code === 'string' && ['INVALID_INPUT', 'INVALID_MANIFEST', 'INCOMPATIBLE_PLUGIN', 'INVALID_PACKAGE'].includes(code)) return fail(code)
    return fail('INVALID_INPUT')
  }
}

export function validPluginId(value: unknown): value is string { return canonical.validPluginId(value) }
export function parseStrictJson(source: string, maxDepth = LIMITS.depth): PluginJson { return adapt(() => canonical.parseStrictJson(source, maxDepth)) }
export function record(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> { return adapt(() => canonical.record(value, required, optional)) }
export function boundedString(value: unknown, max: number, min = 1): string { return adapt(() => canonical.boundedString(value, max, min)) }
export function opaqueKey(value: unknown): string { return adapt(() => canonical.opaqueKey(value)) }
export function httpsLiteral(value: unknown): string { return adapt(() => canonical.httpsLiteral(value)) }
export function versionParts(version: unknown): RegExpExecArray { return adapt(() => canonical.versionParts(version)) }
export function compareVersions(a: string, b: string): number { return adapt(() => canonical.compareVersions(a, b)) }
export function safeAssetPath(value: unknown): string { return adapt(() => canonical.safeAssetPath(value)) }
export function validateArchivePath(path: string): void { adapt(() => canonical.validateArchivePath(path)) }
export function validateSettingValue(setting: PluginSetting, value: unknown): string | boolean | number { return adapt(() => canonical.validateSettingValue(setting, value)) }
export function parseManifest(bytes: Uint8Array, hostVersion: string): ValidatedManifest { return adapt(() => canonical.parseManifest(bytes, hostVersion)) as unknown as ValidatedManifest }
