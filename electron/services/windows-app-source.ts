import { readdir } from 'node:fs/promises'
import { join, parse, resolve, basename } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { shell } from 'electron'

const execFileAsync = promisify(execFile)

export type LaunchTarget =
  | { kind: 'shortcut'; shortcutPath: string; targetPath: string }
  | { kind: 'executable'; path: string }
  | { kind: 'aumid'; appId: string }

export interface CatalogRecord {
  id?: string
  name: string
  aliases: string[]
  source: 'desktop' | 'packaged'
  icon?: string
  launchTarget: LaunchTarget
}

interface StartApp { Name?: string; AppID?: string }
interface AppPathRecord { Name: string; Path: string }

export class WindowsAppSource {
  async list(): Promise<CatalogRecord[]> {
    if (process.platform !== 'win32') return []
    const records: CatalogRecord[] = []
    const roots = [
      process.env.APPDATA && join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      process.env.ProgramData && join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    ].filter((path): path is string => Boolean(path))
    for (const root of roots) {
      for (const shortcut of await this.findShortcuts(root)) {
        try {
          const details = shell.readShortcutLink(shortcut)
          if (!details.target) continue
          const name = parse(shortcut).name.trim()
          const aliases = [details.description, basename(details.target).replace(/\.exe$/i, ''), details.target].filter((x): x is string => Boolean(x?.trim()))
          records.push({ name, aliases: [...new Set(aliases)], source: 'desktop', launchTarget: { kind: 'shortcut', shortcutPath: shortcut, targetPath: resolve(details.target) } })
        } catch { /* Ignore malformed shortcuts individually. */ }
      }
    }
    records.push(...await this.startApps())
    records.push(...await this.appPaths())
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
      return rows.flatMap((row: AppPathRecord) => {
        if (typeof row.Name !== 'string' || typeof row.Path !== 'string') return []
        const path = resolve(row.Path.trim().replace(/^"|"$/g, ''))
        if (!/\.exe$/i.test(path) || /[\r\n\0]/.test(path)) return []
        const name = row.Name.replace(/\.exe$/i, '').trim()
        return [{ name, aliases: [row.Name, basename(path, '.exe')], source: 'desktop' as const, launchTarget: { kind: 'executable' as const, path } }]
      })
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
