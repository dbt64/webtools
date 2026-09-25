import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join, parse, resolve } from 'node:path'
import { shell } from 'electron'
import type { AppEntry } from '../../src/shared/domain'

interface CatalogRecord {
  entry: AppEntry
  sourcePath: string
}

export class AppCatalogService {
  private readonly records = new Map<string, CatalogRecord>()

  async refresh(): Promise<AppEntry[]> {
    if (process.platform !== 'win32') throw new Error('应用扫描目前仅支持 Windows。')

    const roots = [
      process.env.APPDATA && join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      process.env.ProgramData && join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    ].filter((path): path is string => Boolean(path))

    const next = new Map<string, CatalogRecord>()
    for (const root of roots) {
      for (const shortcut of await this.findShortcuts(root)) {
        try {
          const details = shell.readShortcutLink(shortcut)
          if (!details.target) continue
          const targetPath = resolve(details.target)
          const id = createHash('sha256').update(targetPath.toLocaleLowerCase()).digest('hex').slice(0, 16)
          const existing = next.get(id)
          if (existing) continue
          next.set(id, {
            entry: {
              id,
              name: details.description?.trim() || parse(shortcut).name,
              targetPath,
              sourcePath: shortcut,
            },
            sourcePath: shortcut,
          })
        } catch {
          // One malformed shortcut should not prevent the rest of the directory from loading.
        }
      }
    }

    this.records.clear()
    for (const [id, record] of next) this.records.set(id, record)
    return this.list()
  }

  list(): AppEntry[] {
    return [...this.records.values()].map(({ entry }) => entry).sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  }

  async launch(id: string): Promise<void> {
    const record = this.records.get(id)
    if (!record) throw new Error('找不到这个应用，请刷新应用列表后重试。')
    const error = await shell.openPath(record.sourcePath)
    if (error) throw new Error(`无法启动“${record.entry.name}”：${error}`)
  }

  private async findShortcuts(root: string): Promise<string[]> {
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      return []
    }

    const shortcuts: string[] = []
    for (const entry of entries) {
      const path = join(root, entry.name)
      if (entry.isDirectory()) shortcuts.push(...await this.findShortcuts(path))
      else if (entry.isFile() && entry.name.toLocaleLowerCase().endsWith('.lnk')) shortcuts.push(path)
    }
    return shortcuts
  }
}
