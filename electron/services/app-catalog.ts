import { createHash } from 'node:crypto'
import { shell } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { WindowsAppSource, type CatalogRecord } from './windows-app-source'
import type { AppSearchEntry } from '../../src/shared/domain'

const execFileAsync = promisify(execFile)
type IndexedCatalogRecord = CatalogRecord & { id: string }

export class AppCatalogService {
  private readonly source = new WindowsAppSource()
  private readonly records = new Map<string, IndexedCatalogRecord>()

  async refresh(): Promise<AppSearchEntry[]> {
    if (process.platform !== 'win32') throw new Error('应用扫描目前仅支持 Windows。')
    const next = new Map<string, IndexedCatalogRecord>()
    for (const record of await this.source.list()) {
      const key = record.launchTarget.kind === 'aumid'
        ? `aumid:${record.launchTarget.appId.toLocaleLowerCase()}`
        : `path:${record.launchTarget.kind === 'shortcut' ? record.launchTarget.targetPath : record.launchTarget.path}`.toLocaleLowerCase()
      const id = createHash('sha256').update(key).digest('hex').slice(0, 16)
      const existing = next.get(id)
      if (existing) {
        existing.aliases = [...new Set([...existing.aliases, ...record.aliases])]
        if (existing.launchTarget.kind === 'aumid' && record.launchTarget.kind !== 'aumid') next.set(id, { ...record, id })
        continue
      }
      next.set(id, { ...record, id })
    }
    this.records.clear()
    for (const [id, record] of next) this.records.set(id, record)
    return this.list()
  }

  list(): AppSearchEntry[] {
    return [...this.records.values()].map(({ id, name, aliases, source, icon }) => ({ id, name, aliases, source, icon }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  }

  async launch(id: string): Promise<void> {
    const record = this.records.get(id)
    if (!record) throw new Error('找不到这个应用，请刷新后重试。')
    let error = ''
    if (record.launchTarget.kind === 'shortcut') error = await shell.openPath(record.launchTarget.shortcutPath)
    else if (record.launchTarget.kind === 'executable') error = await shell.openPath(record.launchTarget.path)
    else {
      try {
        await execFileAsync('explorer.exe', [`shell:AppsFolder\\${record.launchTarget.appId}`], { windowsHide: true, timeout: 5000 })
      } catch (cause) { throw new Error(`无法启动“${record.name}”：${cause instanceof Error ? cause.message : '应用启动失败。'}`) }
    }
    if (error) throw new Error(`无法启动“${record.name}”：${error}`)
  }
}
