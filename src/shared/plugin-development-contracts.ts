import type { IpcResult } from './ipc.ts'

export interface PluginRuntimeDiagnostic {
  readonly pluginId: string
  readonly featureId?: string
  readonly phase: 'build' | 'preload' | 'runtime' | 'reload'
  readonly code: string
  readonly message: string
  readonly source?: string
  readonly stack?: string
  readonly timestamp: number
  readonly runtimeGeneration?: number
}

export interface PluginDevelopmentStatus {
  readonly enabled: boolean
  readonly connected: boolean
  readonly project?: {
    readonly pluginId: string
    readonly name: string
    readonly projectName: string
    readonly runtimeKind?: 'web' | 'node'
    readonly revision: number
    readonly features: readonly { readonly id: string; readonly title: string; readonly available?: boolean }[]
  }
  readonly diagnostics: readonly PluginRuntimeDiagnostic[]
}

export interface PluginDevelopmentApi {
  get(): Promise<IpcResult<PluginDevelopmentStatus>>
  setEnabled(enabled: boolean): Promise<IpcResult<PluginDevelopmentStatus>>
  connectFromDialog(): Promise<IpcResult<PluginDevelopmentStatus>>
  disconnect(): Promise<IpcResult<PluginDevelopmentStatus>>
  openFeature(featureId: string): Promise<IpcResult<void>>
  copyDiagnostics(pluginId: string, featureId?: string): Promise<IpcResult<void>>
  onChanged(handler: (status: PluginDevelopmentStatus) => void): () => void
}
