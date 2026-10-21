import { randomUUID } from 'node:crypto'
import {
  parseTranslation2ImportedApiDefinition,
  type Translation2ImportedApiDefinition,
  type Translation2WorkspaceSettings,
} from '../../src/shared/translation2-contracts.ts'
import type { SecretStorePort } from './ai-credentials.ts'
import type { Translation2SettingsService } from './translation2-settings.ts'
import type { Translation2ImportedApiExecutor } from './translation2-imported-api.ts'
import { Translation2DeepLAdapter } from './translation2-deepl.ts'

interface SaveInput {
  definition: unknown
  name: string
  secret: string
}

interface UpdateInput {
  name?: string
  enabled?: boolean
  secret?: string
}

const secretKey = (instanceId: string): string => `translation2-${instanceId.slice('imported-'.length)}`

function validName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 80
}

export class Translation2ImportedServiceManager {
  private readonly settings: Pick<Translation2SettingsService, 'get' | 'update' | 'setMachineTestStatus'>
  private readonly secrets: Pick<SecretStorePort, 'getSecret' | 'setSecret' | 'deleteSecret'>
  private readonly executor: Pick<Translation2ImportedApiExecutor, 'translate'>
  private readonly createId: () => string
  private readonly deepl: Translation2DeepLAdapter

  constructor(deps: {
    settings: Pick<Translation2SettingsService, 'get' | 'update' | 'setMachineTestStatus'>
    secrets: Pick<SecretStorePort, 'getSecret' | 'setSecret' | 'deleteSecret'>
    executor: Pick<Translation2ImportedApiExecutor, 'translate'>
    createId?: () => string
    deepl?: Translation2DeepLAdapter
  }) {
    this.settings = deps.settings
    this.secrets = deps.secrets
    this.executor = deps.executor
    this.createId = deps.createId ?? randomUUID
    this.deepl = deps.deepl ?? new Translation2DeepLAdapter()
  }

  async saveDeepL(value: { name: string; secret: string; apiPlan: 'free' | 'pro' }): Promise<Translation2WorkspaceSettings> {
    if (!validName(value.name) || !['free', 'pro'].includes(value.apiPlan) || typeof value.secret !== 'string' || !value.secret.trim() || value.secret.length > 4096 || /[\r\n]/.test(value.secret)) throw new Error('DeepL 服务配置无效。')
    const instanceId = `imported-${this.createId()}`
    const current = this.settings.get()
    await this.secrets.setSecret(secretKey(instanceId), value.secret.trim())
    try { return await this.settings.update({ ...current, selectedService: { kind: 'machine', instanceId },
      machineServices: [...current.machineServices, { id: instanceId, name: value.name.trim(), adapterId: 'deepl', enabled: true, builtIn: false, apiPlan: value.apiPlan, testStatus: 'untested' }] }) }
    catch (error) { await this.secrets.deleteSecret(secretKey(instanceId)); throw error }
  }

  async testDeepLDraft(value: { secret: string; apiPlan: 'free' | 'pro' }) {
    return { translation: await this.deepl.translate({ ...value, text: 'Hello', sourceLanguage: 'auto', targetLanguage: 'zh-CN', signal: new AbortController().signal }) }
  }

  parseDefinition(value: unknown): Translation2ImportedApiDefinition {
    const definition = parseTranslation2ImportedApiDefinition(value)
    if (!definition) throw new Error('Imported translation API definition is invalid.')
    return definition
  }

  async testDraft(value: { definition: unknown; secret: string }): Promise<{ translation: string }> {
    const definition = this.parseDefinition(value.definition)
    const secret = this.validateSecret(definition, value.secret)
    const translation = await this.executor.translate({
      definition, secret, text: 'Hello', sourceLanguage: 'auto', targetLanguage: 'zh-CN', signal: new AbortController().signal,
    })
    return { translation }
  }

  async save(value: SaveInput): Promise<Translation2WorkspaceSettings> {
    const definition = this.parseDefinition(value.definition)
    if (!validName(value.name)) throw new Error('Imported translation service name is invalid.')
    const secret = this.validateSecret(definition, value.secret)
    const current = this.settings.get()
    const existingDefinition = current.importedDefinitions.find(item => item.id === definition.id)
    if (existingDefinition && JSON.stringify(existingDefinition) !== JSON.stringify(definition)) {
      throw new Error('An imported definition with this ID already exists.')
    }
    const instanceId = `imported-${this.createId()}`
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(instanceId)) throw new Error('Imported service identity is invalid.')
    if (secret !== null) await this.secrets.setSecret(secretKey(instanceId), secret)
    const next: Translation2WorkspaceSettings = {
      ...current,
      selectedService: { kind: 'machine', instanceId },
      machineServices: [...current.machineServices, {
        id: instanceId, name: value.name.trim(), adapterId: 'imported', enabled: true, builtIn: false,
        testStatus: 'untested', definitionId: definition.id,
      }],
      importedDefinitions: existingDefinition ? current.importedDefinitions : [...current.importedDefinitions, definition],
    }
    try { return await this.settings.update(next) }
    catch (error) {
      if (secret !== null) await this.secrets.deleteSecret(secretKey(instanceId)).catch(() => undefined)
      throw error
    }
  }

  async update(instanceId: string, value: UpdateInput): Promise<Translation2WorkspaceSettings> {
    const current = this.settings.get()
    const service = this.requireImported(current, instanceId)
    if (value.name !== undefined && !validName(value.name)) throw new Error('Imported translation service name is invalid.')
    if (value.enabled !== undefined && typeof value.enabled !== 'boolean') throw new Error('Imported translation service state is invalid.')
    if (value.secret !== undefined) {
      const secret = service.adapterId === 'deepl' ? this.validateSecret({ auth: { kind: 'bearer' } } as Translation2ImportedApiDefinition, value.secret) : this.validateSecret(this.definitionFor(current, service.definitionId!), value.secret)
      if (secret === null) await this.secrets.deleteSecret(secretKey(instanceId))
      else await this.secrets.setSecret(secretKey(instanceId), secret)
    }
    const next = structuredClone(current)
    const target = next.machineServices.find(item => item.id === instanceId)!
    if (value.name !== undefined) target.name = value.name.trim()
    if (value.enabled !== undefined) target.enabled = value.enabled
    target.testStatus = 'untested'
    target.revision = (service.revision ?? 0) + 1
    if (!target.enabled && next.selectedService.kind === 'machine' && next.selectedService.instanceId === instanceId) {
      next.selectedService = { kind: 'machine', instanceId: 'builtin.mymemory' }
    }
    return this.settings.update(next)
  }

  async test(instanceId: string): Promise<{ translation: string; settings: Translation2WorkspaceSettings }> {
    const current = this.settings.get()
    const service = this.requireImported(current, instanceId)
    const secret = await this.secrets.getSecret(secretKey(instanceId))
    let translation: string
    try {
      translation = await this.run(current, service, secret, { text: 'Hello', sourceLanguage: 'auto', targetLanguage: 'zh-CN', signal: new AbortController().signal })
    } catch (error) {
      await this.settings.setMachineTestStatus(service, 'failed')
      throw error
    }
    const saved = await this.settings.setMachineTestStatus(service, 'passed')
    if (!saved.applied) throw new Error('服务已更改或删除，请重新测试。')
    return { translation, settings: saved.settings }
  }

  async delete(instanceId: string): Promise<Translation2WorkspaceSettings> {
    const current = this.settings.get()
    const service = this.requireImported(current, instanceId)
    const next = structuredClone(current)
    next.machineServices = next.machineServices.filter(item => item.id !== instanceId)
    if (next.selectedService.kind === 'machine' && next.selectedService.instanceId === instanceId) {
      next.selectedService = { kind: 'machine', instanceId: 'builtin.mymemory' }
    }
    const definitionId = service.definitionId!
    if (!next.machineServices.some(item => item.definitionId === definitionId)) {
      next.importedDefinitions = next.importedDefinitions.filter(item => item.id !== definitionId)
    }
    const saved = await this.settings.update(next)
    await this.secrets.deleteSecret(secretKey(instanceId))
    return saved
  }

  async credentialStatus(settings = this.settings.get()): Promise<Record<string, boolean>> {
    const result: Record<string, boolean> = { 'builtin.mymemory': true }
    await Promise.all(settings.machineServices.filter(item => item.adapterId === 'imported' || item.adapterId === 'deepl').map(async service => {
      result[service.id] = service.adapterId === 'imported' && this.definitionFor(settings, service.definitionId!).auth.kind === 'none' || (await this.secrets.getSecret(secretKey(service.id))) !== null
    }))
    return result
  }

  async execute(instanceId: string, input: { text: string; sourceLanguage: 'auto' | string; targetLanguage: string; signal: AbortSignal }): Promise<string> {
    const current = this.settings.get()
    const service = this.requireImported(current, instanceId)
    if (!service.enabled) throw new Error('Imported translation service is disabled.')
    const secret = await this.secrets.getSecret(secretKey(instanceId))
    return this.run(current, service, secret, input)
  }

  private run(settings: Translation2WorkspaceSettings, service: Translation2WorkspaceSettings['machineServices'][number], secret: string | null, input: { text: string; sourceLanguage: string; targetLanguage: string; signal: AbortSignal }) {
    if (service.adapterId === 'deepl') return this.deepl.translate({ ...input, apiPlan: service.apiPlan ?? 'free', secret } as Parameters<Translation2DeepLAdapter['translate']>[0])
    return this.executor.translate({ definition: this.definitionFor(settings, service.definitionId!), secret, ...input } as Parameters<Translation2ImportedApiExecutor['translate']>[0])
  }

  private validateSecret(definition: Translation2ImportedApiDefinition, value: string): string | null {
    if (definition.auth.kind === 'none') return null
    if (typeof value !== 'string' || !value.trim() || value.length > 4096) throw new Error('Imported translation API credential is invalid.')
    return value
  }

  private requireImported(settings: Translation2WorkspaceSettings, instanceId: string) {
    const service = settings.machineServices.find(item => item.id === instanceId)
    if (!service) throw new Error('Imported translation service was not found.')
    if (service.builtIn || !['imported', 'deepl'].includes(service.adapterId)) throw new Error('Built-in translation services cannot be changed by this operation.')
    return service
  }

  private definitionFor(settings: Translation2WorkspaceSettings, definitionId: string): Translation2ImportedApiDefinition {
    const definition = settings.importedDefinitions.find(item => item.id === definitionId)
    if (!definition) throw new Error('Imported translation API definition was not found.')
    return definition
  }

}
