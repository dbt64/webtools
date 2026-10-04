import type { BuiltinEntryDTO } from '../../src/shared/plugin-catalog-contracts.ts'
import type { BuiltinTranslationRuntimeState } from './builtin-translation-lifecycle.ts'

function presentationState(state: BuiltinTranslationRuntimeState): BuiltinEntryDTO['state'] {
  switch (state.status) {
    case 'ready': return { status: 'ready', enabled: true }
    case 'disabled': return { status: 'disabled', enabled: false }
    case 'enabling': return { status: 'enabling', enabled: false, targetEnabled: true }
    case 'stopping': return { status: 'stopping', enabled: false, targetEnabled: false }
    case 'faulted': return { status: 'faulted', enabled: false, errorCode: state.errorCode, retryEnabled: state.retryEnabled }
    case 'unavailable': return { status: 'unavailable', enabled: false, errorCode: state.errorCode }
  }
}

/** Compile-time host registration. No package input participates in this registry. */
export function builtinPluginEntries(hostVersion: string, state: BuiltinTranslationRuntimeState): BuiltinEntryDTO[] {
  return [{
    kind: 'builtin', id: 'webtools.translation', source: 'bundled', name: '翻译',
    description: '使用当前翻译服务理解文字', version: hostVersion,
    icon: { kind: 'host', key: 'translation' }, compatibility: { status: 'compatible' },
    state: presentationState(state), entry: { kind: 'builtin-page', key: 'translation' },
    hostUsage: ['translation', 'shared-ai', 'external-open', 'clipboard'],
    management: {
      canToggle: state.status === 'ready' || state.status === 'disabled' || state.status === 'faulted',
      canRecover: state.status === 'unavailable',
      canManageGrants: false,
      canUninstall: false,
      canReplacePackage: false,
    },
  }]
}
