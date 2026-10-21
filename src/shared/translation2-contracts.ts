import { isAIProviderId, isCredentialLikeAIValue, type AIProviderId } from './ai-config.ts'

export const TRANSLATION2_WEBSITE_PROVIDER_IDS = [
  'youdao', 'google', 'microsoft', 'tencent', 'sogou', 'deepl', 'caiyun', 'cnki',
] as const
export type Translation2WebsiteProviderId = typeof TRANSLATION2_WEBSITE_PROVIDER_IDS[number]
export type Translation2WebsiteReleaseStatus = 'verified' | 'unverified'

export interface Translation2WebsiteProviderDescriptor {
  id: Translation2WebsiteProviderId
  name: string
  releaseStatus: Translation2WebsiteReleaseStatus
}

export const TRANSLATION2_WEBSITE_PROVIDERS: readonly Translation2WebsiteProviderDescriptor[] = [
  { id: 'youdao', name: '有道', releaseStatus: 'unverified' },
  { id: 'google', name: 'Google', releaseStatus: 'verified' },
  { id: 'microsoft', name: 'Microsoft', releaseStatus: 'unverified' },
  { id: 'tencent', name: '腾讯', releaseStatus: 'unverified' },
  { id: 'sogou', name: '搜狗', releaseStatus: 'unverified' },
  { id: 'deepl', name: 'DeepL', releaseStatus: 'unverified' },
  { id: 'caiyun', name: '彩云', releaseStatus: 'unverified' },
  { id: 'cnki', name: 'CNKI', releaseStatus: 'unverified' },
]

export const DEFAULT_TRANSLATION2_WEBSITE_ORDER: Translation2WebsiteProviderId[] =
  TRANSLATION2_WEBSITE_PROVIDERS.map(provider => provider.id)

export const TRANSLATION2_MACHINE_ADAPTER_IDS = ['mymemory', 'deepl', 'google-cloud', 'microsoft-translator', 'imported'] as const
export type Translation2MachineAdapterId = typeof TRANSLATION2_MACHINE_ADAPTER_IDS[number]

export type Translation2DefinitionScalar = string | number | boolean

export interface Translation2ImportedApiDefinition {
  schemaVersion: 1
  id: string
  name: string
  endpoint: string
  method: 'POST'
  auth: { kind: 'none' } | { kind: 'bearer' } | { kind: 'header'; name: string }
  request: {
    contentType: 'json' | 'form'
    sourceField: string
    sourceLanguageField?: string
    targetLanguageField: string
    staticFields?: Record<string, Translation2DefinitionScalar>
  }
  response: { kind: 'json'; textPath: string[] } | { kind: 'text' }
  timeoutMs: number
}

export interface Translation2MachineServiceSettings {
  id: string
  name: string
  adapterId: Translation2MachineAdapterId
  enabled: boolean
  builtIn: boolean
  testStatus: 'untested' | 'passed' | 'failed'
  definitionId?: string
  apiPlan?: 'free' | 'pro'
  revision?: number
}

export type Translation2TabSelection =
  | { kind: 'webtools' }
  | { kind: 'website'; providerId: Translation2WebsiteProviderId }

export type Translation2ServiceSelection =
  | { kind: 'machine'; instanceId: string }
  | { kind: 'ai'; providerId: AIProviderId }

export interface Translation2WorkspaceSettings {
  activeTab: Translation2TabSelection
  websiteOrder: Translation2WebsiteProviderId[]
  visibleWebsiteIds: Translation2WebsiteProviderId[]
  selectedService: Translation2ServiceSelection
  machineServices: Translation2MachineServiceSettings[]
  importedDefinitions: Translation2ImportedApiDefinition[]
}

const BUILTIN_MYMEMORY: Translation2MachineServiceSettings = {
  id: 'builtin.mymemory',
  name: 'MyMemory 免费翻译',
  adapterId: 'mymemory',
  enabled: true,
  builtIn: true,
  testStatus: 'passed',
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/i
const MAX_SERVICE_NAME = 80
const FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/
const FORBIDDEN_AUTH_HEADERS = new Set(['connection', 'content-length', 'cookie', 'host', 'origin', 'referer', 'transfer-encoding'])
const CREDENTIAL_FIELD = /^(?:api[-_]?key|key|token|access[-_]?token|secret|password|authorization|auth[-_]?key)$/i

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional])
  return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => allowed.has(key))
}

function isWebsiteProviderId(value: unknown): value is Translation2WebsiteProviderId {
  return typeof value === 'string' && (TRANSLATION2_WEBSITE_PROVIDER_IDS as readonly string[]).includes(value)
}

function isEnabledWebsiteProviderId(value: unknown): value is Translation2WebsiteProviderId {
  return isWebsiteProviderId(value)
}

function isMachineAdapterId(value: unknown): value is Translation2MachineAdapterId {
  return typeof value === 'string' && (TRANSLATION2_MACHINE_ADAPTER_IDS as readonly string[]).includes(value)
}

function isSafeEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    const url = new URL(value)
    if (url.username || url.password || url.hash) return false
    if ([...url.searchParams].some(([key, fieldValue]) => CREDENTIAL_FIELD.test(key) || isCredentialLikeAIValue(fieldValue))) return false
    if (url.protocol === 'https:') return true
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1')
  } catch { return false }
}

function parseFieldMap(value: unknown): Record<string, Translation2DefinitionScalar> | undefined | null {
  if (value === undefined) return undefined
  if (!record(value) || Object.keys(value).length > 16) return null
  const result: Record<string, Translation2DefinitionScalar> = {}
  for (const [key, fieldValue] of Object.entries(value)) {
    if (!FIELD_PATTERN.test(key) || !['string', 'number', 'boolean'].includes(typeof fieldValue)) return null
    if (CREDENTIAL_FIELD.test(key) || typeof fieldValue === 'string' && isCredentialLikeAIValue(fieldValue)) return null
    if (typeof fieldValue === 'string' && fieldValue.length > 512) return null
    if (typeof fieldValue === 'number' && !Number.isFinite(fieldValue)) return null
    result[key] = fieldValue as Translation2DefinitionScalar
  }
  return result
}

/** Parses the intentionally data-only imported translation API schema. */
export function parseTranslation2ImportedApiDefinition(value: unknown): Translation2ImportedApiDefinition | null {
  if (!record(value) || !exactKeys(value, ['schemaVersion', 'id', 'name', 'endpoint', 'method', 'auth', 'request', 'response', 'timeoutMs'])) return null
  if (value.schemaVersion !== 1 || typeof value.id !== 'string' || !ID_PATTERN.test(value.id)) return null
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > MAX_SERVICE_NAME) return null
  if (!isSafeEndpoint(value.endpoint) || value.method !== 'POST') return null
  if (!Number.isInteger(value.timeoutMs) || (value.timeoutMs as number) < 1000 || (value.timeoutMs as number) > 30_000) return null
  if (!record(value.auth) || typeof value.auth.kind !== 'string') return null
  let auth: Translation2ImportedApiDefinition['auth']
  if (value.auth.kind === 'none' && exactKeys(value.auth, ['kind'])) auth = { kind: 'none' }
  else if (value.auth.kind === 'bearer' && exactKeys(value.auth, ['kind'])) auth = { kind: 'bearer' }
  else if (value.auth.kind === 'header' && exactKeys(value.auth, ['kind', 'name'])
    && typeof value.auth.name === 'string' && FIELD_PATTERN.test(value.auth.name)
    && !FORBIDDEN_AUTH_HEADERS.has(value.auth.name.toLowerCase())) auth = { kind: 'header', name: value.auth.name }
  else return null

  if (!record(value.request) || !exactKeys(value.request, ['contentType', 'sourceField', 'targetLanguageField'], ['sourceLanguageField', 'staticFields'])) return null
  if (!['json', 'form'].includes(String(value.request.contentType))
    || typeof value.request.sourceField !== 'string' || !FIELD_PATTERN.test(value.request.sourceField)
    || typeof value.request.targetLanguageField !== 'string' || !FIELD_PATTERN.test(value.request.targetLanguageField)
    || value.request.sourceLanguageField !== undefined && (typeof value.request.sourceLanguageField !== 'string' || !FIELD_PATTERN.test(value.request.sourceLanguageField))) return null
  const staticFields = parseFieldMap(value.request.staticFields)
  if (staticFields === null) return null
  const request: Translation2ImportedApiDefinition['request'] = {
    contentType: value.request.contentType as 'json' | 'form',
    sourceField: value.request.sourceField,
    ...(typeof value.request.sourceLanguageField === 'string' ? { sourceLanguageField: value.request.sourceLanguageField } : {}),
    targetLanguageField: value.request.targetLanguageField,
    ...(staticFields ? { staticFields } : {}),
  }

  if (!record(value.response) || typeof value.response.kind !== 'string') return null
  let response: Translation2ImportedApiDefinition['response']
  if (value.response.kind === 'text' && exactKeys(value.response, ['kind'])) response = { kind: 'text' }
  else if (value.response.kind === 'json' && exactKeys(value.response, ['kind', 'textPath']) && Array.isArray(value.response.textPath)
    && value.response.textPath.length >= 1 && value.response.textPath.length <= 8
    && value.response.textPath.every(item => typeof item === 'string' && FIELD_PATTERN.test(item))) {
    response = { kind: 'json', textPath: [...value.response.textPath] as string[] }
  } else return null

  return {
    schemaVersion: 1, id: value.id, name: value.name.trim(), endpoint: value.endpoint, method: 'POST', auth,
    request, response, timeoutMs: value.timeoutMs as number,
  }
}

function normalizeWebsiteOrder(value: unknown): Translation2WebsiteProviderId[] {
  const requested = Array.isArray(value) ? value.filter(isWebsiteProviderId) : []
  return [...new Set([...requested, ...DEFAULT_TRANSLATION2_WEBSITE_ORDER])]
}

function normalizeMachineService(value: unknown): Translation2MachineServiceSettings | null {
  if (!record(value) || !exactKeys(value, ['id', 'name', 'adapterId', 'enabled', 'builtIn'], ['definitionId', 'testStatus', 'apiPlan', 'revision'])) return null
  if (typeof value.id !== 'string' || !ID_PATTERN.test(value.id)) return null
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > MAX_SERVICE_NAME) return null
  if (!isMachineAdapterId(value.adapterId) || typeof value.enabled !== 'boolean' || typeof value.builtIn !== 'boolean') return null
  if (value.adapterId === 'imported') {
    if (typeof value.definitionId !== 'string' || !ID_PATTERN.test(value.definitionId)) return null
  } else if (value.definitionId !== undefined) return null
  if (value.builtIn) return null
  if (value.revision !== undefined && (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0)) return null
  if (value.apiPlan !== undefined && (value.adapterId !== 'deepl' || !['free', 'pro'].includes(String(value.apiPlan)))) return null
  const testStatus = value.testStatus === 'passed' || value.testStatus === 'failed' ? value.testStatus : 'untested'
  return {
    id: value.id,
    name: value.name.trim(),
    adapterId: value.adapterId,
    enabled: value.enabled,
    builtIn: false,
    testStatus,
    ...(typeof value.revision === 'number' ? { revision: value.revision } : {}),
    ...(typeof value.definitionId === 'string' ? { definitionId: value.definitionId } : {}),
    ...(value.adapterId === 'deepl' && (value.apiPlan === 'free' || value.apiPlan === 'pro') ? { apiPlan: value.apiPlan } : {}),
  }
}

export function createDefaultTranslation2WorkspaceSettings(): Translation2WorkspaceSettings {
  return {
    activeTab: { kind: 'webtools' },
    websiteOrder: [...DEFAULT_TRANSLATION2_WEBSITE_ORDER],
    visibleWebsiteIds: ['google'],
    selectedService: { kind: 'machine', instanceId: BUILTIN_MYMEMORY.id },
    machineServices: [{ ...BUILTIN_MYMEMORY }],
    importedDefinitions: [],
  }
}

export function normalizeTranslation2WorkspaceSettings(value: unknown): Translation2WorkspaceSettings {
  if (!record(value)) return createDefaultTranslation2WorkspaceSettings()
  const websiteOrder = normalizeWebsiteOrder(value.websiteOrder)
  const visibleWebsiteIds = Array.isArray(value.visibleWebsiteIds)
    ? [...new Set(value.visibleWebsiteIds.filter(isEnabledWebsiteProviderId))]
        .sort((left, right) => websiteOrder.indexOf(left) - websiteOrder.indexOf(right))
    : []
  const machineServices = [
    { ...BUILTIN_MYMEMORY },
    ...(Array.isArray(value.machineServices) ? value.machineServices.map(normalizeMachineService).filter(service => service !== null) : []),
  ].filter((service, index, all) => all.findIndex(candidate => candidate.id === service.id) === index)
  const importedDefinitions = Array.isArray(value.importedDefinitions)
    ? value.importedDefinitions.map(parseTranslation2ImportedApiDefinition).filter(definition => definition !== null)
        .filter((definition, index, all) => all.findIndex(candidate => candidate.id === definition.id) === index)
    : []
  const usableDefinitionIds = new Set(importedDefinitions.map(definition => definition.id))
  const usableServices = machineServices.filter(service => service.adapterId !== 'imported'
    || service.definitionId !== undefined && usableDefinitionIds.has(service.definitionId))

  let selectedService: Translation2ServiceSelection = { kind: 'machine', instanceId: BUILTIN_MYMEMORY.id }
  const requestedService = record(value.selectedService) ? value.selectedService : null
  if (requestedService && exactKeys(requestedService, ['kind', requestedService.kind === 'ai' ? 'providerId' : 'instanceId'])) {
    if (requestedService.kind === 'ai' && isAIProviderId(requestedService.providerId)) {
      selectedService = { kind: 'ai', providerId: requestedService.providerId }
    } else if (requestedService.kind === 'machine' && typeof requestedService.instanceId === 'string'
      && usableServices.some(service => service.id === requestedService.instanceId && service.enabled)) {
      selectedService = { kind: 'machine', instanceId: requestedService.instanceId }
    }
  }

  let activeTab: Translation2TabSelection = { kind: 'webtools' }
  if (record(value.activeTab) && value.activeTab.kind === 'website'
    && isEnabledWebsiteProviderId(value.activeTab.providerId) && visibleWebsiteIds.includes(value.activeTab.providerId)) {
    activeTab = { kind: 'website', providerId: value.activeTab.providerId }
  }

  return { activeTab, websiteOrder, visibleWebsiteIds, selectedService, machineServices: usableServices, importedDefinitions }
}

function validTab(value: unknown, visible: readonly Translation2WebsiteProviderId[]): value is Translation2TabSelection {
  if (!record(value)) return false
  if (value.kind === 'webtools') return exactKeys(value, ['kind'])
  return value.kind === 'website' && exactKeys(value, ['kind', 'providerId'])
    && isEnabledWebsiteProviderId(value.providerId) && visible.includes(value.providerId)
}

function validServiceSelection(value: unknown, services: readonly Translation2MachineServiceSettings[]): value is Translation2ServiceSelection {
  if (!record(value)) return false
  if (value.kind === 'ai') return exactKeys(value, ['kind', 'providerId']) && isAIProviderId(value.providerId)
  return value.kind === 'machine' && exactKeys(value, ['kind', 'instanceId']) && typeof value.instanceId === 'string'
    && services.some(service => service.id === value.instanceId && service.enabled)
}

export function validateTranslation2WorkspaceSettings(value: unknown): value is Translation2WorkspaceSettings {
  if (!record(value) || !exactKeys(value, ['activeTab', 'websiteOrder', 'visibleWebsiteIds', 'selectedService', 'machineServices', 'importedDefinitions'])) return false
  if (!Array.isArray(value.websiteOrder) || value.websiteOrder.length !== DEFAULT_TRANSLATION2_WEBSITE_ORDER.length
    || !value.websiteOrder.every(isWebsiteProviderId) || new Set(value.websiteOrder).size !== DEFAULT_TRANSLATION2_WEBSITE_ORDER.length) return false
  if (!Array.isArray(value.visibleWebsiteIds) || !value.visibleWebsiteIds.every(isEnabledWebsiteProviderId)
    || new Set(value.visibleWebsiteIds).size !== value.visibleWebsiteIds.length) return false
  if (!Array.isArray(value.machineServices) || value.machineServices.length < 1) return false
  const services = value.machineServices as unknown[]
  if (!services.every((service, index) => {
    if (index === 0) return record(service) && exactKeys(service, ['id', 'name', 'adapterId', 'enabled', 'builtIn', 'testStatus'])
      && service.id === BUILTIN_MYMEMORY.id && service.name === BUILTIN_MYMEMORY.name && service.adapterId === 'mymemory'
      && service.enabled === true && service.builtIn === true && service.testStatus === 'passed'
    return normalizeMachineService(service) !== null
  })) return false
  const typedServices = services as Translation2MachineServiceSettings[]
  if (new Set(typedServices.map(service => service.id)).size !== typedServices.length) return false
  if (!Array.isArray(value.importedDefinitions) || !value.importedDefinitions.every(item => parseTranslation2ImportedApiDefinition(item) !== null)) return false
  const definitionIds = (value.importedDefinitions as Translation2ImportedApiDefinition[]).map(item => item.id)
  if (new Set(definitionIds).size !== definitionIds.length) return false
  if (typedServices.some(service => service.adapterId === 'imported' && (!service.definitionId || !definitionIds.includes(service.definitionId)))) return false
  return validTab(value.activeTab, value.visibleWebsiteIds as Translation2WebsiteProviderId[])
    && validServiceSelection(value.selectedService, typedServices)
}
