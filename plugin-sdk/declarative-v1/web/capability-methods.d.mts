import type { JsonValue } from './protocol.mjs'
export type CapabilityRequest =
  | { method: 'context.current'; payload: null }
  | { method: 'config.get'; payload: null }
  | { method: 'config.set'; payload: { key: string; value: string | boolean | number } }
  | { method: 'storage.get' | 'storage.delete'; payload: { key: string } }
  | { method: 'storage.set'; payload: { key: string; value: JsonValue } }
  | { method: 'ai.complete'; payload: { prompt: string } }
  | { method: 'clipboard.write'; payload: { text: string } }
  | { method: 'external.open'; payload: { url: string } }
export declare const CAPABILITY_METHODS: readonly CapabilityRequest['method'][]
export declare function validateCapabilityRequest(method: string, payload: unknown): CapabilityRequest
export declare function validateCapabilityResult(method: string, result: unknown): void
