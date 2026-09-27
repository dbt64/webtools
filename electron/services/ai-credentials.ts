import type { AIProviderId } from '../../src/shared/ai-config'

export interface SecretStorePort {
  getSecret(key: string): Promise<string | null>
  setSecret(key: string, value: string): Promise<void>
  hasSecret(key: string): Promise<boolean>
  deleteSecret(key: string): Promise<void>
}

const providerSecretKey = (providerId: AIProviderId): string => `ai-${providerId}`

export class AIProviderCredentialStore {
  private readonly secrets: SecretStorePort

  constructor(secrets: SecretStorePort) { this.secrets = secrets }

  async get(providerId: AIProviderId): Promise<string | null> {
    const current = await this.secrets.getSecret(providerSecretKey(providerId))
    if (current !== null || providerId !== 'custom') return current
    return this.secrets.getSecret('ai-api-key')
  }

  async has(providerId: AIProviderId): Promise<boolean> {
    return (await this.get(providerId)) !== null
  }

  set(providerId: AIProviderId, value: string): Promise<void> {
    return this.secrets.setSecret(providerSecretKey(providerId), value)
  }

  async clear(providerId: AIProviderId): Promise<void> {
    await this.secrets.deleteSecret(providerSecretKey(providerId))
    if (providerId === 'custom') await this.secrets.deleteSecret('ai-api-key')
  }
}
