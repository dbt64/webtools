const MESSAGES: Record<string, string> = {
  INVALID_MANIFEST: '插件清单无效。', INCOMPATIBLE_PLUGIN: '插件与当前宿主不兼容。', INVALID_PACKAGE: '插件安装包无效或超出安全限制。',
  INVALID_INPUT: '插件操作参数无效。', STORAGE_INVALID: '插件数据损坏或不符合当前定义。', STORAGE_LIMIT: '插件数据超出配额。',
  UNSAFE_PATH: '插件受管目录不安全。', INTEGRITY_FAILED: '插件文件校验失败。', NOT_INSTALLED: '插件未安装。',
  PERMISSION_DENIED: '插件尚未获得此操作权限。', PLUGIN_DISABLED: '插件当前不可用。', ACTION_NOT_DECLARED: '插件未声明此操作。',
  SESSION_EXPIRED: 'Manager 会话已结束。', USER_CONFIRMATION_REQUIRED: '需要用户确认此操作。', DOWNGRADE_DENIED: '降级需要明确确认。',
  CONFIG_INCOMPATIBLE: '新版本配置不兼容，已保留当前版本。', AI_BUSY: '此插件已有 AI 请求。', AI_RATE_LIMIT: '插件 AI 调用过于频繁。',
  AI_TIMEOUT: '插件 AI 请求已超时。', ACTION_FAILED: '插件操作未完成。', OPERATION_FAILED: '插件操作失败，未更改现有激活版本。',
  STATE_INVALID: '内置插件状态文件损坏；可选择先备份后恢复。',
  STATE_UNSUPPORTED: '内置插件状态版本不受支持；原文件已保留。',
  STATE_UNAVAILABLE: '无法安全读取内置插件状态；请检查文件权限或执行受控恢复。',
  STATE_WRITE_FAILED: '内置插件状态没有保存；当前会话已保持停用，请重试。',
  STATE_RECOVERY_FAILED: '状态备份或恢复未完成；原文件已保留。',
  INVALID_HANDOFF: '翻译交接请求无效。', STALE_HANDOFF: '翻译交接已更新，请重新打开。',
  HANDOFF_EXPIRED: '翻译交接超时，请重新发起。', HANDOFF_RECOVERY_REQUIRED: '请先在插件管理中恢复内置翻译状态。',
  MANAGER_CLOSED: 'Manager 已关闭。', INTENT_SUPERSEDED: '新的 Manager 请求已替代当前请求。',
}
export class PluginError extends Error {
  readonly code: string
  constructor(code: string) { super(MESSAGES[code] ?? MESSAGES.OPERATION_FAILED); this.code = code in MESSAGES ? code : 'OPERATION_FAILED' }
}
export function fail(code: string): never { throw new PluginError(code) }
export function safePluginError(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && error.code in MESSAGES ? error.code : 'OPERATION_FAILED'
  const safe = error instanceof PluginError ? error : new PluginError(code)
  return { code: safe.code, message: safe.message }
}
