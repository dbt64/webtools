import {
  parseTranslation2ImportedApiDefinition,
  type Translation2DefinitionScalar,
  type Translation2ImportedApiDefinition,
} from '../../src/shared/translation2-contracts.ts'
import type { TranslationLanguageCode, TranslationSourceLanguage } from '../../src/shared/translation-contracts.ts'
import { ServiceError } from './service-error.ts'

const MAX_REQUEST_BYTES = 64 * 1024
const MAX_RESPONSE_BYTES = 1024 * 1024

interface TranslationInput {
  definition: Translation2ImportedApiDefinition
  secret: string | null
  text: string
  sourceLanguage: TranslationSourceLanguage
  targetLanguage: TranslationLanguageCode
  signal: AbortSignal
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

function endpointAllowed(endpoint: string): boolean {
  const parsed = parseTranslation2ImportedApiDefinition({
    schemaVersion: 1, id: 'endpoint.check', name: 'Endpoint check', endpoint, method: 'POST', auth: { kind: 'none' },
    request: { contentType: 'json', sourceField: 'text', targetLanguageField: 'target' },
    response: { kind: 'text' }, timeoutMs: 1000,
  })
  return parsed !== null
}

export async function readBoundedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new ServiceError('TRANSLATION_RESPONSE_TOO_LARGE', 'Translation API response exceeds the allowed size.')
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_RESPONSE_BYTES) throw new ServiceError('TRANSLATION_RESPONSE_TOO_LARGE', 'Translation API response exceeds the allowed size.')
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const merged = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder('utf-8', { fatal: true }).decode(merged)
}

function extractResponse(definition: Translation2ImportedApiDefinition, raw: string): string {
  if (definition.response.kind === 'text') {
    if (!raw.trim()) throw new ServiceError('TRANSLATION_RESPONSE_INVALID', 'Translation API returned an empty response.')
    return raw
  }
  let current: unknown
  try { current = JSON.parse(raw) }
  catch { throw new ServiceError('TRANSLATION_RESPONSE_INVALID', 'Translation API response is not valid JSON.') }
  for (const segment of definition.response.textPath) {
    if (!current || typeof current !== 'object' || Array.isArray(current) || !Object.hasOwn(current, segment)) {
      throw new ServiceError('TRANSLATION_RESPONSE_INVALID', 'Translation API response path was not found.')
    }
    current = (current as Record<string, unknown>)[segment]
  }
  if (typeof current !== 'string' || !current.trim()) throw new ServiceError('TRANSLATION_RESPONSE_INVALID', 'Translation API response path did not contain text.')
  return current
}

export class Translation2ImportedApiExecutor {
  constructor(private readonly fetcher: FetchLike = fetch) {}

  async translate(input: TranslationInput): Promise<string> {
    const definition = parseTranslation2ImportedApiDefinition(input.definition)
    if (!definition || !endpointAllowed(definition.endpoint)) throw new ServiceError('TRANSLATION_ENDPOINT_INVALID', 'Translation API endpoint is invalid.')
    if (definition.auth.kind !== 'none' && !input.secret) throw new ServiceError('TRANSLATION_NOT_CONFIGURED', 'Translation API credential is missing.')

    const fields: Record<string, Translation2DefinitionScalar> = { ...(definition.request.staticFields ?? {}) }
    fields[definition.request.sourceField] = input.text
    if (definition.request.sourceLanguageField) fields[definition.request.sourceLanguageField] = input.sourceLanguage
    fields[definition.request.targetLanguageField] = input.targetLanguage
    const encoded = definition.request.contentType === 'json' ? JSON.stringify(fields) : new URLSearchParams(Object.entries(fields).map(([key, value]) => [key, String(value)])).toString()
    if (new TextEncoder().encode(encoded).byteLength > MAX_REQUEST_BYTES) throw new ServiceError('TRANSLATION_REQUEST_TOO_LARGE', 'Translation API request exceeds the allowed size.')

    const headers: Record<string, string> = {
      'Content-Type': definition.request.contentType === 'json' ? 'application/json' : 'application/x-www-form-urlencoded;charset=UTF-8',
      Accept: definition.response.kind === 'json' ? 'application/json' : 'text/plain, application/json;q=0.5',
    }
    if (definition.auth.kind === 'bearer') headers.Authorization = `Bearer ${input.secret}`
    else if (definition.auth.kind === 'header') headers[definition.auth.name] = input.secret!

    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(new DOMException('Translation API timed out.', 'TimeoutError')), definition.timeoutMs)
    let response: Response
    try {
      response = await this.fetcher(definition.endpoint, {
        method: 'POST', headers, body: encoded, redirect: 'manual', signal: AbortSignal.any([input.signal, timeout.signal]),
      })
    } finally { clearTimeout(timer) }
    if (response.status >= 300 && response.status < 400) throw new ServiceError('TRANSLATION_REDIRECT_BLOCKED', 'Translation API redirect was blocked.')
    if (!response.ok) throw new ServiceError('TRANSLATION_PROVIDER_ERROR', `Translation API returned HTTP ${response.status}.`)
    return extractResponse(definition, await readBoundedText(response))
  }
}
