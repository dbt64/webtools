import { dialog, session, type BrowserWindow, type Session, type WebContents } from 'electron'
import { createRuntimeOrigin, parseRuntimePackageUrl, selectValidatedWebFeature } from './web-runtime-policy.ts'
import type { ValidatedPluginRuntimeSnapshot } from './package-validator.ts'
import type { WebFeatureAuthority } from './web-feature-authority.ts'

interface RuntimeSessionOwner {
  contents: WebContents
  window: BrowserWindow
  host: string
  snapshot: ValidatedPluginRuntimeSnapshot
  featureId: string
  authority?: WebFeatureAuthority
  current(): boolean
  foregroundGesture(consume: boolean): boolean
}

/** One persistent browser partition, with routing owned by each live Runtime. */
export class PluginRuntimeSession {
  private value: Session | null = null
  private readonly owners = new Map<number, RuntimeSessionOwner & { pendingHostDialogs: number }>()
  private managerDialogOwner: { window: BrowserWindow; pendingHostDialogs: number } | null = null
  onHostDialogsClosed?: (window: BrowserWindow) => void
  private readonly notificationGrants = new Set<string>()
  private cleanup: Promise<void> = Promise.resolve()
  registerManagerWindow(window: BrowserWindow): () => void {
    const owner = { window, pendingHostDialogs: 0 }
    this.managerDialogOwner = owner
    return () => { if (this.managerDialogOwner === owner) this.managerDialogOwner = null }
  }
  hasPendingHostDialogs(window: BrowserWindow): boolean {
    return Boolean(this.managerDialogOwner?.window === window && this.managerDialogOwner.pendingHostDialogs > 0)
      || [...this.owners.values()].some(owner => owner.window === window && owner.pendingHostDialogs > 0)
  }
  async withHostDialog<T>(window: BrowserWindow, show: () => Promise<T>): Promise<T> {
    const owner = this.managerDialogOwner?.window === window ? this.managerDialogOwner
      : [...this.owners.values()].find(item => item.window === window && item.current())
    if (!owner) return show()
    owner.pendingHostDialogs++
    try { return await show() }
    finally {
      owner.pendingHostDialogs--
      const attached = this.managerDialogOwner === owner || [...this.owners.values()].some(item => item === owner)
      if (attached && !this.hasPendingHostDialogs(window)) this.onHostDialogsClosed?.(window)
    }
  }
  async get(): Promise<Session> {
    await this.cleanup
    if (this.value) return this.value
    const current = session.fromPartition('persist:webtools-web-plugin-runtime')
    const ownerFor = (contents: WebContents | null) => contents ? this.owners.get(contents.id) : undefined
    current.setPermissionRequestHandler((contents, permission, callback) => {
      const owner = ownerFor(contents)
      if (!owner?.current() || owner.snapshot.manifest.manifestVersion !== 3) { callback(false); return }
      const capability = permission === 'clipboard-read' ? 'clipboard.read'
        : permission === 'clipboard-sanitized-write' ? 'clipboard.write' : undefined
      if (capability) { callback(Boolean(owner.authority?.isCurrent(capability) && owner.foregroundGesture(true))); return }
      if (permission !== 'notifications') { callback(false); return }
      const origin = `webtools-plugin://${owner.host}`
      if (this.notificationGrants.has(origin)) { callback(true); return }
      void this.withHostDialog(owner.window, () => dialog.showMessageBox(owner.window, { type: 'question', title: '插件权限', message: '允许此插件显示系统通知？',
        detail: owner.snapshot.manifest.name, buttons: ['拒绝', '允许'], defaultId: 0, cancelId: 0, noLink: true }))
        .then(result => { const allowed = result.response === 1 && owner.current(); if (allowed) this.notificationGrants.add(origin); callback(allowed) }, () => callback(false))
    })
    current.setPermissionCheckHandler((contents, permission) => {
      const owner = ownerFor(contents)
      if (!owner?.current() || owner.snapshot.manifest.manifestVersion !== 3) return false
      if (permission === 'notifications') return this.notificationGrants.has(`webtools-plugin://${owner.host}`)
      if (permission === 'clipboard-read') return Boolean(owner.authority?.isCurrent('clipboard.read'))
      if (permission === 'clipboard-sanitized-write') return Boolean(owner.authority?.isCurrent('clipboard.write'))
      return false
    })
    current.on('will-download', (_event, item, contents) => {
      const owner = ownerFor(contents)
      if (!owner?.current() || owner.snapshot.manifest.manifestVersion !== 3) { item.cancel(); return }
      item.pause()
      const name = item.getFilename().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 180) || 'download'
      void this.withHostDialog(owner.window, () => dialog.showSaveDialog(owner.window, { title: '保存插件下载', defaultPath: name })).then(result => {
        if (result.canceled || !result.filePath || !owner.current()) { item.cancel(); return }
        item.setSavePath(result.filePath); item.resume()
      }, () => item.cancel())
    })
    current.protocol.handle('webtools-plugin', async request => {
      let host: string
      try { host = new URL(request.url).hostname } catch { return new Response('', { status: 404 }) }
      const owner = [...this.owners.values()].find(candidate => candidate.host === host && candidate.current())
      const path = owner ? parseRuntimePackageUrl(request.url, owner.host) : null
      const resource = owner?.snapshot.getResource(path ?? '')
      if (!owner || !resource || !['GET', 'HEAD'].includes(request.method)) return new Response('', { status: 404 })
      return new Response(request.method === 'HEAD' ? null : Uint8Array.from(resource.bytes), { status: 200, headers: {
        'content-type': resource.mimeType, 'content-security-policy': selectValidatedWebFeature(owner.snapshot, owner.featureId).csp,
        'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
      } })
    })
    this.value = current
    return current
  }
  async attach(owner: RuntimeSessionOwner): Promise<() => Promise<void>> {
    await this.cleanup
    if (!owner.current()) throw new Error('Runtime was revoked before Session attachment.')
    if ([...this.owners.values()].some(item => item.host === owner.host && item.snapshot.packageHash !== owner.snapshot.packageHash)) {
      throw new Error('The plugin origin is still serving a different validated package.')
    }
    const attached = { ...owner, pendingHostDialogs: 0 }
    this.owners.set(owner.contents.id, attached)
    return async () => {
      if (this.owners.get(owner.contents.id) !== attached) return
      this.owners.delete(owner.contents.id)
      if (this.owners.size === 0 && this.value) {
        const current = this.value
        this.cleanup = (async () => {
          let timer: NodeJS.Timeout | undefined
          try {
            await Promise.race([current.closeAllConnections(), new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('Plugin Session cleanup timed out.')), 5000); timer.unref?.()
            })])
          } finally { clearTimeout(timer) }
        })()
        await this.cleanup
      }
    }
  }
  async clearPluginData(pluginId: string): Promise<void> { await (await this.get()).clearStorageData({ origin: createRuntimeOrigin(pluginId).origin }) }
}

export const pluginRuntimeSession = new PluginRuntimeSession()
