import { DEFAULT_SEARCH_ENGINES, type SearchEngine } from './domain'

function validTemplate(raw: string): URL {
  if (typeof raw !== 'string' || (raw.match(/%s/g) ?? []).length !== 1) throw new Error('搜索网址必须且只能包含一个 %s 占位符。')
  const sample = raw.replace('%s', 'webtools-query')
  let url: URL
  try { url = new URL(sample) } catch { throw new Error('搜索网址格式无效。') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('搜索网址只支持安全的 HTTP 或 HTTPS 地址。')
  return url
}

export function normalizeSearchEngines(value: unknown): SearchEngine[] {
  if (!Array.isArray(value)) throw new Error('搜索引擎列表无效。')
  const defaultsById = new Map(DEFAULT_SEARCH_ENGINES.map((engine) => [engine.id, engine]))
  const seen = new Set<string>()
  const userEngines: SearchEngine[] = []
  const builtIns: SearchEngine[] = []
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('搜索引擎信息无效。')
    const item = raw as Record<string, unknown>
    if (typeof item.id !== 'string' || !/^[\da-z_-]{1,50}$/i.test(item.id) || seen.has(item.id)) throw new Error('搜索引擎编号无效或重复。')
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 60) throw new Error('搜索引擎名称需在 1 到 60 个字符之间。')
    if (typeof item.template !== 'string' || item.template.length > 1000) throw new Error('搜索引擎网址无效。')
    const url = validTemplate(item.template)
    seen.add(item.id)
    const builtin = defaultsById.get(item.id)
    const engine: SearchEngine = {
      id: item.id,
      name: builtin?.name ?? item.name.trim(),
      template: builtin?.template ?? item.template.trim(),
      builtIn: Boolean(builtin),
      enabled: item.enabled !== false,
      order: Number.isFinite(item.order) ? Number(item.order) : index,
    }
    if (url.protocol !== 'https:' && builtin) throw new Error('内置搜索引擎配置无效。')
    ;(builtin ? builtIns : userEngines).push(engine)
  }
  for (const builtin of DEFAULT_SEARCH_ENGINES) {
    if (!seen.has(builtin.id)) builtIns.push({ ...builtin })
  }
  if (![...builtIns, ...userEngines].some((engine) => engine.enabled)) throw new Error('至少保留一个可用的搜索引擎。')
  return [...builtIns, ...userEngines].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map((engine, order) => ({ ...engine, order }))
}
