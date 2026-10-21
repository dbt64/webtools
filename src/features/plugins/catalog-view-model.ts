import type { CatalogEntryDTO, PluginRef } from '../../shared/plugin-catalog-contracts.ts'
import { pluginCanOpen, pluginStatusView } from './plugin-view-model.ts'

export function catalogRef(entry: CatalogEntryDTO): PluginRef { return entry.kind === 'builtin' ? { kind: 'builtin', id: entry.id } : { kind: entry.kind, id: entry.id } }
export function catalogKey(ref: PluginRef): string { return `${ref.kind}:${ref.id}` }
export function catalogCanOpen(entry: CatalogEntryDTO): boolean { return entry.kind === 'builtin' ? entry.state.status === 'ready' && entry.state.enabled
  : entry.kind === 'web' ? entry.package.enabled && Boolean(entry.package.webFeatures?.some(f => f.available)) : pluginCanOpen(entry.package) }
export function catalogPresentation(entry: CatalogEntryDTO) {
  return entry.kind === 'builtin'
    ? {
        name: entry.name,
        version: entry.version,
        description: entry.description,
        author: 'WebTools · 内置',
        status: entry.state.status === 'ready'
          ? { label: '可用 · 内置', tone: 'good' }
          : entry.state.status === 'disabled'
            ? { label: '已停用', tone: 'quiet' }
            : entry.state.status === 'enabling'
              ? { label: '正在启用…', tone: 'quiet' }
              : entry.state.status === 'stopping'
                ? { label: '正在停用…', tone: 'quiet' }
                : entry.state.status === 'faulted'
                  ? { label: '状态未保存', tone: 'danger' }
                  : { label: '需要恢复', tone: 'danger' },
      }
    : { name: entry.package.name, version: entry.package.version, description: entry.package.description ?? '', author: entry.package.author?.name ?? '作者未知', status: pluginStatusView(entry.package) }
}

export interface CatalogFeatureRow {
  key: string; title: string; description: string; ref: PluginRef; available: boolean
  surfaces: string[]; contexts: string[]; action: string; openLabel: string
  actionKind: 'compatibility' | 'window' | 'command'
}

export function catalogFeatureSummary(entry: CatalogEntryDTO): string {
  if (entry.kind === 'builtin') return '内置翻译窗口'
  if (entry.kind === 'declarative') return '兼容插件页面'
  const count = entry.package.webFeatures?.length
  return count ? `${count} 项功能` : '功能信息暂不可读取'
}

/** Converts safe Host metadata into product labels; never grants execution in Renderer. */
export function catalogFeatureRows(entry: CatalogEntryDTO): CatalogFeatureRow[] {
  if (entry.kind === 'builtin' || entry.kind === 'declarative') return [{
    key: catalogKey(entry), title: catalogPresentation(entry).name,
    description: entry.kind === 'builtin' ? '打开独立的 Translation 2.0 窗口；选中文本可精确交接到原文框。' : '打开宿主呈现的现有兼容页面。',
    ref: catalogRef(entry), available: catalogCanOpen(entry),
    surfaces: ['插件管理', '搜索框', '超级面板'],
    contexts: entry.kind === 'builtin' ? ['选中文本', '通用调用（无需选中内容）'] : ['通用调用（无需选中内容）'],
    action: entry.kind === 'builtin' ? '打开 Translation 2.0 窗口' : '打开兼容页面',
    openLabel: '打开', actionKind: 'compatibility',
  }]
  return (entry.package.webFeatures ?? []).map(feature => {
    const contexts = new Set<string>()
    if (feature.acceptedContexts === undefined) contexts.add('尚未提供上下文说明')
    else if (feature.acceptedContexts.length === 0) contexts.add('通用调用（无需选中内容）')
    for (const rule of feature.acceptedContexts ?? []) {
      if (rule.type === 'none') contexts.add('通用调用（无需选中内容）')
      if (rule.type === 'text') {
        if (rule.sources.includes('selected-text')) contexts.add('选中文本')
        if (rule.sources.includes('launcher-input')) contexts.add('搜索框文本')
        if (rule.sources.includes('clipboard')) contexts.add('经授权的剪贴板文本')
      }
      if (rule.type === 'files') {
        contexts.add(`选中文件${rule.extensions?.length ? `（${rule.extensions.join('、')}）` : ''}${rule.maxItems ? `，最多 ${rule.maxItems} 项` : ''}`)
      }
      if (rule.type === 'directories') contexts.add(`选中的文件夹 / 当前资源管理器文件夹${rule.maxItems ? `，最多 ${rule.maxItems} 项` : ''}`)
    }
    const labels = { manager: '插件管理', launcher: '搜索框', 'super-panel': '超级面板' }
    const command = feature.presentation?.type === 'command'
    return {
      key: feature.id, title: feature.title, description: feature.description ?? '',
      ref: { kind: 'web' as const, id: entry.id, featureId: feature.id }, available: feature.available,
      surfaces: feature.invocationSurfaces?.map(surface => labels[surface]) ?? ['尚未提供入口说明'],
      contexts: [...contexts], action: command ? '执行一次命令，结束后退出' : '打开独立插件窗口',
      openLabel: command ? '运行' : '打开', actionKind: command ? 'command' as const : 'window' as const,
    }
  })
}
export function catalogNavigationItems(entries: CatalogEntryDTO[]) {
  return entries.filter(catalogCanOpen).map(entry => ({ ref: catalogRef(entry), key: catalogKey(entry), label: catalogPresentation(entry).name, icon: entry.icon }))
}
/** Management navigation includes every installed entry, even when it is disabled or unavailable. */
export function catalogInstalledNavigationItems(entries: CatalogEntryDTO[]) {
  return entries.map(entry => ({ ref: catalogRef(entry), key: catalogKey(entry), label: catalogPresentation(entry).name, icon: entry.icon }))
}
export function catalogShouldReturnToCenter(ref: PluginRef | null, entries: CatalogEntryDTO[]): boolean {
  const current = ref ? entries.find(entry => catalogKey(entry) === catalogKey(ref)) : undefined
  return !current || !catalogCanOpen(current)
}
export interface CatalogRequestIdentity { section: string; ref: PluginRef | null; generation: number }
export function isCurrentCatalogRequest(current: CatalogRequestIdentity, requested: CatalogRequestIdentity): boolean {
  return current.section === 'plugin-page' && current.section === requested.section && current.generation === requested.generation
    && current.ref !== null && requested.ref !== null && catalogKey(current.ref) === catalogKey(requested.ref)
}
