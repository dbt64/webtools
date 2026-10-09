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
import type { CapabilityAcceptanceHostOverrides } from '../services/web-capability-acceptance.ts'

const consentText: Record<PluginConsent['kind'], string> = {
  install: '导入本地声明式插件？发布者未经验证。导入不会自动授予权限。',
  replace: '同一插件版本的内容不同，确认替换当前版本？原内容保留用于回滚。',
  downgrade: '确认降级插件？不执行插件迁移代码；已有私有数据保持不变。',
  grant: '授予以下宿主能力？插件仅能使用列出的声明式操作。',
  uninstall: '卸载此插件？将停止操作并删除该插件的受管程序文件。',
  'delete-data': '还要删除此插件的配置和私有数据吗？默认保留。',
  external: '打开插件声明的 HTTPS 链接？', clipboard: '将以下内容写入剪贴板？', ai: '确认发送以下内容至当前共享 AI 服务？',
}
export function createElectronPluginHost(deps: { userData: string; hostVersion: string; sharedAI: SharedAIService; dataStore: DataStore; getWindow(): BrowserWindow | null }, acceptance?: CapabilityAcceptanceHostOverrides) {
  const window = () => { const w = deps.getWindow(); if (!w || w.isDestroyed() || w.webContents.isDestroyed()) fail('SESSION_EXPIRED'); return w }
  const confirm = async (request: PluginConsent, signal?: AbortSignal): Promise<boolean> => {
    if (acceptance) return acceptance.confirm(request)
    const w = window()
    // Native dialogs are the temporary 5C consent surface. Very large AI previews
    // stay unavailable until 5D can present the full request in a dedicated view.
    if ((request.preview?.length ?? 0) > 24_000) fail('USER_CONFIRMATION_REQUIRED')
    const deleting = request.kind === 'delete-data'
    const detail = formatPluginConsentDetail(request)
    const message = request.manifestVersion === 2 && request.kind === 'install'
      ? '导入本地 Web 插件？该插件包含未经验证发布者提供的可执行网页代码。导入不会自动授予宿主能力。'
      : request.manifestVersion === 2 && request.kind === 'grant' ? '授予以下宿主能力？Web 插件仅能在声明的 Feature 中使用已授权的能力。' : consentText[request.kind]
    const result = await dialog.showMessageBox(w, { type: 'question', title: 'WebTools 插件', message, detail, buttons: deleting ? ['保留数据', '删除插件私有数据'] : ['取消', '确认'], defaultId: 0, cancelId: 0, noLink: true, signal })
    return !signal?.aborted && !w.isDestroyed() && deps.getWindow() === w && result.response === 1
  }
  const manager = new PluginManager({
    userData: deps.userData, hostVersion: deps.hostVersion, confirm,
    externalOpen: url => shell.openExternal(url), clipboardWrite: text => clipboard.writeText(text),
    pngDecoder: bytes => { const image = nativeImage.createFromBuffer(bytes); const size = image.getSize(); return !image.isEmpty() && size.width > 0 && size.height > 0 && size.width <= 256 && size.height <= 256 },
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
    const w = window(); const result = await dialog.showOpenDialog(w, { title: '导入声明式插件', properties: ['openFile'], filters: [{ name: 'WebTools 插件', extensions: ['wtplugin'] }] })
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
    confirm, clipboardWrite: text => clipboard.writeText(text),
    isAIConfigured: async () => (await deps.sharedAI.getDefaultProviderInfo()).configured,
    completeAI: (prompt, signal) => completeSharedAIForWeb(deps.sharedAI, prompt, signal),
    ...acceptance?.webEffects,
  }
  return { manager, choosePackage, webEffects }
}
