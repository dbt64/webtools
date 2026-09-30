import electron from 'electron'

export function validateExternalUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('网址格式不正确。')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('只支持打开 HTTP 或 HTTPS 网址。')
  return url
}

export async function openExternalUrl(value: string): Promise<void> {
  await electron.shell.openExternal(validateExternalUrl(value).toString())
}
