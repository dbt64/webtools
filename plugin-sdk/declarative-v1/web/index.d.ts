export type WebToolsErrorCode = 'INVALID_REQUEST' | 'UNAUTHORIZED' | 'PERMISSION_DENIED' | 'STALE_RUNTIME' | 'CONTEXT_EXPIRED' | 'NOT_AVAILABLE' | 'LIMIT_EXCEEDED' | 'TIMEOUT' | 'CANCELLED' | 'USER_CANCELLED' | 'RUNTIME_CLOSED' | 'INTERNAL_ERROR' | 'CONFIGURATION_NOT_DECLARED' | 'CONFIGURATION_KEY_NOT_FOUND' | 'CONFIG_INCOMPATIBLE'
export interface WebToolsError extends Error { readonly code: WebToolsErrorCode; readonly retryable: false }
export type PluginJson = null | boolean | number | string | PluginJson[] | { [key: string]: PluginJson }
export interface TextContext { readonly type: 'text'; readonly source: 'launcher-input' | 'clipboard' | 'selected-text'; readonly text: string }
export type InvocationContext = import('./invocation-context.mjs').InvocationContext
export interface WebToolsCallOptions { readonly signal?: AbortSignal }
export interface WebToolsConnection {
  readonly ready: Promise<void>
  readonly context: { current(options?: WebToolsCallOptions): Promise<InvocationContext | null> }
  readonly config: {
    get(options?: WebToolsCallOptions): Promise<Readonly<Record<string, string | boolean | number>>>
    set(key: string, value: string | boolean | number, options?: WebToolsCallOptions): Promise<void>
  }
  readonly storage: {
    get(key: string, options?: WebToolsCallOptions): Promise<PluginJson>
    set(key: string, value: PluginJson, options?: WebToolsCallOptions): Promise<void>
    delete(key: string, options?: WebToolsCallOptions): Promise<void>
  }
  readonly ai?: { complete(input: { prompt: string }, options?: WebToolsCallOptions): Promise<{ readonly text: string }> }
  readonly clipboard?: { writeText(text: string, options?: WebToolsCallOptions): Promise<void> }
  /** Plugin-local cleanup notification; returns a local unsubscribe function. */
  onClose(listener: () => void): () => void
}
export function connectWebTools(): WebToolsConnection
