// Bounded packaged-acceptance effects. Unreachable without a packaged TEMP executable and isolated profile.
import { lstatSync, realpathSync, readFileSync, writeFileSync, watch, type FSWatcher } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { resolveWebRuntimeAcceptanceOptions, type WebRuntimeAcceptanceGuards, type WebRuntimeAcceptanceOptions } from './web-runtime-acceptance-options.ts'
import { validateWebPackageForRuntime } from '../plugins/package-validator.ts'
import type { PluginConsent } from '../plugins/permission-broker.ts'
import type { WebCapabilityEffects } from '../plugins/web-host-capabilities.ts'
import type { PluginManager } from '../plugins/plugin-manager.ts'
import type { WebPluginRuntime } from '../plugins/web-plugin-runtime.ts'
import { FeatureInvocationService } from './feature-invocation-service.ts'

const validatedOptions = new WeakSet<object>()
export const CAPABILITY_ACCEPTANCE_PLUGIN_ID = 'org.webtools.phase6e6.capabilities'
export const CAPABILITY_ACCEPTANCE_TEXT = '  中文 exact 😀 Phase6E6  '
export interface CapabilityAcceptanceOptions extends WebRuntimeAcceptanceOptions {}
interface Guards extends WebRuntimeAcceptanceGuards { packaged: boolean; executable: string; userDataPath: string }
export function resolveWebCapabilityAcceptanceOptions(argv: string[], env: NodeJS.ProcessEnv, guards: Guards): CapabilityAcceptanceOptions | null {
  if (!argv.includes('--phase6e6-capability-acceptance') || env.WEBTOOLS_PHASE6E6_ACCEPTANCE !== '1') return null
  const options = resolveWebRuntimeAcceptanceOptions(argv, env, guards)
  if (!options || !guards.packaged) throw new Error('Capability acceptance requires a packaged isolated runtime')
  const tempRoot = resolve(tmpdir()); const executable = resolve(guards.executable)
  const suffix = relative(tempRoot, executable)
  if (!isAbsolute(guards.executable) || !suffix || suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) throw new Error('Capability acceptance executable must be under TEMP')
  let current = tempRoot
  for (const segment of suffix.split(sep)) { current = join(current, segment); if (lstatSync(current).isSymbolicLink()) throw new Error('Capability acceptance path cannot contain links') }
  if (!lstatSync(executable).isFile() || realpathSync.native(options.profilePath) !== realpathSync.native(guards.userDataPath)) throw new Error('Capability acceptance profile mismatch')
  const safe = Object.freeze({ ...options }); validatedOptions.add(safe); return safe
}
export interface CapabilityAcceptanceHostOverrides {
  confirm(request: PluginConsent): Promise<boolean>
  choosePackage(): Promise<Uint8Array | null>
  webEffects: Omit<WebCapabilityEffects, 'hasForegroundGesture' | 'confirm'>
}
export async function createWebCapabilityAcceptance(options: CapabilityAcceptanceOptions, hostVersion: string) {
  if (!validatedOptions.has(options)) throw new Error('Unvalidated capability acceptance options')
  const bytes = await readFile(options.packagePath)
  const snapshot = await validateWebPackageForRuntime(bytes, hostVersion)
  if (snapshot.manifest.id !== CAPABILITY_ACCEPTANCE_PLUGIN_ID || snapshot.manifest.network.mode !== 'none'
    || !snapshot.manifest.features.some(f => f.id === 'capabilities') || !snapshot.manifest.features.some(f => f.id === 'read-only')) throw new Error('Unexpected capability acceptance fixture')
  const controlPath = join(options.profilePath, 'phase6e6-controls.json')
  const evidencePath = join(options.profilePath, 'phase6e6-effects.json')
  const stats = { confirmationCount: 0, deniedCount: 0, aiDispatchCount: 0, aiAbortCount: 0, clipboardEffectCount: 0,
    clipboardSha256: '', updateConfirmationPending: false, commandSequence: 0, commandFailed: false, lastAction: '', lastResult: '' }
  const persist = () => writeFileSync(evidencePath, JSON.stringify(stats))
  function control(): { mode: string; sequence: number; action: string } {
    try {
      const value = JSON.parse(readFileSync(controlPath, 'utf8'))
      if (!value || typeof value !== 'object' || !['accept', 'deny-ai', 'deny-clipboard', 'hold-ai', 'unconfigured', 'oversize-ai', 'hold-update', 'deny-update', 'approve-update', 'choose-network'].includes(value.mode)
        || !Number.isSafeInteger(value.sequence) || value.sequence < 0 || value.sequence > 16
        || !['', 'context', 'replacement', 'revoke', 'restore', 'disable', 'close-runtime'].includes(value.action)) throw new Error()
      return value
    } catch { return { mode: 'deny-ai', sequence: 0, action: '' } }
  }
  let disposed = false
  let cancelUpdateConfirmation: (() => void) | undefined
  async function updateDecision(): Promise<boolean> {
    stats.updateConfirmationPending = true; persist()
    return new Promise(resolveDecision => {
      let settled = false
      const decisionWatcher = watch(options.profilePath, (_event, name) => { if (name?.toString() === 'phase6e6-controls.json') inspect() })
      const finish = (accepted: boolean) => {
        if (settled) return
        settled = true
        decisionWatcher.close(); clearTimeout(deadline); cancelUpdateConfirmation = undefined
        stats.updateConfirmationPending = false; persist(); resolveDecision(accepted)
      }
      const inspect = () => { const mode = control().mode; if (mode === 'approve-update' || mode === 'deny-update' || disposed) finish(!disposed && mode === 'approve-update') }
      const deadline = setTimeout(() => finish(false), 10000)
      cancelUpdateConfirmation = () => finish(false); inspect()
    })
  }
  async function fixedReplacement(network: boolean): Promise<Buffer> {
    const file = join(dirname(options.packagePath), network ? 'phase6e6-network-fixture.wtplugin' : 'phase6e6-update-fixture.wtplugin')
    const stat = lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 20 * 1024 * 1024
      || realpathSync.native(file) !== file) throw new Error('Unsafe capability replacement fixture')
    const replacement = await readFile(file); const validated = await validateWebPackageForRuntime(replacement, hostVersion)
    if (validated.manifest.id !== CAPABILITY_ACCEPTANCE_PLUGIN_ID || validated.manifest.version !== (network ? '3.0.0' : '2.0.0')
      || validated.manifest.network.mode !== (network ? 'domains' : 'none')) throw new Error('Unexpected capability replacement fixture')
    return replacement
  }
  const hostOverrides: CapabilityAcceptanceHostOverrides = {
    confirm: async request => {
      const mode = control().mode
      const accepted = request.pluginId === CAPABILITY_ACCEPTANCE_PLUGIN_ID && request.kind !== 'delete-data'
        && !(request.kind === 'ai' && mode === 'deny-ai') && !(request.kind === 'clipboard' && mode === 'deny-clipboard')
        && !(request.kind === 'install' && mode === 'deny-update')
      stats.confirmationCount++; if (!accepted) stats.deniedCount++; persist()
      return accepted && request.kind === 'install' && mode === 'hold-update' ? updateDecision() : accepted
    },
    choosePackage: async () => {
      const mode = control().mode
      return ['hold-update', 'deny-update', 'approve-update', 'choose-network'].includes(mode)
        ? fixedReplacement(mode === 'choose-network') : Buffer.from(bytes)
    },
    webEffects: {
      isAIConfigured: async () => control().mode !== 'unconfigured',
      completeAI: async (_prompt, signal) => {
        stats.aiDispatchCount++; persist()
        if (control().mode !== 'hold-ai') return { text: 'Phase6E6 isolated AI response', outputTokens: control().mode === 'oversize-ai' ? 1025 : 8 }
        return new Promise<{ text: string; outputTokens: number }>((_resolve, reject) => {
          const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); stats.aiAbortCount++; persist(); reject(new Error('Isolated request cancelled')) }
          const timer = setTimeout(() => { signal.removeEventListener('abort', abort); reject(new Error('Isolated request deadline')) }, 5000)
          signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort()
        })
      },
      clipboardWrite: text => { stats.clipboardEffectCount++; stats.clipboardSha256 = createHash('sha256').update(text).digest('hex'); persist() },
    },
  }
  let watcher: FSWatcher | undefined
  let queued = Promise.resolve()
  persist()
  return {
    hostOverrides,
    start(manager: PluginManager, runtime: WebPluginRuntime): void {
      if (watcher || disposed) throw new Error('Capability acceptance already started')
      // The context fixture replaces only Native transport/gesture capture. It never supplies grants or runtime identity.
      const invocations = new FeatureInvocationService({ isConnected: () => !disposed, isTranslationEnabled: () => false,
        authorizeDeclarative: async () => { throw new Error('Not an acceptance route') }, openDeclarative: async () => {}, openTranslation: async () => {},
        isWebFeature: ref => manager.isWebPackage(ref.pluginId),
        authorizeWeb: (ref, dispatch) => manager.authorizeWebFeature(ref, manager.session, dispatch),
        openWeb: async (_id, authority, context) => { await runtime.openAuthority(authority, context) } })
      const processCommand = async () => {
        const item = control()
        if (disposed || item.sequence <= stats.commandSequence || !item.action) return
        stats.commandSequence = item.sequence; stats.lastAction = item.action; stats.lastResult = 'running'; persist()
        try {
          if (item.action === 'context') {
            const result = await invocations.invoke({ requestId: randomUUID(), ref: { pluginId: CAPABILITY_ACCEPTANCE_PLUGIN_ID, featureId: 'capabilities' }, source: 'launcher',
              context: { type: 'text', source: 'launcher-input', text: CAPABILITY_ACCEPTANCE_TEXT, capturedAtUnixMs: Date.now() } })
            if (result.status !== 'accepted') throw new Error('Context invocation rejected')
          } else if (item.action === 'replacement') {
            const ticket = await manager.authorizeWebFeature({ pluginId: CAPABILITY_ACCEPTANCE_PLUGIN_ID, featureId: 'read-only' }, manager.session,
              async authority => { await runtime.openAuthority(authority) }); await ticket.completion
          } else if (item.action === 'revoke') await manager.setGrants(CAPABILITY_ACCEPTANCE_PLUGIN_ID, ['plugin.storage.read'], manager.session)
          else if (item.action === 'restore') await manager.setGrants(CAPABILITY_ACCEPTANCE_PLUGIN_ID, snapshot.manifest.requestedCapabilities.slice(), manager.session)
          else if (item.action === 'disable') await manager.setEnabled(CAPABILITY_ACCEPTANCE_PLUGIN_ID, false, manager.session)
          else await runtime.close()
          stats.lastResult = 'PASS'
        } catch { stats.commandFailed = true; stats.lastResult = 'FAIL' }
        persist()
      }
      watcher = watch(options.profilePath, (_event, filename) => {
        if (filename?.toString() === 'phase6e6-controls.json') queued = queued.then(processCommand).catch(() => { stats.commandFailed = true; persist() })
      })
      void processCommand()
    },
    dispose(): void { disposed = true; cancelUpdateConfirmation?.(); watcher?.close(); watcher = undefined },
  }
}
