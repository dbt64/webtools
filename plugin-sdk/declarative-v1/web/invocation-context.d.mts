export type InvocationContext =
  | Readonly<{ type: 'text'; source: 'launcher-input' | 'clipboard' | 'selected-text'; text: string }>
  | Readonly<{ type: 'files' | 'directories'; source: 'explorer-selection'; items: readonly Readonly<{ kind: 'file' | 'directory'; path: string }>[] }>
export interface AcceptedContextMetadata { readonly type: string; readonly sources: readonly string[]; readonly extensions?: readonly string[]; readonly maxItems?: number; readonly textMatch?: 'http-url' }
export declare function validateInvocationContext(value: unknown): InvocationContext | null
export declare function acceptsInvocationContext(accepted: readonly AcceptedContextMetadata[], context: InvocationContext | null): boolean
