import { safeStorage } from 'electron'
import { SecretStoreCore } from './secret-store-core'

const electronCipher = {
  isAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
  encrypt: async (value: string) => (await safeStorage.encryptStringAsync(value)).toString('base64'),
  decrypt: async (value: string) => (await safeStorage.decryptStringAsync(Buffer.from(value, 'base64'))).result,
}

export class SecretStore extends SecretStoreCore {
  constructor(filePath: string) { super(filePath, electronCipher) }
}
