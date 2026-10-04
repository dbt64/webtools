import type { PluginAction, PluginCapability, PluginJson, PluginVersionChange } from '../../src/shared/plugin-contracts.ts'
import type { AIMessage } from '../services/openai-compatible-adapter.ts'
import { boundedString, record } from './manifest.ts'
import { fail } from './errors.ts'

export interface PluginConsent {
  kind: 'install' | 'replace' | 'downgrade' | 'grant' | 'uninstall' | 'delete-data' | 'external' | 'clipboard' | 'ai'
  pluginId: string; name: string; version: string; capabilities?: PluginCapability[]; preview?: string; versionChange?: PluginVersionChange
}
export interface PluginProviderInfo { providerName: string; model: string; identity?: string }
export interface PluginHostEffects {
  confirm(request: PluginConsent): Promise<boolean>
  externalOpen(url: string): Promise<void>
  clipboardWrite(text: string): void
  ai: {
    complete(messages: AIMessage[], signal: AbortSignal, maxOutputTokens: number): Promise<{ text: string }>
    getDefaultProviderInfo(): Promise<PluginProviderInfo>
  }
}
export function providerIdentity(info: PluginProviderInfo): string { return JSON.stringify([info.providerName, info.model, info.identity ?? null]) }
export function validateActionInput(action: PluginAction, input: unknown): unknown {
  switch (action.type) {
    case 'plugin.config.read': case 'plugin.storage.read': case 'external.open': if (input !== null) fail('INVALID_INPUT'); return null
    case 'plugin.config.write': case 'plugin.storage.write': return record(input, ['value']).value
    case 'clipboard.write': return boundedString(record(input, ['text']).text, 50_000, 0)
    case 'sharedAI.complete': {
      const value = record(input, ['messages']); if (!Array.isArray(value.messages) || !value.messages.length || value.messages.length > 100) fail('INVALID_INPUT')
      return value.messages.map(message => { const m = record(message, ['role', 'content']); if (!['system', 'user', 'assistant'].includes(m.role as string)) fail('INVALID_INPUT'); return { role: m.role, content: boundedString(m.content, 50_000, 0) } }) as AIMessage[]
    }
    default: { const exhaustive: never = action; return exhaustive }
  }
}
export class PermissionBroker {
  private readonly aiBusy = new Set<string>()
  private readonly aiCalls = new Map<string, number[]>()
  readonly host: PluginHostEffects
  private readonly now: () => number
  constructor(host: PluginHostEffects, now: () => number = Date.now) { this.host = host; this.now = now }
  enforce(requested: PluginCapability[], granted: PluginCapability[], capability: PluginCapability, available: boolean): void {
    if (!available) fail('PLUGIN_DISABLED')
    if (!requested.includes(capability) || !granted.includes(capability)) fail('PERMISSION_DENIED')
  }
  reserveAI(id: string): { dispatched(): void; release(): void } {
    if (this.aiBusy.has(id)) fail('AI_BUSY')
    const calls = (this.aiCalls.get(id) ?? []).filter(time => this.now() - time < 60_000); this.aiCalls.set(id, calls)
    if (calls.length >= 5) fail('AI_RATE_LIMIT')
    this.aiBusy.add(id)
    return { dispatched: () => { calls.push(this.now()) }, release: () => { this.aiBusy.delete(id) } }
  }
  forget(id: string): void { if (!this.aiBusy.has(id)) this.aiCalls.delete(id) }
  clear(): void { this.aiCalls.clear() }
}
export type ActionValue = PluginJson
