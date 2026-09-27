import { createHash } from 'node:crypto'
import { app, shell } from 'electron'
import { execFile } from 'node:child_process'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { WindowsAppSource, type CatalogRecord } from './windows-app-source'
import type { AppSearchEntry } from '../../src/shared/domain'

const execFileAsync = promisify(execFile)
type IndexedCatalogRecord = CatalogRecord & { id: string }

export class AppCatalogService {
  private readonly source = new WindowsAppSource()
  private readonly records = new Map<string, IndexedCatalogRecord>()
  private readonly icons = new Map<string, Promise<string | null>>()

  async refresh(): Promise<AppSearchEntry[]> {
    if (process.platform !== 'win32') throw new Error('应用扫描目前仅支持 Windows。')
    const next = new Map<string, IndexedCatalogRecord>()
    for (const record of await this.source.list()) {
      const target = record.launchTarget
      let key: string
      if (target.kind === 'aumid') key = `aumid:${target.appId.toLocaleLowerCase()}`
      else if (target.kind === 'system') key = `system:${target.app}`
      else {
        const path = (target.kind === 'shortcut' ? target.targetPath : target.path).toLocaleLowerCase()
        const args = target.kind === 'shortcut' ? target.args : ''
        const cwd = target.kind === 'shortcut' ? target.cwd.toLocaleLowerCase() : ''
        // Retain the existing ID for an invocation without arguments or a working directory.
        key = `path:${path}${args || cwd ? `:${JSON.stringify([args, cwd])}` : ''}`
      }
      const id = createHash('sha256').update(key).digest('hex').slice(0, 16)
      const existing = next.get(id)
      if (existing) {
        existing.aliases = [...new Set([...existing.aliases, record.name, ...record.aliases])]
        continue
      }
      next.set(id, { ...record, id })
    }
    this.records.clear()
    for (const [id, record] of next) this.records.set(id, record)
    this.icons.clear()
    return this.list()
  }

  list(): AppSearchEntry[] {
    return [...this.records.values()].map(({ id, name, aliases, source, icon }) => ({ id, name, aliases, source, icon }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  }

  getIcon(id: string): Promise<string | null> {
    const record = this.records.get(id)
    if (!record) return Promise.resolve(null)
    const cached = this.icons.get(id)
    if (cached) return cached
    const icon = this.resolveIcon(record).catch(() => null)
    this.icons.set(id, icon)
    return icon
  }

  private async resolveIcon(record: IndexedCatalogRecord): Promise<string | null> {
    const target = record.launchTarget
    if (target.kind === 'shortcut') {
      const shortcutIcon = await this.readIcon(target.shortcutPath)
      if (shortcutIcon) return shortcutIcon
      try {
        const declared = shell.readShortcutLink(target.shortcutPath).icon?.trim()
        if (declared) {
          const iconPath = isAbsolute(declared) ? declared : resolve(target.cwd || dirname(target.shortcutPath), declared)
          const declaredIcon = await this.readIcon(iconPath)
          if (declaredIcon) return declaredIcon
        }
      } catch { /* A malformed shortcut can still have a valid target icon. */ }
      return this.readIcon(target.targetPath)
    }
    if (target.kind === 'executable') return this.readIcon(target.path)
    if (target.kind === 'aumid') return null

    const systemRoot = process.env.SystemRoot || process.env.windir
    if (!systemRoot) return null
    const executable = {
      'file-explorer': join(systemRoot, 'explorer.exe'),
      'control-panel': join(systemRoot, 'System32', 'control.exe'),
      'device-manager': join(systemRoot, 'System32', 'mmc.exe'),
    }[target.app]
    return this.readIcon(executable)
  }

  private async readIcon(path: string): Promise<string | null> {
    try {
      const image = await app.getFileIcon(path, { size: 'normal' })
      return image.isEmpty() ? null : image.toDataURL()
    } catch { return null }
  }

  async launch(id: string): Promise<void> {
    const record = this.records.get(id)
    if (!record) throw new Error('找不到这个应用，请刷新后重试。')
    let error = ''
    if (record.launchTarget.kind === 'shortcut') error = await shell.openPath(record.launchTarget.shortcutPath)
    else if (record.launchTarget.kind === 'executable') error = await shell.openPath(record.launchTarget.path)
    else if (record.launchTarget.kind === 'aumid') {
      try {
        await execFileAsync('explorer.exe', [`shell:AppsFolder\\${record.launchTarget.appId}`], { windowsHide: true, timeout: 5000 })
      } catch (cause) { throw new Error(`无法启动“${record.name}”：${cause instanceof Error ? cause.message : '应用启动失败。'}`) }
    } else {
      const commands = {
        'file-explorer': ['explorer.exe', []],
        'control-panel': ['control.exe', []],
        'device-manager': ['mmc.exe', ['devmgmt.msc']],
      } as const
      const [executable, args] = commands[record.launchTarget.app]
      try {
        await new Promise<void>((resolve, reject) => {
          const child = execFile(executable, [...args], { windowsHide: true })
          child.once('error', reject)
          child.once('spawn', () => { child.unref(); resolve() })
        })
      } catch (cause) { throw new Error(`无法启动“${record.name}”：${cause instanceof Error ? cause.message : '应用启动失败。'}`) }
    }
    if (error) throw new Error(`无法启动“${record.name}”：${error}`)
  }
}
