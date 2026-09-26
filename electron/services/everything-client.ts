import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, stat } from 'node:fs/promises'
import { delimiter, basename, dirname, isAbsolute, join } from 'node:path'
import { shell } from 'electron'
import type { EverythingResult } from '../../src/shared/domain'

const execFileAsync = promisify(execFile)
const COMMAND_TIMEOUT_MS = 1500
const MAX_OUTPUT_BYTES = 1_000_000
const MAX_RESULTS = 20

function compareVersion(left: string, right: string): number {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const delta = (a[i] ?? 0) - (b[i] ?? 0)
    if (delta) return delta
  }
  return 0
}

function parseCsv(text: string): string[] {
  const values: string[] = []
  let value = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quoted && char === '"' && text[i + 1] === '"') { value += '"'; i += 1 }
    else if (char === '"') quoted = !quoted
    else if (!quoted && (char === '\r' || char === '\n')) {
      if (value) values.push(value)
      value = ''
      if (char === '\r' && text[i + 1] === '\n') i += 1
    } else if (!quoted && char === ',') {
      values.push(value)
      value = ''
    } else value += char
  }
  if (value) values.push(value)
  return values.map((item) => item.trim()).filter(Boolean)
}

function fullPathFromJson(value: unknown): string | undefined {
  if (typeof value === 'string') return isAbsolute(value) ? value : undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const fields = new Map(Object.entries(record).map(([key, item]) => [key.toLowerCase().replace(/[ _-]/g, ''), item]))
  for (const key of ['fullpathandname', 'filename', 'fullname', 'name']) {
    const item = fields.get(key)
    if (typeof item === 'string' && isAbsolute(item)) return item
  }
  const path = fields.get('path')
  const name = fields.get('name')
  if (typeof path === 'string' && typeof name === 'string' && isAbsolute(path)) return join(path, name)
  return undefined
}

export class EverythingClient {
  private readonly resultPaths = new Map<string, string>()
  private cachedStatus?: { at: number; configuredPath?: string; result: { executablePath?: string; running: boolean; version?: string } }
  private searchSequence = 0

  constructor(private readonly getConfiguredPath: () => string) {}

  async detect(configuredPath = this.getConfiguredPath()): Promise<{ executablePath?: string; running: boolean; version?: string }> {
    if (this.cachedStatus && this.cachedStatus.configuredPath === configuredPath && Date.now() - this.cachedStatus.at < 10_000) return this.cachedStatus.result
    const executablePath = await this.findExecutable(configuredPath)
    if (!executablePath) return this.cacheStatus(configuredPath, { running: false })
    let version: string | undefined
    try {
      const versionResult = await execFileAsync(executablePath, ['-version'], { windowsHide: true, timeout: 1000, maxBuffer: 4096 })
      version = /\d+\.\d+\.\d+\.\d+/.exec(versionResult.stdout)?.[0]
    } catch { /* Older ES clients may not expose version output. */ }
    try {
      await execFileAsync(executablePath, ['-get-everything-version'], { windowsHide: true, timeout: 1000, maxBuffer: 4096 })
      return this.cacheStatus(configuredPath, { executablePath, running: true, version })
    } catch {
      return this.cacheStatus(configuredPath, { executablePath, running: false, version })
    }
  }

  async search(query: string, limit = MAX_RESULTS): Promise<EverythingResult[]> {
    const sequence = ++this.searchSequence
    this.resultPaths.clear()
    const normalized = query.trim()
    if (!normalized) return []
    if (normalized.length > 300 || /[\0\r\n]/.test(normalized)) throw new Error('文件搜索关键词太长或包含无效字符。')
    const status = await this.detect()
    if (!status.executablePath) throw new Error('没有找到 ES 命令行工具。请在设置中选择 es.exe。')
    if (!status.running) throw new Error('Everything 没有运行。请先启动 Everything，再搜索文件。')
    const maximum = Math.min(MAX_RESULTS, Math.max(1, Math.floor(limit)))
    const supportsJson = Boolean(status.version && compareVersion(status.version, '1.1.0.37') >= 0)
    const args = supportsJson
      ? ['-json', '-full-path-and-name', '-n', String(maximum), '-timeout', '1000', '--', normalized]
      : ['-csv', '-no-header', '-full-path-and-name', '-n', String(maximum), '-timeout', '1000', '--', normalized]
    let stdout: string
    try {
      ({ stdout } = await execFileAsync(status.executablePath, args, { windowsHide: true, timeout: COMMAND_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, encoding: 'utf8' }))
    } catch (error) {
      const cause = error as NodeJS.ErrnoException
      if (cause.co