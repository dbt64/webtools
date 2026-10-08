export type WebToolsErrorCode = 'INVALID_REQUEST' | 'UNAUTHORIZED' | 'PERMISSION_DENIED' | 'STALE_RUNTIME' | 'CONTEXT_EXPIRED' | 'NOT_AVAILABLE' | 'LIMIT_EXCEEDED' | 'TIMEOUT' | 'CANCELLED' | 'USER_CANCELLED' | 'RUNTIME_CLOSED' | 'INTERNAL_ERROR'
export interface WebToolsError extends Error { readonly code: WebToolsErrorCode; readonly retryable: false }
export interface WebToolsConnection {
  readonly ready: Promise<void>
  /** Plugin-local cleanup notification; returns a local unsubscribe function. */
  onClose(listener: () => void): () => void
}
export function connectWebTools(): WebToolsConnection
