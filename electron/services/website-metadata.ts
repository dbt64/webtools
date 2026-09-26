import { fetchWebsiteMetadata as fetchMetadata } from './favicon-fetcher'
import { validateExternalUrl } from './external-opener'

export class WebsiteMetadataService {
  async fetch(rawUrl: string): Promise<{ title?: string; favicon?: string }> {
    const url = validateExternalUrl(rawUrl.trim())
    return fetchMetadata(url)
  }
}
