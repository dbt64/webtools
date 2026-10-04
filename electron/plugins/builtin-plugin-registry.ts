import type { BuiltinEntryDTO } from '../../src/shared/plugin-catalog-contracts.ts'

/** Compile-time host registration. No package input participates in this registry. */
export function builtinPluginEntries(hostVersion: string): BuiltinEntryDTO[] {
  return [{
    kind: 'builtin', id: 'webtools.translation', source: 'bundled', name: '翻译',
    description: '使用当前翻译服务理解文字', version: hostVersion,
    icon: { kind: 'host', key: 'translation' }, compatibility: { status: 'compatible' },
    state: { status: 'ready', enabled: true }, entry: { kind: 'builtin-page', key: 'translation' },
    hostUsage: ['translation', 'shared-ai', 'external-open', 'clipboard'],
    management: { canToggle: false, canManageGrants: false, canUninstall: false, canReplacePackage: false },
  }]
}
