export type ParsedSearchCommand =
  | { mode: 'local'; query: string }
  | { mode: 'web'; query: string }

export function parseSearchCommand(raw: string): ParsedSearchCommand {
  if (raw.startsWith('?')) return { mode: 'web', query: raw.slice(1).trim() }
  return { mode: 'local', query: raw.trim() }
}
