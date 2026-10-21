import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { PluginConsent } from '../plugins/permission-broker.ts'
import type { PluginRuntimeAcceptanceOptions } from './plugin-runtime-acceptance-options.ts'
import { isPluginRuntimeAcceptanceOptions } from './plugin-runtime-acceptance-options.ts'

export const PLUGIN_RUNTIME_ACCEPTANCE_ID = 'org.webtools.acceptance.runtime'
export const PLUGIN_RUNTIME_ACCEPTANCE_ISOLATION_ID = 'org.webtools.acceptance.runtime-isolation'

interface AcceptanceControl { package: 'fixture' | 'update' | 'isolation'; deleteData: boolean; resetConfig?: boolean }
interface AcceptanceStats {
  confirmations: string[]
  upgradeConfirmations: Array<{ pluginId: string; currentVersion: string; incomingVersion: string; runtimeKind: 'node' | 'web' }>
  aiCalls: number
  clipboardWriteCount: number
  externalOpenCount: number
  externalUrlSha256: string | null
}
export interface PluginRuntimeAcceptanceHostOverrides {
  confirm(request: PluginConsent): Promise<boolean>
  choosePackage(): Promise<Uint8Array>
  chooseDevelopmentProject(): string
  confirmDevelopmentProject(pkg: { manifest: { id: string } }): boolean
  webEffects: {
    isAIConfigured(): Promise<boolean>
    completeAI(prompt: string, signal: AbortSignal): Promise<{ text: string; outputTokens: number }>
    clipboardWrite(text: string): void
    externalOpen(url: string): Promise<void>
  }
}

function readControl(path: string): AcceptanceControl {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 1024) throw new Error('Invalid Plugin Runtime acceptance control file.')
  let value: unknown
  try { value = JSON.parse(readFileSync(path, 'utf8')) } catch { throw new Error('Invalid Plugin Runtime acceptance control file.') }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !['deleteData,package', 'deleteData,package,resetConfig'].includes(Object.keys(value).sort().join(','))
    || !['fixture', 'update', 'isolation'].includes((value as AcceptanceControl).package)
    || typeof (value as AcceptanceControl).deleteData !== 'boolean'
    || ('resetConfig' in value && typeof value.resetConfig !== 'boolean')) throw new Error('Invalid Plugin Runtime acceptance control file.')
  return value as AcceptanceControl
}

function isExpectedPluginRequest(request: PluginConsent): boolean {
  return [PLUGIN_RUNTIME_ACCEPTANCE_ID, PLUGIN_RUNTIME_ACCEPTANCE_ISOLATION_ID, 'org.webtools.selected-text-actions'].includes(request.pluginId)
    && ['install', 'replace', 'downgrade', 'grant', 'uninstall', 'delete-data', 'reset-config', 'ai', 'clipboard'].includes(request.kind)
}

/** Test-only consent/effect seam. It cannot be constructed without the packaged TEMP path resolver. */
export function createPluginRuntimeAcceptanceHostOverrides(options: PluginRuntimeAcceptanceOptions): PluginRuntimeAcceptanceHostOverrides {
  if (!isPluginRuntimeAcceptanceOptions(options)) throw new TypeError('Unvalidated Runtime 2.0 acceptance options')
  const controlPath = join(options.profilePath, 'plugin-runtime-controls.json')
  const effectsPath = join(options.profilePath, 'plugin-runtime-effects.json')
  const stats: AcceptanceStats = { confirmations: [], upgradeConfirmations: [], aiCalls: 0, clipboardWriteCount: 0, externalOpenCount: 0, externalUrlSha256: null }
  const persist = () => writeFileSync(effectsPath, JSON.stringify(stats))
  const selectedPath = () => {
    const selectedPackage = readControl(controlPath).package
    const selected = selectedPackage === 'fixture' ? options.fixturePath
      : selectedPackage === 'update' ? options.updatePath : options.isolationPath
    const stat = lstatSync(selected)
    if (!stat.isFile() || stat.isSymbolicLink() || realpathSync.native(selected) !== selected
      || stat.size < 1 || stat.size > 512 * 1024 * 1024) throw new Error('Unsafe Runtime 2.0 acceptance package.')
    return selected
  }
  persist()
  return Object.freeze({
    confirm: async (request: PluginConsent) => {
      if (!isExpectedPluginRequest(request)) return false
      const control = readControl(controlPath)
      stats.confirmations.push(request.kind)
      if (request.kind === 'install' && request.versionChange?.kind === 'upgrade' && request.versionChange.currentVersion
        && (request.runtimeKind === 'node' || request.runtimeKind === 'web')) {
        stats.upgradeConfirmations.push({ pluginId: request.pluginId, currentVersion: request.versionChange.currentVersion,
          incomingVersion: request.versionChange.incomingVersion, runtimeKind: request.runtimeKind })
      }
      persist()
      return request.kind === 'delete-data' ? control.deleteData : request.kind === 'reset-config' ? control.resetConfig === true : true
    },
    choosePackage: async () => Uint8Array.from(readFileSync(selectedPath())),
    chooseDevelopmentProject: () => {
      const project = join(options.rootPath, 'author')
      const directory = lstatSync(project)
      if (!directory.isDirectory() || directory.isSymbolicLink() || realpathSync.native(project) !== project) throw new Error('Unsafe isolated development project.')
      const manifestPath = join(project, 'manifest.json'); const manifest = lstatSync(manifestPath)
      if (!manifest.isFile() || manifest.isSymbolicLink() || manifest.size > 64 * 1024) throw new Error('Unsafe isolated development manifest.')
      if (JSON.parse(readFileSync(manifestPath, 'utf8')).id !== PLUGIN_RUNTIME_ACCEPTANCE_ID) throw new Error('Unexpected isolated development identity.')
      return project
    },
    confirmDevelopmentProject: (pkg: { manifest: { id: string } }) => pkg.manifest.id === PLUGIN_RUNTIME_ACCEPTANCE_ID,
    webEffects: Object.freeze({
      isAIConfigured: async () => true,
      completeAI: async (prompt: string, signal: AbortSignal) => {
        stats.aiCalls++
        persist()
        if (signal.aborted) throw Object.assign(new Error('Cancelled'), { code: 'CANCELLED' })
        return { text: `Isolated acceptance response: ${prompt.slice(0, 80)}`, outputTokens: 8 }
      },
      clipboardWrite: (_text: string) => {
        stats.clipboardWriteCount++
        persist()
      },
      externalOpen: async (url: string) => {
        stats.externalOpenCount++
        stats.externalUrlSha256 = createHash('sha256').update(url).digest('hex')
        persist()
      },
    }),
  })
}
