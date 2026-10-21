export type ConfigurationValue = string | boolean | number
export type ConfigurationSetting = { key: string; label: string } & (
  { type: 'text'; minLength: number; maxLength: number; default: string } |
  { type: 'enum'; options: string[]; default: string } |
  { type: 'boolean'; default: boolean } |
  { type: 'number'; min: number; max: number; default: number }
)
export interface PluginConfiguration { readonly schemaVersion: number; readonly settings: readonly ConfigurationSetting[] }
export declare const CONFIGURATION_LIMITS: Readonly<{ settings: 64; valuesBytes: 524288; schemaVersion: 2147483647 }>
export declare function validateConfiguration(value: unknown): PluginConfiguration
export declare function resolveConfigurationValues(configuration: PluginConfiguration, saved: unknown): Record<string, ConfigurationValue>
