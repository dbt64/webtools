export interface SuperPanelSettings {
  enabled: boolean
  mouseButton: 'middle' | 'xbutton1' | 'xbutton2'
  gesture: 'press' | 'hold'
  holdMilliseconds: number
  autoTranslationPreview: boolean
}
export interface SuperPanelSettingsStatus {
  settings: SuperPanelSettings
  triggerStatus: 'registered' | 'failed' | 'disabled'
  activeTrigger: SuperPanelSettings | null
  error: string | null
}
export const DEFAULT_SUPER_PANEL_SETTINGS: Readonly<SuperPanelSettings> = Object.freeze({
  enabled: true, mouseButton: 'middle', gesture: 'hold', holdMilliseconds: 600, autoTranslationPreview: false,
})
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
export function parseSuperPanelSettings(value: unknown): SuperPanelSettings | null {
  if (!record(value) || ![4, 5].includes(Object.keys(value).length)
    || !Object.keys(value).every(key => ['enabled', 'mouseButton', 'gesture', 'holdMilliseconds', 'autoTranslationPreview'].includes(key))
    || (Object.hasOwn(value, 'autoTranslationPreview') && typeof value.autoTranslationPreview !== 'boolean')
    || typeof value.enabled !== 'boolean' || typeof value.mouseButton !== 'string' || !['middle', 'xbutton1', 'xbutton2'].includes(value.mouseButton)
    || typeof value.gesture !== 'string' || !['press', 'hold'].includes(value.gesture)
    || typeof value.holdMilliseconds !== 'number' || !Number.isSafeInteger(value.holdMilliseconds)
    || value.holdMilliseconds < 300 || value.holdMilliseconds > 1500) return null
  return { enabled: value.enabled, mouseButton: value.mouseButton as SuperPanelSettings['mouseButton'],
    gesture: value.gesture as SuperPanelSettings['gesture'], holdMilliseconds: value.holdMilliseconds,
    autoTranslationPreview: value.autoTranslationPreview === true }
}
export function parseSuperPanelSettingsStatus(value: unknown): SuperPanelSettingsStatus | null {
  if (!record(value) || Object.keys(value).length !== 4
    || !Object.keys(value).every(key => ['settings', 'triggerStatus', 'activeTrigger', 'error'].includes(key))
    || typeof value.triggerStatus !== 'string' || !['registered', 'failed', 'disabled'].includes(value.triggerStatus)
    || (value.error !== null && (typeof value.error !== 'string' || value.error.length > 4096))) return null
  const settings = parseSuperPanelSettings(value.settings)
  const activeTrigger = value.activeTrigger === null ? null : parseSuperPanelSettings(value.activeTrigger)
  if (!settings || (value.activeTrigger !== null && !activeTrigger)
    || (value.triggerStatus === 'registered' && (!activeTrigger?.enabled))
    || (value.triggerStatus !== 'registered' && activeTrigger !== null)) return null
  return { settings, triggerStatus: value.triggerStatus as SuperPanelSettingsStatus['triggerStatus'], activeTrigger, error: value.error as string | null }
}
