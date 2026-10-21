import { boundedString, opaqueKey, record, validateSettingValue } from '../runtime/manifest-v1.mjs'

export const CONFIGURATION_LIMITS = Object.freeze({ settings: 64, valuesBytes: 524288, schemaVersion: 2147483647 })
function array(value, max) { if (!Array.isArray(value) || value.length > max) throw new TypeError('Invalid configuration array'); return value }
function unicodeScalar(value) {
  if (typeof value !== 'string') return value
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i)
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError('Invalid configuration string')
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new TypeError('Invalid configuration string')
  }
  return value
}

/** Closed preference values only. Shared by the package validator and Host store. */
export function resolveConfigurationValues(configuration, saved) {
  record(saved, [], configuration.settings.map(setting => setting.key))
  const result = {}
  for (const setting of configuration.settings) result[setting.key] = unicodeScalar(validateSettingValue(setting, Object.hasOwn(saved, setting.key) ? saved[setting.key] : setting.default))
  if (new TextEncoder().encode(JSON.stringify(result)).length > CONFIGURATION_LIMITS.valuesBytes) throw Object.assign(new Error('Configuration exceeds quota'), { code: 'STORAGE_LIMIT' })
  return result
}

export function validateConfiguration(value) {
  const descriptor = record(value, ['schemaVersion', 'settings'])
  if (!Number.isInteger(descriptor.schemaVersion) || descriptor.schemaVersion < 1 || descriptor.schemaVersion > CONFIGURATION_LIMITS.schemaVersion) throw new TypeError('Invalid configuration schema version')
  const seen = new Set()
  const settings = array(descriptor.settings, CONFIGURATION_LIMITS.settings).map(value => {
    const type = value?.type
    const fields = type === 'text' ? ['minLength', 'maxLength'] : type === 'enum' ? ['options'] : type === 'number' ? ['min', 'max'] : type === 'boolean' ? [] : null
    if (!fields) throw new TypeError('Invalid configuration field type')
    const setting = record(value, ['key', 'label', 'type', 'default', ...fields])
    opaqueKey(setting.key); unicodeScalar(boundedString(setting.label, 128))
    if (seen.has(setting.key)) throw new TypeError('Duplicate configuration key')
    seen.add(setting.key)
    if (type === 'text' && (!Number.isInteger(setting.minLength) || !Number.isInteger(setting.maxLength) || setting.minLength < 0 || setting.maxLength > 50000 || setting.minLength > setting.maxLength)) throw new TypeError('Invalid text bounds')
    if (type === 'enum') {
      const options = array(setting.options, 64)
      if (!options.length || new Set(options).size !== options.length) throw new TypeError('Invalid enum options')
      for (const option of options) unicodeScalar(boundedString(option, 128))
    }
    if (type === 'number' && (typeof setting.min !== 'number' || typeof setting.max !== 'number' || !Number.isFinite(setting.min) || !Number.isFinite(setting.max) || setting.min > setting.max)) throw new TypeError('Invalid number bounds')
    validateSettingValue(setting, setting.default)
    return Object.freeze({ ...setting, ...(type === 'enum' ? { options: Object.freeze([...setting.options]) } : {}) })
  })
  const result = Object.freeze({ schemaVersion: descriptor.schemaVersion, settings: Object.freeze(settings) })
  resolveConfigurationValues(result, {})
  return result
}
