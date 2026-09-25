import type { SearchProvider } from './domain'

const providers: Record<SearchProvider, { origin: string; path: string; parameter: string }> = {
  google: { origin: 'https://www.google.com', path: '/search', parameter: 'q' },
  baidu: { origin: 'https://www.baidu.com', path: '/s', parameter: 'wd' },
  bilibili: { origin: 'https://search.bilibili.com', path: '/all', parameter: 'keyword' },
}

export function buildSearchUrl(provider: SearchProvider, query: string): string {
  if (!query.trim()) throw new Error('搜索内容不能为空。')
  const config = providers[provider]
  if (!config) throw new Error('不支持的搜索平台。')
  const url = new URL(config.path, config.origin)
  url.searchParams.set(config.parameter, query.trim())
  return url.toString()
}
