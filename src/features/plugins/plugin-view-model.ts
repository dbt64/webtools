import type { PluginAction, PluginCapability, PluginInstallResult, PluginSummary } from '../../shared/plugin-contracts.ts'

const capabilityLabels: Record<PluginCapability, string> = {
  'manager.page': '添加 Manager 页面',
  'plugin.config.read': '读取插件设置',
  'plugin.config.write': '保存插件设置',
  'plugin.storage.read': '读取插件私有数据',
  'plugin.storage.write': '保存插件私有数据',
  'external.open': '打开插件声明的网址',
  'clipboard.write': '写入剪贴板',
  'sharedAI.complete': '使用共享 AI',
}

const recoveryHints: Record<string, string> = {
  INVALID_MANIFEST: '检查插件清单后重新导入。',
  INCOMPATIBLE_PLUGIN: '请安装支持当前 WebTools 版本的插件。',
  INVALID_PACKAGE: '请重新选择完整的 .wtplugin 安装包。',
  STORAGE_INVALID: '插件数据无法读取；不要删除数据，先保留当前安装并检查原始插件包。',
  STORAGE_LIMIT: '插件数据已达到保存限制，请减少内容后重试。',
  INTEGRITY_FAILED: '请重新导入原始插件包。',
  PERMISSION_DENIED: '检查插件权限并只授予需要的能力。',
  CONFIG_INCOMPATIBLE: '当前版本和保存的设置不兼容；旧版本与数据仍已保留。',
  AI_NOT_CONFIGURED: '前往 WebTools AI 设置完成提供方配置。',
  AI_CONFIGURATION_INVALID: '检查 WebTools AI 提供方设置后重试。',
  AI_TIMEOUT: '检查网络连接后重试。',
  ACTION_FAILED: '重试操作；如果继续失败，请禁用插件。',
  OPERATION_FAILED: '重试操作；如果继续失败，请重新导入插件。',
}

export function pluginStatusView(plugin: Pick<PluginSummary, 'enabled' | 'status' | 'errorCode'>) {
  const view = (label: string, tone: string, recovery: string) => ({ label, tone, recovery, trust: '本地导入；发布者未经验证' })
  if (plugin.status === 'incompatible') return view('不兼容', 'warning', recoveryHints[plugin.errorCode ?? 'INCOMPATIBLE_PLUGIN'])
  if (plugin.status === 'invalid') return view('验证失败', 'danger', recoveryHints[plugin.errorCode ?? 'INVALID_PACKAGE'])
  if (plugin.status === 'needs-permission') return view('需要权限', 'warning', '查看申请的能力，并通过宿主确认需要的权限。')
  if (plugin.status === 'faulted') return view('发生错误', 'danger', recoveryHints[plugin.errorCode ?? 'OPERATION_FAILED'])
  if (plugin.status === 'stopping') return view('正在停止', 'quiet', '等待当前操作结束。')
  if (plugin.status === 'invoking') return view('正在运行操作', 'quiet', '正在等待此插件的操作完成。')
  if (plugin.status === 'active' && plugin.enabled) return view('已启用', 'good', '')
  return view('已停用', 'quiet', '启用后才能打开插件页面。')
}

export function pluginCanOpen(plugin: Pick<PluginSummary, 'enabled' | 'status' | 'granted'>): boolean {
  return plugin.enabled && (plugin.status === 'active' || plugin.status === 'invoking') && plugin.granted.includes('manager.page')
}

export function pluginPermissionRows(plugin: Pick<PluginSummary, 'requested' | 'granted'>) {
  return plugin.requested.map(capability => ({
    id: capability,
    requested: true,
    granted: plugin.granted.includes(capability),
    label: capabilityLabels[capability],
  }))
}

export function pluginInstallFeedback(result: PluginInstallResult): string {
  if (result.outcome === 'cancelled') return '安装已取消，没有更改插件。'
  if (result.outcome === 'already-installed') return '该版本和完整性摘要已安装。'
  const change = result.change
  if (!change || change.kind === 'new-install') return '插件已安装；新插件保持停用。'
  const summary = change.kind === 'upgrade' ? `插件已从 ${change.currentVersion} 升级至 ${change.incomingVersion}`
    : change.kind === 'downgrade' ? `插件已从 ${change.currentVersion} 降级至 ${change.incomingVersion}`
      : `插件已替换为版本 ${change.incomingVersion}`
  if (result.plugin?.enabled && result.plugin.status === 'needs-permission') return `${summary}；所需能力尚未全部授权，需要重新授权后才能使用。`
  return `${summary}；插件${result.plugin?.enabled ? '保持启用' : '保持停用'}。`
}

export function pluginTextActionLimit(type: PluginAction['type']): number { return type === 'clipboard.write' ? 24_000 : 50_000 }

export function pluginOperationError(error: { code: string; message: string }): string {
  return error.code === 'USER_CONFIRMATION_REQUIRED' ? '此操作的确认已失效或未完成，请重新发起操作并完成宿主确认。' : error.message
}

/** Clone reactive UI state into a plain array before crossing the Electron IPC boundary. */
export function pluginGrantPayload(grants: PluginCapability[]): PluginCapability[] { return [...grants] }

export function pluginCapabilityLabel(capability: PluginCapability): string { return capabilityLabels[capability] }
