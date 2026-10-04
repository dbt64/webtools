import type { PluginCapabilityV1, PluginManifestV1, PluginSettingV1 } from '../types.d.ts'
export type PluginJsonV1 = null | boolean | number | string | PluginJsonV1[] | { [key: string]: PluginJsonV1 }

declare const validated: unique symbol
export type ValidatedManifestV1 = PluginManifestV1 & { readonly [validated]: true }
export type ValidationCodeV1 = 'INVALID_INPUT' | 'INVALID_MANIFEST' | 'INCOMPATIBLE_PLUGIN' | 'INVALID_PACKAGE'
export declare class PluginValidationError extends Error {
  readonly code: ValidationCodeV1
  readonly path: string
  readonly suggestion: string
}
export declare function failValidation(code: ValidationCodeV1, path?: string): never
export declare const LIMITS_V1: Readonly<{ archive: number; entries: number; expanded: number; png: number; manifest: number; ratio: number; depth: number; pages: number; blocks: number; actions: number; settings: number; value: number; keys: number; data: number }>
export declare const MANIFEST_VERSION_V1: 1
export declare const API_MAJOR_V1: 1
export declare const CAPABILITIES_V1: readonly PluginCapabilityV1[]
export declare const BLOCK_TYPES_V1: readonly string[]
export declare const ACTION_TYPES_V1: readonly string[]
export declare const pluginIdPattern: RegExp
export declare function validPluginId(value: unknown): value is string
export declare const validPluginIdV1: typeof validPluginId
export declare function parseStrictJson(source: string, maxDepth?: number): PluginJsonV1
export declare const parseStrictJsonV1: typeof parseStrictJson
export declare function record(value: unknown, required: string[], optional?: string[]): Record<string, unknown>
export declare function boundedString(value: unknown, max: number, min?: number): string
export declare function opaqueKey(value: unknown): string
export declare function httpsLiteral(value: unknown): string
export declare function versionParts(version: unknown): RegExpExecArray
export declare function compareVersions(a: string, b: string): number
export declare function safeAssetPath(value: unknown): string
export declare const safeAssetPathV1: typeof safeAssetPath
export declare function validateArchivePath(path: string): void
export declare const validateArchivePathV1: typeof validateArchivePath
export declare function validateSettingValue(setting: PluginSettingV1, value: unknown): string | boolean | number
export declare function parseManifest(bytes: Uint8Array, hostVersion: string): ValidatedManifestV1
export declare const parseManifestV1: typeof parseManifest
export declare function crc32V1(bytes: Uint8Array, seed?: number): number
