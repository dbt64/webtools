import { readdir, stat } from 'node:fs/promises'
import { join, parse, resolve, basename, dirname, isAbsolute } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { app, shell } from 'electron'

const execFileAsync = promisify(execFile)

export type LaunchTarget =
  | { kind: 'shortcut'; shortcutPath: string; targetPath: string; args: string; cwd: string }
  | { kind: 'executable'; path: string }
  | { kind: 'aumid'; appId: string }
  | { kind: 'system'; app: 'file-explorer' | 'control-panel' | 'device-manager' }

export interface CatalogRecord {
  id?: string
  name: string
  aliases: string[]
  source: 'desktop' | 'packaged' | 'system'
  icon?: string
  launchTarget: LaunchTarget
}

interface StartApp { Name?: string; AppID?: string }
interface AppPathRecord { Name: string; Path: string }

export class WindowsAppSource {
  async list(): Promise<CatalogRecord[]> {
    if (process.platform !== 'win32') return []
    const records: CatalogRecord[] = []
    let userDesktop: string | undefined
    try { userDesktop = app.getPath('desktop') } catch { /* The Desktop may be unavailable. */ }
    const roots = [
      process.env.APPDATA && join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      process.env.ProgramData && join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      userDesktop,
      process.env.PUBLIC && join(process.env.PUBLIC, 'Desktop'),
    ].filter((path): path is string => Boolean(path))
    const seenRoots = new Set<string>()
    for (const root of roots) {
      const rootKey = resolve(root).toLocaleLowerCase()
      if (seenRoots.has(rootKey)) continue
      seenRoots.add(rootKey)
      let shortcuts: string[]
      try { shortcuts = await this.findShortcuts(root) } catch { continue }
      for (const shortcut of shortcuts) {
        try {
          const details = shell.readShortcutLink(shortcut)
          if (!details.target) continue
          const cwd = details.cwd?.trim()
            ? resolve(dirname(shortcut), details.cwd.trim())
            : ''
          const targetPath = isAbsolute(details.target)
            ? resolve(details.target)
            : resolve(cwd || dirname(shortcut), details.target)
          if (!(await stat(targetPath).catch(() => null))?.isFile()) continue
          const name = parse(shortcut).name.trim()
          if (!name) continue
          const aliases = [details.description, basename(targetPath).replace(/\.exe$/i, '')].filter((x): x is string => Boolean(x?.trim()))
          records.push({ name, aliases: [...new Set(aliases)], source: 'desktop', launchTarget: { kind: 'shortcut', shortcutPath: shortcut, targetPath, args: details.args?.trim() || '', cwd } })
        } catch { /* Ignore malformed shortcuts individually. */ }
      }
    }
    records.push(...await this.startApps())
    records.push(...await this.appPaths())
    records.push(
      { name: '文件资源管理器', aliases: ['File Explorer', 'Explorer', 'explorer.exe'], source: 'system', launchTarget: { kind: 'system', app: 'file-explorer' } },
      { name: '控制面板', aliases: ['Control Panel', 'control.exe'], source: 'system', launchTarget: { kind: 'system', app: 'control-panel' } },
      { name: '设备管理器', aliases: ['Device Manager', 'devmgmt.msc'], source: 'system', launchTarget: { kind: 'system', app: 'device-manager' } },
    )
    return records
  }

  private async startApps(): Promise<CatalogRecord[]> {
    const script = "Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress"
    try {
      const { stdout } = await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 8000, maxBuffer: 4 * 1024 * 1024 })
      const parsed: unknown = JSON.parse(stdout.trim() || '[]')
      const rows = Array.isArray(parsed) ? parsed : [parsed]
      return rows.flatMap((row: StartApp) => {
        if (typeof row.Name !== 'string' || typeof row.AppID !== 'string' || !row.AppID.trim()) return []
        const appId = row.AppID.trim()
        if (!appId.includes('!')) return []
        return [{ name: row.Name.trim(), aliases: [appId], source: 'packaged' as const, launchTarget: { kind: 'aumid' as const, appId } }]
      })
    } catch { return [] }
  }

  private async appPaths(): Promise<CatalogRecord[]> {
    const script = `$roots = @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths'); $rows = foreach ($root in $roots) { if (Test-Path $root) { foreach ($key in (Get-ChildItem $root -ErrorAction SilentlyContinue)) { $sub = Get-Item $key.PSPath; [pscustomobject]@{ Name=$key.PSChildName; Path=[string]$sub.GetValue('') } } } }; $rows | ConvertTo-Json -Compress`
    try {
      const { stdout } = await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 8000, maxBuffer: 4 * 1024 * 1024 })
      const parsed: unknown = JSON.parse(stdout.trim() || '[]')
      const rows = Array.isArray(parsed) ? parsed : [parsed]
      const candidates: CatalogRecord[] = rows.flatMap((row: AppPathRecord) => {
        if (typeof row.Name !== 'string' || typeof row.Path !== 'string') return []
        const path = resolve(row.Path.trim().replace(/^"|"$/g, ''))
        if (!/\.exe$/i.test(path) || /[\r\n\0]/.test(path)) return []
        const name = row.Name.replace(/\.exe$/i, '').trim()
        return [{ name, aliases: [row.Name, basename(path, '.exe')], source: 'desktop' as const, launchTarget: { kind: 'executable' as const, path } }]
      })
      const verified: CatalogRecord[] = []
      for (const record of candidates) {
        if (record.launchTarget.kind === 'executable' && !(await stat(record.launchTarget.path).catch(() => null))?.isFile()) continue
        verified.push(record)
      }
      return verified
    } catch { return [] }
  }

  private async findShortcuts(root: string): Promise<string[]> {
    let entries
    try { entries = await readdir(root, { withFileTypes: true }) } catch { return [] }
    const shortcuts: string[] = []
    for (const entry of entries) {
      const path = join(root, entry.name)
      if (entry.isDirectory()) shortcuts.push(...await this.findShortcuts(path))
      else if (entry.isFile() && entry.name.toLocaleLowerCase().endsWith('.lnk')) shortcuts.push(path)
    }
    return shortcuts
  }
}
