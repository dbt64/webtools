import { clipboard, dialog, nativeImage, shell, type BrowserWindow } from 'electron'
import { open } from 'node:fs/promises'
import { extname } from 'node:path'
import type { DataStore } from '../services/data-store.ts'
import type { SharedAIService } from '../services/shared-ai-service.ts'
import { PluginManager } from './plugin-manager.ts'
import type { PluginConsent } from './permission-broker.ts'
import { formatPluginConsentDetail } from './plugin-consent-view.ts'
import { LIMITS } from './manifest.ts'
import { fail } from './errors.ts'
import type { WebCapabilityEffects } from './web-host-capabilities.ts'
import { completeSharedAIForWeb } from './web-host-capabilities.ts'
import { pluginRuntimeSession } from './plugin-runtime-session.ts'

const consentText: Record<PluginConsent['kind'], string> = {
  'reset-config': '恢复此插件的默认设置？当前设置将保留为一份备份，并替换上一次设置备份。插件私有数据不会被删除。',
  install: '导入本地声明式插件？发布者未经验证。导入不会自动授予权限。',
  replace: '同一插件版本的内容不同，确认替换当前版本？原内容保留用于回滚。',
  downgrade: '确认降级插件？不执行插件迁移代码；已有私有数据保持不变。',
  grant: '授予以下宿主能力？插件仅能使用列出的声明式操作。',
  uninstall: '卸载此插件？将停止操作并删除该插件的受管程序文件。',
  'delete-data': '还要删除此插件的配置和私有数据吗？默认保留。',
  external: '打开插件声明的 HTTPS 链接？', clipboard: '将以下内容写入剪贴板？', ai: '确认发送以下内容至当前共享 AI 服务？',
}
interface PluginRuntimeAcceptanceOverrides {
  confirm(request: PluginConsent): Promise<boolean>
  choosePackage(): Promise<Uint8Array | null>
  webEffects?: Partial<Omit<WebCapabilityEffects, 'hasForegroundGesture' | 'confirm'>>
}

export function createElectronPluginHost(deps: { userData: string; hostVersion: string; sharedAI: SharedAIService; dataStore: DataStore; getWindow(): BrowserWindow | null; deleteRuntimeData?(pluginId: string): Promise<void>; closeFeatureWindows?(pluginId: string): Promise<void>; clearTemporaryWindowTarget?(pluginId: string): void }, acceptance?: PluginRuntimeAcceptanceOverrides) {
  const window = () => { const w = deps.getWindow(); if (!w || w.isDestroyed() || w.webContents.isDestroyed()) fail('SESSION_EXPIRED'); return w }
  const confirmForWindow = async (getWindow: () => BrowserWindow | null, request: PluginConsent, signal?: AbortSignal, allowNoWindow = false): Promise<boolean> => {
    if (acceptance) return acceptance.confirm(request)
    const w = getWindow()
    if (w?.isDestroyed() || !w && !allowNoWindow) fail('SESSION_EXPIRED')
    // Native dialogs are the temporary 5C consent surface. Very large AI previews
    // stay unavailable until 5D can present the full request in a dedicated view.
    if ((request.preview?.length ?? 0) > 24_000) fail('USER_CONFIRMATION_REQUIRED')
    const deleting = request.kind === 'delete-data'
    const detail = formatPluginConsentDetail(request)
    const message = request.manifestVersion === 3 && request.runtimeKind === 'node' && ['install', 'replace', 'downgrade'].includes(request.kind)
      ? '安装或更新 Node 插件？该插件将以当前 Windows 用户身份运行本地代码。仅在信任来源和代码时继续。'
      : request.manifestVersion === 3 && request.kind === 'install'
      ? '导入本地 Web 插件？该插件包含未经验证发布者提供的网页代码。导入不会自动授予宿主能力。'
      : request.manifestVersion === 2 && request.kind === 'install'
      ? '导入本地 Web 插件？该插件包含未经验证发布者提供的可执行网页代码。导入不会自动授予宿主能力。'
      : (request.manifestVersion === 2 || request.manifestVersion === 3) && request.kind === 'grant' ? '授予以下 WebTools 宿主能力？插件仅能在声明的 Feature 中使用已授权的能力。' : consentText[request.kind]
    const options: Electron.MessageBoxOptions = { type: 'question', title: 'WebTools 插件', message, detail, buttons: deleting ? ['保留数据', '删除插件私有数据'] : ['取消', '确认'], defaultId: 0, cancelId: 0, noLink: true, signal }
    const result = await (w ? pluginRuntimeSession.withHostDialog(w, () => dialog.showMessageBox(w, options)) : dialog.showMessageBox(options))
    return !signal?.aborted && (!w || !w.isDestroyed() && getWindow() === w) && result.response === 1
  }
  const confirm = (request: PluginConsent, signal?: AbortSignal) => confirmForWindow(deps.getWindow, request, signal)
  const manager = new PluginManager({
    userData: deps.userData, hostVersion: deps.hostVersion, confirm,
    externalOpen: url => shell.openExternal(url), clipboardWrite: text => clipboard.writeText(text),
    pngDecoder: bytes => { const image = nativeImage.createFromBuffer(bytes); const size = image.getSize(); return !image.isEmpty() && size.width > 0 && size.height > 0 && size.width <= 256 && size.height <= 256 },
    deleteRuntimeData: deps.deleteRuntimeData,
    closeFeatureWindows: deps.closeFeatureWindows,
    clearTemporaryWindowTarget: deps.clearTemporaryWindowTarget,
    projectFeatureIcon: (snapshot, featureId) => {
      const features = snapshot.manifest.features
      const target = features.find(feature => feature.id === featureId)?.icon
      if (target?.kind === 'host') return undefined // Keep the declared Host token ahead of package asset fallback.
      const icon = target?.kind === 'asset' ? target : features.find(feature => feature.icon?.kind === 'asset')?.icon
      if (icon?.kind !== 'asset') return undefined
      const bytes = snapshot.getResource(icon.path)?.bytes
      if (!bytes) return undefined
      const image = nativeImage.createFromBuffer(bytes)
      if (image.isEmpty()) return undefined
      const png = image.resize({ width: 24, height: 24 }).toPNG()
      return png.length <= 4096 ? `data:image/png;base64,${png.toString('base64')}` : undefined
    },
    ai: {
      complete: (messages, signal, tokens) => deps.sharedAI.complete(messages, signal, tokens),
      getDefaultProviderInfo: async () => {
        const info = await deps.sharedAI.getDefaultProviderInfo()
        const settings = deps.dataStore.snapshot().settings.sharedAI
        const selected = settings.providers[settings.defaultProviderId]
        return { providerName: info.providerName, model: info.model, identity: JSON.stringify([settings.defaultProviderId, selected]) }
      },
    },
  })
  const choosePackage = async (): Promise<Uint8Array | null> => {
    if (acceptance) return acceptance.choosePackage()
    const w = window(); const result = await pluginRuntimeSession.withHostDialog(w, () => dialog.showOpenDialog(w, { title: '导入声明式插件', properties: ['openFile'], filters: [{ name: 'WebTools 插件', extensions: ['wtplugin'] }] }))
    if (w.isDestroyed() || deps.getWindow() !== w) fail('SESSION_EXPIRED')
    if (result.canceled || result.filePaths.length !== 1) return null
    const path = result.filePaths[0]; if (extname(path).toLowerCase() !== '.wtplugin') fail('INVALID_PACKAGE')
    const file = await open(path, 'r')
    try {
      const stat = await file.stat(); if (!stat.isFile() || !stat.size || stat.size > LIMITS.archive) fail('INVALID_PACKAGE')
      const chunks: Buffer[] = []; let total = 0
      for (;;) { const buffer = Buffer.alloc(Math.min(65536, LIMITS.archive + 1 - total)); const { bytesRead } = await file.read(buffer); if (!bytesRead) break; total += bytesRead; if (total > LIMITS.archive) fail('INVALID_PACKAGE'); chunks.push(buffer.subarray(0, bytesRead)) }
      return Buffer.concat(chunks)
    } finally { await file.close() }
  }
  const webEffects: Omit<WebCapabilityEffects, 'hasForegroundGesture'> = {
    confirm, clipboardWrite: text => clipboard.writeText(text), externalOpen: url => shell.openExternal(url),
    isAIConfigured: async () => (await deps.sharedAI.getDefaultProviderInfo()).configured,
    completeAI: (prompt, signal) => completeSharedAIForWeb(deps.sharedAI, prompt, signal),
    ...acceptance?.webEffects,
  }
  const webEffectsForWindow = (getWindow: () => BrowserWindow | null): Omit<WebCapabilityEffects, 'hasForegroundGesture'> => ({
    ...webEffects, confirm: (request, signal) => confirmForWindow(getWindow, request, signal),
  })
  const commandEffects = { ...webEffects, confirm: (request: PluginConsent, signal?: AbortSignal) => confirmForWindow(() => null, request, signal, true) }
  return { manager, choosePackage, webEffects, webEffectsForWindow, commandEffects }
}
