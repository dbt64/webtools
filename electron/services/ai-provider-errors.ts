export function getAIProviderHttpError(status: number): Error {
  if (status === 401 || status === 403) return new Error('API Key 无效或没有调用权限。')
  if (status === 404) return new Error('找不到接口或模型，请检查服务和模型名称。')
  if (status === 429) return new Error('服务请求过于频繁，请稍后再试。')
  if (status >= 500) return new Error('AI 服务暂时不可用，请稍后再试。')
  return new Error(`AI 服务返回错误（HTTP ${status}）。`)
}

export function assertNoRedirect(response: Response): void {
  if (response.status >= 300 && response.status < 400) {
    throw new Error('AI 服务重定向已被阻止，请检查最终服务地址。')
  }
}

export function normalizeAITransportError(error: unknown): Error {
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) return error
  return new Error('无法连接 AI 服务，请检查网络和服务地址。')
}

export async function parseAIResponseJson(response: Response): Promise<unknown> {
  try { return await response.json() }
  catch { throw new Error('AI 服务返回的数据格式无效。') }
}
/** Observe only exact nonnegative output usage; missing/malformed metadata is never inferred from bytes. */
export function extractOutputTokens(payload: unknown, field: 'completion_tokens' | 'output_tokens'): number | null {
  if (!payload || typeof payload !== 'object' || !('usage' in payload)) return null
  const usage = payload.usage
  if (!usage || typeof usage !== 'object' || Array.isArray(usage) || !(field in usage)) return null
  const tokens = (usage as Record<string, unknown>)[field]
  return typeof tokens === 'number' && Number.isSafeInteger(tokens) && tokens >= 0 ? tokens : null
}
