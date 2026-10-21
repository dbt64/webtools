/** Paths owned by the active plugin runtime. The package path contains declared resources; local data survives runtime restarts. */
export interface PluginRuntimePaths {
  readonly packageDirectory: string
  readonly localDataDirectory: string
}

/** Resolve stable package resources and per-plugin writable data from a Node Plugin preload. */
export declare function getPluginPaths(preloadDirectory: string): PluginRuntimePaths

export interface CommandInvocation {
  readonly resultTarget?: 'super-panel'
  readonly context: import('./web/invocation-context.mjs').InvocationContext | null
  readonly signal: AbortSignal
  readonly webtools: {
    readonly context: { current(): Promise<CommandInvocation['context']> }
    readonly config: { get(): Promise<Readonly<Record<string, string | boolean | number>>>; set(key: string, value: string | boolean | number): Promise<void> }
    readonly storage: { get(key: string): Promise<import('./web/protocol.mjs').JsonValue>; set(key: string, value: import('./web/protocol.mjs').JsonValue): Promise<null>; delete(key: string): Promise<null> }
    readonly ai?: { complete(input: { prompt: string }): Promise<{ text: string }> }
    readonly clipboard?: { writeText(text: string): Promise<null> }
    /** HTTP(S) only, requires the declared/granted capability and one-use user activation. */
    readonly external?: { open(url: string): Promise<null> }
  }
}
/** A single bounded invocation; a resolved handler means completion, not background ownership. */
export interface FeatureTextResult { readonly kind: 'text'; readonly text: string }
export declare function defineCommand(handler: (invocation: CommandInvocation) => void | FeatureTextResult | Promise<void | FeatureTextResult>): (invocation: CommandInvocation) => void | FeatureTextResult | Promise<void | FeatureTextResult>
