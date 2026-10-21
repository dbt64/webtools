import type { AppData } from '../../src/shared/domain.ts'
import {
  createDefaultTranslation2WorkspaceSettings,
  validateTranslation2WorkspaceSettings,
  type Translation2WorkspaceSettings,
  type Translation2MachineServiceSettings,
} from '../../src/shared/translation2-contracts.ts'

interface Translation2SettingsStore {
  snapshot(): AppData
  update(mutator: (current: AppData) => AppData): Promise<AppData>
}

/** Main-owned serialized settings boundary for the built-in Translation 2.0 plugin. */
export class Translation2SettingsService {
  constructor(private readonly store: Translation2SettingsStore) {}

  get(): Translation2WorkspaceSettings {
    return structuredClone(this.store.snapshot().settings.translation2)
  }

  async update(value: unknown): Promise<Translation2WorkspaceSettings> {
    if (!validateTranslation2WorkspaceSettings(value)) throw new Error('Translation 2.0 设置无效。')
    const requested = structuredClone(value)
    const result = await this.store.update(data => ({
      ...data,
      settings: { ...data.settings, translation2: requested },
    }))
    return structuredClone(result.settings.translation2)
  }

  async restoreDefaults(): Promise<Translation2WorkspaceSettings> {
    const result = await this.store.update(data => {
      const defaults = createDefaultTranslation2WorkspaceSettings()
      const userServices = data.settings.translation2.machineServices
        .filter(service => !service.builtIn)
        .map(service => ({ ...service }))
      const importedDefinitions = data.settings.translation2.importedDefinitions.map(definition => structuredClone(definition))
      return {
        ...data,
        settings: {
          ...data.settings,
          translation2: { ...defaults, machineServices: [...defaults.machineServices, ...userServices], importedDefinitions },
        },
      }
    })
    return structuredClone(result.settings.translation2)
  }

  /** Merge only the tested instance into the latest serialized workspace. */
  async setMachineTestStatus(expected: Translation2MachineServiceSettings, status: 'passed' | 'failed') {
    let applied = false
    const result = await this.store.update(data => {
      const current = data.settings.translation2
      const service = current.machineServices.find(item => item.id === expected.id)
      if (!service || JSON.stringify(service) !== JSON.stringify(expected)) return data
      applied = true
      return { ...data, settings: { ...data.settings, translation2: {
        ...current, machineServices: current.machineServices.map(item => item.id === expected.id ? { ...item, testStatus: status } : item),
      } } }
    })
    return { applied, settings: structuredClone(result.settings.translation2) }
  }
}
