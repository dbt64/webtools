const MAX_PAGE_BYTES = 512 * 1024
const MAX_ICON_BYTES = 256 * 1024
const REQUEST_TIMEOUT_MS = 5000
const MAX_REDIRECTS = 4

interface BoundedResponse {
  bytes: Uint8Array
  contentType: string
  finalUrl: URL
}

function safeHttpUrl(value: string | URL): URL {
  const url = value instanceof URL ? new URL(value) : new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only HTTP and HTTPS icons are supported.')
  url.username = ''
  url.password = ''
  return url
}

async function readLimitedBody(response: Response, limit: number): Promise<Uint8Array> {
  const declaredSize = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredSize) && declaredSize > limit) throw new Error('Icon response is too large.')
  if (!response.body) return new Uint8Array()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel()
      throw new Error('Icon response is too large.')
    }
    chunks.push(value)
  }
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

async function fetchBounded(startUrl: URL, limit: number): Promise<BoundedResponse> {
  let currentUrl = safeHttpUrl(startUrl)
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetch(currentUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { 'user-agent': 'Nook/0.1 favicon fetcher', accept: 'text/html,image/*,*/*;q=0.2' },
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location || redirects === MAX_REDIRECTS) throw new Error('Too many or invalid redirects.')
      currentUrl = safeHttpUrl(new URL(location, currentUrl))
      continue
    }
    if (!response.ok) throw new Error(`Icon request failed with ${response.status}.`)
    const bytes = await readLimitedBody(response, limit)
    return { bytes, contentType: (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase(), finalUrl: currentUrl }
  }
  throw new Error('Too many redirects.')
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const expression = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
  for (const match of tag.replace(/^<link\b/i, '').matchAll(expression)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? ''
  }
  return attributes
}

function findDeclaredIcons(html: string, pageUrl: URL): URL[] {
  const links: URL[] = []
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0])
    const rel = (attributes.rel ?? '').toLowerCase().split(/\s+/)
    if (!rel.some((value) => value.includes('icon')) || !attributes.href) continue
    try { links.push(safeHttpUrl(new URL(attributes.href, pageUrl))) } catch { /* Ignore unsafe icon links. */ }
  }
  return links
}

function mimeForIcon(contentType: string, url: URL): string | null {
  const allowed = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon'])
  if (allowed.has(contentType)) return contentType
  if (contentType === 'application/octet-stream' && url.pathname.toLowerCase().endsWith('.ico')) return 'image/x-icon'
  return null
}

function toDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
}

function getFallbackInitial(siteUrl: URL): string {
  const hostname = siteUrl.hostname.replace(/^www\./i, '')
  return [...hostname].find((character) => /[\p{L}\p{N}]/u.test(character))?.toLocaleUpperCase() ?? '?'
}

export async function fetchFavicon(siteUrl: URL): Promise<{ dataUrl?: string; fallbackInitial: string }> {
  const pageUrl = safeHttpUrl(siteUrl)
  const fallbackInitial = getFallbackInitial(pageUrl)
  const candidates: URL[] = []

  try {
    const page = await fetchBounded(pageUrl, MAX_PAGE_BYTES)
    if (page.contentType.includes('html')) {
      candidates.push(...findDeclaredIcons(new TextDecoder().decode(page.bytes), page.finalUrl).slice(0, 3))
    }
  } catch {
    // The root favicon can still work when the document itself is unavailable.
  }

  const siteOrigin = new URL('/', pageUrl)
  candidates.push(new URL('/favicon.ico', siteOrigin))
  for (const candidate of candidates) {
    try {
      const image = await fetchBounded(candidate, MAX_ICON_BYTES)
      const mime = mimeForIcon(image.contentType, image.finalUrl)
      if (mime && image.bytes.byteLength > 0) return { dataUrl: toDataUrl(image.bytes, mime), fallbackInitial }
    } catch {
      // Continue to the next candidate; favicon failures never block saving a bookmark.
    }
  }
  return { fallbackInitial }
}
