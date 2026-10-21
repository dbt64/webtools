import type { UtilityProcess, ForkOptions } from 'electron'
import { dirname, join } from 'node:path'
import { validateCapabilityRequest } from '../../plugin-sdk/declarative-v1/web/capability-methods.mjs'
import { WebHostCapabilities, type InvocationTextContext, type WebCapabilityEffects } from './web-host-capabilities.ts'
import type { WebFeatureAuthority } from './web-feature-authority.ts'
import type { PluginStore } from './plugin-store.ts'
import type { NodePluginRuntimeDescriptor } from './node-plugin-preload-bootstrap.ts'
import type { PluginRuntimeDiagnostics } from './plugin-runtime-diagnostics.ts'
import { nextRuntimeGeneration } from './runtime-generation.ts'
import { hasExactResultFields, parseFeatureTextResult, type FeatureTextResult } from '../../src/shared/feature-quick-result-contracts.ts'

export type NodeCommandOutcome = { readonly status: 'completed'; readonly result?: FeatureTextResult; readonly externalOpened?: true } | { readonly status: 'cancelled' }
export interface NodeCommandOptions {
  readonly resultTarget?: 'super-panel'
  readonly signal?: AbortSignal
  readonly effects?: Partial<Omit<WebCapabilityEffects, 'hasForegroundGesture'>>
}

interface CommandExecution {
  authority: WebFeatureAuthority
  abort: AbortController
  done: Promise<void>
}
const executionError = (code: string, message: string) => Object.assign(new Error(message), { code })

/** Runtime 2.0 Node command adapter: validated materialization and existing Host capabilities. */
export class NodeCommandExecutionAdapter {
  private readonly active = new Set<CommandExecution>()
  private closed = false
  constructor(private readonly deps: {
    fork(modulePath: string, options: ForkOptions): UtilityProcess
    resolve(authority: WebFeatureAuthority): Promise<Omit<NodePluginRuntimeDescriptor, 'generation'>>
    capabilities(authority: WebFeatureAuthority): { store: PluginStore; effects: Omit<WebCapabilityEffects, 'hasForegroundGesture'> }
    diagnostics: PluginRuntimeDiagnostics
    onOwnershipChanged(): void
    onCleanupFailed(): void
  }) {}
  get hasActiveWork(): boolean { return this.active.size > 0 }
  async execute(authority: WebFeatureAuthority, context?: InvocationTextContext, options: NodeCommandOptions = {}): Promise<NodeCommandOutcome> {
    const manifest = authority.snapshot.manifest
    if (manifest.manifestVersion !== 3 || manifest.runtime.kind !== 'node') throw executionError('UNSUPPORTED_FEATURE_KIND', 'No supported Node command runtime.')
    const feature = manifest.features.find(item => item.id === authority.featureId)
    if (feature?.entry.kind !== 'node-command'
      || feature.presentation?.type !== 'command') throw executionError('UNSUPPORTED_FEATURE_KIND', 'No supported Node command entry.')
    if (this.closed || !authority.isCurrent()) throw executionError('FEATURE_UNAVAILABLE', 'Command authority unavailable.')
    if (this.active.size >= 8) throw executionError('QUEUE_FULL', 'Too many active commands.')
    const abort = new AbortController()
    const cancelInput = () => abort.abort()
    options.signal?.addEventListener('abort', cancelInput, { once: true })
    if (options.signal?.aborted) abort.abort()
    let resolveDone!: () => void; let rejectDone!: (error: unknown) => void
    const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject })
    void done.catch(() => {})
    const execution = { authority, abort, done }
    this.active.add(execution); this.deps.onOwnershipChanged()
    const removeRevoke = authority.onRevoke(() => abort.abort())
    const generation = nextRuntimeGeneration()
    this.deps.diagnostics.begin(manifest.id, generation, feature.id)
    const receivedAt = Date.now()
    let timedOut = false
    const deadline = setTimeout(() => { timedOut = true; abort.abort() }, 30_000)
    let child: UtilityProcess | undefined
    let capabilities: WebHostCapabilities | undefined
    let exited = false
    let signalExit!: () => void
    const exit = new Promise<void>(resolve => { signalExit = resolve })
    let outcome: NodeCommandOutcome = { status: 'cancelled' }
    let terminalError: Error | undefined
    let terminalReceived = false
    let externalOpened = false
    try {
      const dependencies = this.deps.capabilities(authority)
      let gesture = true
      capabilities = new WebHostCapabilities({ authority, store: dependencies.store,
        context: context ? { ...context, ageMs: context.ageMs + Date.now() - receivedAt } : undefined,
        isRuntimeCurrent: () => this.active.has(execution) && !abort.signal.aborted && authority.isCurrent(),
        effects: { ...dependencies.effects, ...options.effects, hasForegroundGesture: () => { const available = gesture; gesture = false; return available } },
      })
      const descriptor = await new Promise<Omit<NodePluginRuntimeDescriptor, 'generation'>>((resolve, reject) => {
        const cancelled = () => reject(executionError(timedOut ? 'COMMAND_TIMEOUT' : 'COMMAND_CANCELLED', 'Command preparation was cancelled.'))
        if (abort.signal.aborted) { cancelled(); return }
        abort.signal.addEventListener('abort', cancelled, { once: true })
        this.deps.resolve(authority).then(resolve, reject).finally(() => abort.signal.removeEventListener('abort', cancelled))
      })
      if (timedOut) throw executionError('COMMAND_TIMEOUT', 'Command exceeded its 30-second execution deadline.')
      if (abort.signal.aborted || !authority.isCurrent()) return { status: 'cancelled' }
      // Utility process is a temporary child of this Electron Host, not another
      // application or resident plugin service. Never inherit Host credentials.
      const environment = Object.fromEntries(Object.entries(process.env).filter(([name, value]) => value !== undefined
        && !/TOKEN|SECRET|PASSWORD|API_KEY|AUTHORIZATION|ELECTRON_RUN_AS_NODE|WEBTOOLS_/i.test(name))) as Record<string, string>
      environment.WEBTOOLS_PLUGIN_DATA = descriptor.localDataPath
      child = this.deps.fork(join(typeof __dirname === 'string' ? __dirname : '.', 'plugin-command.js'), { env: environment, cwd: dirname(descriptor.preloadPath), execArgv: [], stdio: 'pipe', serviceName: 'WebTools Plugin Command' })
      child.stdout?.on('data', () => {})
      child.stderr?.on('data', () => {})
      const result = await new Promise<NodeCommandOutcome>((resolve, reject) => {
        let pendingRequests = 0
        const cancel = () => { try { child?.postMessage({ type: 'cancel' }) } catch {} resolve({ status: 'cancelled' }) }
        abort.signal.addEventListener('abort', cancel, { once: true })
        child!.once('exit', code => {
          exited = true; signalExit(); abort.signal.removeEventListener('abort', cancel)
          if (abort.signal.aborted) resolve({ status: 'cancelled' })
          else reject(executionError('COMMAND_EXITED', `Command process exited before completion (${code}).`))
        })
        child!.once('spawn', () => {
          if (abort.signal.aborted) { cancel(); return }
          try {
            child!.postMessage({ type: 'start', descriptor: { ...descriptor, generation },
              ...(options.resultTarget ? { resultTarget: options.resultTarget } : {}),
              capabilities: ['sharedAI.complete', 'clipboard.write', 'external.open'].filter(cap => authority.isCurrent(cap as 'sharedAI.complete' | 'clipboard.write' | 'external.open')) })
          } catch { reject(executionError('COMMAND_START_FAILED', 'Command execution could not start.')) }
        })
        child!.on('error', () => reject(executionError('COMMAND_PROCESS_ERROR', 'Command utility process reported a fatal error.')))
        child!.on('message', (message: unknown) => {
          if (!message || typeof message !== 'object' || abort.signal.aborted || !authority.isCurrent()) return
          const value = message as Record<string, unknown>
          if (terminalReceived) { terminalError = executionError('COMMAND_PROTOCOL_ERROR', 'Duplicate command completion.'); reject(terminalError); return }
          if (value.type === 'completed') {
            terminalReceived = true
            const output = Object.hasOwn(value, 'result') ? parseFeatureTextResult(value.result) : undefined
            if (!hasExactResultFields(value, output === undefined ? ['type'] : ['type', 'result']) || output === null) {
              terminalError = executionError('COMMAND_PROTOCOL_ERROR', 'Invalid command result.'); reject(terminalError); return
            }
            resolve({ status: 'completed', ...(options.resultTarget && output ? { result: output } : {}),
              ...(externalOpened ? { externalOpened: true } : {}) }); return
          }
          if (value.type === 'cancelled') { terminalReceived = true; resolve({ status: 'cancelled' }); return }
          if (value.type === 'failed') {
            const error = executionError('COMMAND_FAILED', typeof value.message === 'string' ? value.message.slice(0, 4096) : 'Command failed.')
            if (typeof value.stack === 'string') error.stack = value.stack.slice(0, 8192)
            reject(error); return
          }
          if (value.type !== 'capability' || typeof value.method !== 'string' || !Number.isSafeInteger(value.id) || (value.id as number) < 1 || pendingRequests >= 16) {
            reject(executionError('COMMAND_PROTOCOL_ERROR', 'Invalid command Host request.')); return
          }
          const method = value.method
          const requestId = value.id as number
          const payload = value.payload
          pendingRequests++
          void (async () => {
            try {
              const request = validateCapabilityRequest(method, payload)
              const response = await capabilities!.dispatch(request, abort.signal)
              if (!abort.signal.aborted && authority.isCurrent()) {
                // Host-observed success only; plugin completion messages cannot claim
                // this disposition. Failure/cancellation never releases it as success.
                if (request.method === 'external.open') externalOpened = true
                child?.postMessage({ type: 'capability-result', id: requestId, ok: true, value: response })
              }
            } catch (error) {
              if (!abort.signal.aborted && !exited) child?.postMessage({ type: 'capability-result', id: requestId, ok: false,
                code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'INTERNAL_ERROR' })
            } finally { pendingRequests-- }
          })().catch(() => { abort.abort() })
        })
        if (abort.signal.aborted) cancel()
      })
      if (timedOut) throw executionError('COMMAND_TIMEOUT', 'Command exceeded its 30-second execution deadline.')
      if (result.status === 'completed') this.deps.diagnostics.ready(manifest.id, generation, feature.id)
      outcome = result
    } catch (error) {
      if (abort.signal.aborted && !timedOut) return { status: 'cancelled' }
      this.deps.diagnostics.record({ pluginId: manifest.id, featureId: feature.id, phase: 'runtime',
        code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'COMMAND_FAILED',
        message: error instanceof Error ? error.message : 'Command failed.', stack: error instanceof Error ? error.stack : undefined,
        timestamp: Date.now(), runtimeGeneration: generation })
      throw error
    } finally {
      clearTimeout(deadline); removeRevoke(); abort.abort(); capabilities?.dispose(); authority.revoke()
      options.signal?.removeEventListener('abort', cancelInput)
      try {
        if (child && !exited) {
          // Give the handler's AbortSignal a bounded cooperative cleanup turn,
          // then terminate this owned execution process if it is still alive.
          try { child.postMessage({ type: 'cancel' }) } catch {}
          let grace: NodeJS.Timeout | undefined
          try { await Promise.race([exit, new Promise<void>(resolve => { grace = setTimeout(resolve, 1000) })]) }
          finally { clearTimeout(grace) }
        }
        if (child && !exited) {
          child.kill()
          let timer: NodeJS.Timeout | undefined
          try { await Promise.race([exit, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Command process cleanup timed out.')), 5000) })]) }
          finally { clearTimeout(timer) }
        }
        resolveDone()
      } catch (error) { rejectDone(error); this.deps.onCleanupFailed(); throw error }
      finally { child?.removeAllListeners(); this.active.delete(execution); this.deps.onOwnershipChanged() }
    }
    if (terminalError) throw terminalError
    return options.signal?.aborted ? { status: 'cancelled' } : outcome
  }
  async cancelPlugin(pluginId: string): Promise<void> {
    const executions = [...this.active].filter(entry => entry.authority.snapshot.manifest.id === pluginId && !entry.authority.development)
    for (const entry of executions) entry.abort.abort()
    await Promise.all(executions.map(entry => entry.done))
  }
  async cancelDevelopmentSession(sessionId: string): Promise<void> {
    const executions = [...this.active].filter(entry => entry.authority.development?.sessionId === sessionId)
    for (const entry of executions) entry.abort.abort()
    await Promise.all(executions.map(entry => entry.done))
  }
  async closeAll(): Promise<void> { this.closed = true; for (const entry of this.active) entry.abort.abort(); await Promise.all([...this.active].map(entry => entry.done)) }
}
