import { readFileSync } from 'node:fs'
import { buildSearchIndex } from '../../src/shared/pinyin-index.ts'
import { parseSearchCommand } from '../../src/shared/search-command.ts'
import { appendTranslationAction, searchLauncherEntries, toLauncherAction, toLauncherAppEntry, toLauncherWebsiteEntry } from '../../src/features/search/launcher-results.ts'

const input = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const apps = input.Apps.map(({ Id, Name, Aliases }) => toLauncherAppEntry({ id: Id, name: Name, aliases: Aliases, source: 'desktop' }))
const websites = input.Websites.map(({ Id, Name, Url, SearchText }) => toLauncherWebsiteEntry({ id: Id, name: Name, url: Url, description: SearchText, folderIds: [] }))
const index = buildSearchIndex([...apps, ...websites])
const differences = []
for (const item of input.Cases) {
  const command = parseSearchCommand(item.Raw)
  const expected = appendTranslationAction(
    searchLauncherEntries(command.query, command.mode, apps, websites, index, null).map(toLauncherAction),
    item.Raw, command.mode,
  ).map((result) => result.kind === 'translation' ? 'translation' : result.id)
  const actual = item.Results.map((result) => result.Id)
  if (JSON.stringify(expected) !== JSON.stringify(actual)) differences.push({ query: item.Raw, expected, actual })
}
console.log(JSON.stringify({ apps: apps.length, websites: websites.length, queries: input.Cases.length, differences }, null, 2))
