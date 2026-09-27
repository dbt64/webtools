export interface EverythingCliCapabilities {
  supportsJson: boolean
  supportsUtf8Output: boolean
}

export function buildEverythingSearchArgs(query: string, maximum: number, capabilities: EverythingCliCapabilities): string[] {
  return [
    ...(capabilities.supportsJson ? ['-argv'] : []),
    ...(capabilities.supportsUtf8Output ? ['-cp', '65001'] : []),
    ...(capabilities.supportsJson ? ['-json'] : ['-csv', '-no-header']),
    '-full-path-and-name', '-n', String(maximum), '-timeout', '1000', '--', query,
  ]
}

export async function openEverythingPath(path: string, openPath: (path: string) => Promise<string>): Promise<void> {
  const message = await openPath(path)
  if (message) throw new Error(message)
}
