import type { Translation2WorkspaceSettings } from '../../src/shared/translation2-contracts.ts'
import type { Translation2ExecutionTarget } from './translation-service.ts'

export function resolveTranslation2ExecutionTarget(settings: Translation2WorkspaceSettings): Translation2ExecutionTarget | null {
  const selected = settings.selectedService
  if (selected.kind === 'ai') return { kind: 'ai', providerId: selected.providerId }

  const service = settings.machineServices.find(item => item.id === selected.instanceId && item.enabled)
  return service ? { kind: 'machine', adapterId: service.adapterId, instanceId: service.id } : null
}
