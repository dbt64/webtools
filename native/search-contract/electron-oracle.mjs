import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildSearchIndex } from '../../src/shared/pinyin-index.ts'
import { parseSearchCommand } from '../../src/shared/search-command.ts'
import { appendTranslationAction, searchLauncherEntries, toLauncherAction, toLauncherAppEntry, toLauncherWebsiteEntry } from '../../src/features/search/launcher-results.ts'

const fixture = JSON.parse(readFileSync(new URL('../../tests/fixtures/launcher-parity.json', import.meta.url), 'utf8'))
const apps = [...fixture.applications, ...fixture.limitApplications,
  { id: 'f000000000000001', name: 'Visual Studio Code', aliases: ['VS Code'], source: 'desktop' },
  { id: 'f000000000000002', name: '文件资源管理器', aliases: ['File Explorer', 'Explorer', 'explorer.exe'], source: 'system' },
].map(toLauncherAppEntry)
const websites = [...fixture.websites, ...fixture.limitWebsites].map(toLauncherWebsiteEntry)
const index = buildSearchIndex([...apps, ...websites])
const queries = ['', ' ', 'visual', 'chrome', 'note', 'code', 'vsc', '文件', '设置', 'wenjian', 'wjzy', 'xinghe', 'xh', 'oe', 'parity', 'orbit', 'handbook', '?openai', '/orbit', '/handbook', 'file:notes']
const cases = queries.map((raw) => {
  const command = parseSearchCommand(raw)
  const matched = searchLauncherEntries(command.query, command.mode, apps, websites, index, null)
  const actions = appendTranslationAction(matched.map(toLauncherAction), raw, command.mode)
  return {
    raw, mode: command.mode, query: command.query,
    results: actions.map((action) => ({
      kind: action.kind,
      id: action.kind === 'translation' ? 'translation' : action.id,
      title: action.name,
      action: action.kind === 'application' ? 'launch-app' : action.kind === 'website' ? 'open-website' : action.kind === 'translation' ? 'open-translation' : action.kind,
    })),
  }
})
const output = { generatedFrom: 'current Electron pure search functions', applications: apps, websites, cases }
writeFileSync(fileURLToPath(new URL('./launcher-search-parity.json', import.meta.url)), JSON.stringify(output, null, 2) + '\n')
