import { failValidation } from '../runtime/manifest-v1.mjs'

const credentialPatterns = [
  /\bsk_(?:live|test)_[A-Za-z0-9]{12,}\b/i,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/i,
  /\bAIza[0-9A-Za-z_-]{30,}\b/i,
  /\b(?:api[_-]?key|secret|token)\s*[:=]\s*["']?[^\s"']{12,}/i,
]

export function rejectCredentialLike(bytes, relative) {
  const candidate = Buffer.from(bytes).toString('latin1')
  if (credentialPatterns.some(pattern => pattern.test(candidate))) failValidation('SENSITIVE_CONTENT', relative)
}
