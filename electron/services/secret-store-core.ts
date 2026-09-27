import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface SecretCipher {
  isAvailable(): Promise<boolean>
  encrypt(value: string): Promise<string>
  decrypt(value: string): Promise<string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class SecretStoreCore {
  private readonly filePath: string
  private readonly cipher: SecretCipher
  private pendingWrite: Promise<void> = Promise.resolve()

  constructor(filePath: string, cipher: SecretCipher) {
    this.filePath = filePath
    this.cipher = cipher
  }

  async getSecret(key: string): Promise<string | null> {
    this.assertValidKey(key)
    await this.pendingWrite
    if (!await this.cipher.isAvailable()) throw new Error('Windows 安全存储当前不可用。')
    const stored = await this.readStored()
    const encrypted = stored[key]
    if (!encrypted) return null
    try { return await this.cipher.decrypt(encrypted) }
    catch { throw new Error('无法解密已保存的设置。') }
  }

  async setSecret(key: string, value: string): Promise<void> {
    this.assertValidKey(key)
    if (typeof value !== 'string' || value.length > 4096) throw new Error('Secret value is invalid.')
    await this.enqueue(async () => {
      if (!await this.cipher.isAvailable()) throw new Error('Windows 安全存储当前不可用。')
      const stored = await this.readStored()
      stored[key] = await this.cipher.encrypt(value)
      await this.writeStored(stored)
    })
  }

  async hasSecret(key: string): Promise<boolean> {
    return (await this.getSecret(key)) !== null
  }

  async deleteSecret(key: string): Promise<void> {
    this.assertValidKey(key)
    await this.enqueue(async () => {
      const stored = await this.readStored()
      if (!(key in stored)) return
      delete stored[key]
      await this.writeStored(stored)
    })
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.pendingWrite.then(operation)
    this.pendingWrite = result.then(() => undefined, () => undefined)
    return result
  }

  private async readStored(): Promise<Record<string, string>> {
    let parsed: unknown
    try { parsed = JSON.parse(await readFile(this.filePath, 'utf8')) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw new Error('无法读取加密设置。')
    }
    if (!isRecord(parsed)) throw new Error('无法读取加密设置。')
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      this.assertValidKey(key)
      if (typeof value !== 'string') throw new Error('无法读取加密设置。')
      result[key] = value
    }
    return result
  }

  private async writeStored(stored: Record<string, string>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp`
    await writeFile(tempPath, JSON.stringify(stored), 'utf8')
    await rename(tempPath, this.filePath)
  }

  private assertValidKey(key: string): void {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(key)) throw new Error('Invalid secret key.')
  }
}
