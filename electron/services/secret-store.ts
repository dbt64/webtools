import { safeStorage } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export class SecretStore {
  constructor(private readonly filePath: string) {}

  async getSecret(key: string): Promise<string | null> {
    this.assertValidKey(key)
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Windows 安全存储当前不可用。')

    let stored: Record<string, string>
    try {
      stored = JSON.parse(await readFile(this.filePath, 'utf8')) as Record<string, string>
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new Error('无法读取加密设置。')
    }

    const encrypted = stored[key]
    if (!encrypted) return null
    try {
      return (await safeStorage.decryptStringAsync(Buffer.from(encrypted, 'base64'))).result
    } catch {
      throw new Error('无法解密已保存的设置。')
    }
  }

  async setSecret(key: string, value: string): Promise<void> {
    this.assertValidKey(key)
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Windows 安全存储当前不可用。')

    let stored: Record<string, string> = {}
    try {
      stored = JSON.parse(await readFile(this.filePath, 'utf8')) as Record<string, string>
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('无法读取加密设置。')
    }

    stored[key] = (await safeStorage.encryptStringAsync(value)).toString('base64')
    await mkdir(dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp`
    await writeFile(tempPath, JSON.stringify(stored), 'utf8')
    await rename(tempPath, this.filePath)
  }

  async hasSecret(key: string): Promise<boolean> {
    return (await this.getSecret(key)) !== null
  }

  async deleteSecret(key: string): Promise<void> {
    this.assertValidKey(key)
    let stored: Record<string, string>
    try {
      stored = JSON.parse(await readFile(this.filePath, 'utf8')) as Record<string, string>
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw new Error('无法读取加密设置。')
    }
    delete stored[key]
    const tempPath = `${this.filePath}.tmp`
    await writeFile(tempPath, JSON.stringify(stored), 'utf8')
    await rename(tempPath, this.filePath)
  }

  private assertValidKey(key: string): void {
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(key)) throw new Error('Invalid secret key.')
  }
}
