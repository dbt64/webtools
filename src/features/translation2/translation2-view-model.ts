import type { AIProviderId } from '../../shared/ai-config.ts'
import type {
  Translation2WebsiteProviderDescriptor,
  Translation2WorkspaceSettings,
} from '../../shared/translation2-contracts.ts'
import type { Translation2OpenProjection } from '../../../electron/plugins/builtin-translation-window.ts'

export interface Translation2TabItem {
  kind: 'webtools' | 'website'
  id: 'webtools' | string
  label: string
}

export interface Translation2AIProviderProjection {
  id: AIProviderId
  name: string
  model: string
  configured: boolean
}

export interface Translation2ServiceItem {
  id: string
  label: string
  configured: boolean
}

export interface Translation2ServiceGroup {
  kind: 'machine' | 'ai'
  label: '机器翻译 API' | 'AI 翻译'
  items: Translation2ServiceItem[]
}

export interface Translation2ViewState {
  openGeneration: number
  contentGeneration: number
  sourceText: string
  result: string
  error: string
  request: { id: string; contentGeneration: number } | null
}

export function buildTranslation2Tabs(
  settings: Translation2WorkspaceSettings,
  descriptors: readonly Translation2WebsiteProviderDescriptor[],
): Translation2TabItem[] {
  const byId = new Map(descriptors.map(item => [item.id, item]))
  return [
    { kind: 'webtools', id: 'webtools', label: 'WebTools 翻译' },
    ...settings.websiteOrder.flatMap(id => {
      const descriptor = byId.get(id)
      return descriptor && settings.visibleWebsiteIds.includes(id)
        ? [{ kind: 'website' as const, id, label: descriptor.name }]
        : []
    }),
  ]
}

export function buildTranslation2ServiceGroups(
  settings: Translation2WorkspaceSettings,
  aiProviders: readonly Translation2AIProviderProjection[],
  machineConfigured: Readonly<Record<string, boolean>> = {},
): Translation2ServiceGroup[] {
  return [
    {
      kind: 'machine',
      label: '机器翻译 API',
      items: settings.machineServices.filter(service => service.enabled).map(service => ({
        id: `machine:${service.id}`,
        label: service.name,
        configured: machineConfigured[service.id] ?? (service.adapterId === 'mymemory' || service.builtIn),
      })),
    },
    {
      kind: 'ai',
      label: 'AI 翻译',
      items: aiProviders.map(provider => ({
        id: `ai:${provider.id}`,
        label: `${provider.name}${provider.model ? ` · ${provider.model}` : ''}`,
        configured: provider.configured,
      })),
    },
  ]
}

export function createTranslation2ViewState(open: Translation2OpenProjection): Translation2ViewState {
  return {
    openGeneration: open.generation,
    contentGeneration: 0,
    sourceText: open.sourceText ?? '',
    result: '',
    error: '',
    request: null,
  }
}

export function applyTranslation2Open(state: Translation2ViewState, open: Translation2OpenProjection): Translation2ViewState {
  if (open.generation <= state.openGeneration) return state
  return {
    openGeneration: open.generation,
    contentGeneration: state.contentGeneration + 1,
    sourceText: open.sourceText ?? '',
    result: '',
    error: '',
    request: null,
  }
}

export function isTranslation2RequestCurrent(
  state: Translation2ViewState,
  request: { id: string; contentGeneration: number },
): boolean {
  return state.contentGeneration === request.contentGeneration
    && state.request?.contentGeneration === request.contentGeneration
    && state.request.id === request.id
}
