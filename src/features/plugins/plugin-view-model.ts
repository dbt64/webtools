import type { PluginAction, InstalledPluginCapability as PluginCapability, PluginInstallResult, PluginSummary } from '../../shared/plugin-contracts.ts'

const capabilityLabels: Record<PluginCapability, string> = {
  'clipboard.read': '仅在原生操作后接收一次剪贴板文本',
  'network.domains': '访问声明的网络域名（当前不支持）',
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

const capabilityDescriptions: Record<PluginCapability, string> = {
  'manager.page': '在 WebTools 中打开已有的兼容插件页面。',
  'plugin.config.read': '读取该插件自己的设置，不包括 WebTools 全局设置和密钥。',
  'plugin.config.write': '保存该插件自己的设置。',
  'plugin.storage.read': '读取该插件自己的私有数据。',
  'plugin.storage.write': '保存该插件自己的私有数据。',
  'clipboard.read': '仅在用户明确的原生操作后接收一次剪贴板文本。',
  'clipboard.write': '将插件结果写入系统剪贴板。',
  'external.open': '由 WebTools 打开插件声明的网址。',
  'sharedAI.complete': '通过 WebTools 的 AI 配置请求结果；插件不会获取提供方密钥。',
  'network.domains': '旧网络域名能力在当前宿主中不可授予。',
}

/** Safe product copy for errors; raw runtime messages and paths stay in developer diagnostics. */
export function pluginManagementError(error: { code: string }): string {
  const hints: Record<string, string> = {
    ...recoveryHints,
    USER_CONFIRMATION_REQUIRED: '操作确认已失效，请重新发起并完成 WebTools 确认。',
    SESSION_EXPIRED: '当前管理会话已结束，请重新打开插件管理。',
    PLUGIN_DISABLED: '插件当前不可用，请检查启用状态和权限。',
    STATE_INVALID: '翻译状态文件无法读取；恢复前会备份原文件。',
    STATE_UNSUPPORTED: '翻译状态文件版本不兼容；原文件已保留。',
    STATE_UNAVAILABLE: '无法安全读取翻译状态，可以选择备份并恢复状态。',
    STATE_WRITE_FAILED: '翻译状态未保存；当前会话已停用翻译，请重试上次操作。',
    STATE_RECOVERY_FAILED: '翻译状态恢复未完成；原文件已保留，请重试。',
    COMMAND_FAILED: '命令未完成，请检查所需权限后重试；详情可在开发者诊断查看。',
    COMMAND_TIMEOUT: '命令运行超时并已停止，可以稍后重新执行。',
    COMMAND_EXITED: '命令意外结束，可以稍后重新执行。',
    QUEUE_FULL: '当前操作较多，请等待后重试。',
    UNSUPPORTED_FEATURE_KIND: '当前宿主尚不支持此功能的运行方式。',
  }
  const titles: Record<string, string> = {
    INVALID_PACKAGE: '安装包未通过检查。', INVALID_MANIFEST: '插件说明无效。',
    INCOMPATIBLE_PLUGIN: '插件与当前 WebTools 不兼容。', INTEGRITY_FAILED: '插件文件完整性检查失败。',
    PERMISSION_DENIED: '操作所需权限尚未授予。', CONFIG_INCOMPATIBLE: '配置与此版本不兼容。',
    STORAGE_INVALID: '插件数据无法正常读取。', STORAGE_LIMIT: '插件数据已达到保存限制。',
    AI_NOT_CONFIGURED: 'WebTools AI 尚未配置。', AI_CONFIGURATION_INVALID: 'WebTools AI 配置无效。',
    AI_TIMEOUT: 'AI 请求已超时。', ACTION_FAILED: '插件操作未完成。', OPERATION_FAILED: '插件操作未完成。',
  }
  const hint = hints[error.code]
  return hint ? `${titles[error.code] ? `${titles[error.code]} ` : ''}${hint}` : '操作未完成，请重新加载插件状态；如果问题持续，可以停用或重新导入本地插件包。'
}

export function pluginStatusView(plugin: Pick<PluginSummary, 'enabled' | 'status' | 'errorCode'>) {
  const view = (label: string, tone: string, recovery: string) => ({ label, tone, recovery, trust: '本地导入；发布者未经验证' })
  if (plugin.status === 'incompatible') return view('不兼容', 'warning', recoveryHints[plugin.errorCode ?? 'INCOMPATIBLE_PLUGIN'])
  if (plugin.status === 'invalid') return view('验证失败', 'danger', recoveryHints[plugin.errorCode ?? 'INVALID_PACKAGE'])
  if (plugin.status === 'needs-permission') return view('需要权限', 'warning', '查看申请的能力，并通过宿主确认需要的权限。')
  if (plugin.status === 'faulted') return view('发生错误', 'danger', recoveryHints[plugin.errorCode ?? 'OPERATION_FAILED'] ?? recoveryHints.OPERATION_FAILED)
  if (plugin.status === 'stopping') return view('正在停止', 'quiet', '等待当前操作结束。')
  if (plugin.status === 'invoking') return view('正在运行操作', 'quiet', '正在等待此插件的操作完成。')
  if (plugin.status === 'validating') return view('正在验证', 'quiet', '等待 WebTools 验证安装包。')
  if ((plugin.status === 'active' || plugin.status === 'enabled') && plugin.enabled) return view('已启用', 'good', '')
  return view('已停用', 'quiet', '启用后才能打开插件页面。')
}

export function pluginCanOpen(plugin: Pick<PluginSummary, 'enabled' | 'status' | 'granted'>): boolean {
  return plugin.enabled && (plugin.status === 'active' || plugin.status === 'invoking') && plugin.granted.includes('manager.page')
}

export function pluginPermissionRows(plugin: Pick<PluginSummary, 'requested' | 'granted' | 'unsupportedCapabilities'>) {
  return plugin.requested.map(capability => ({
    id: capability,
    requested: true,
    grantable: capability !== 'network.domains',
    granted: plugin.granted.includes(capability),
    label: capabilityLabels[capability],
    description: capabilityDescriptions[capability],
    implemented: capability !== 'network.domains' && !plugin.unsupportedCapabilities?.includes(capability),
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
