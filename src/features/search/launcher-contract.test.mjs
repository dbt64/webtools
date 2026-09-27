import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildSearchIndex } from '../../shared/pinyin-index.ts'
import { searchEntries } from '../../shared/search.ts'
import {
  appendTranslationAction,
  searchLauncherEntries,
  toLauncherAction,
  toLauncherAppEntry,
  toLauncherFileAction,
  toLauncherWebsiteEntry,
} from './launcher-results.ts'

const fixture = JSON.parse(readFileSync(new URL('../../../tests/fixtures/launcher-parity.json', import.meta.url), 'utf8'))
const appEntries = fixture.applications.map(toLauncherAppEntry)
const websiteEntries = fixture.websites.map(toLauncherWebsiteEntry)
const allEntries = [...appEntries, ...websiteEntries]
const index = buildSearchIndex(allEntries)

test('search preserves exact, prefix, substring, and alias ranking tiers', () => {
  const cases = [
    ['Orbit Editor', 'b222222222222222', 0, 'name'],
    ['orbi', '00000000-0000-4000-8000-000000000001', 1, 'name'],
    ['bitedi', 'b222222222222222', 2, 'name'],
    ['ob', 'a111111111111111', 3, 'alias'],
    ['nova', 'd444444444444444', 4, 'alias'],
    ['oe', 'b222222222222222', 5, 'initials'],
    ['xinghe', 'c333333333333333', 6, 'pinyin'],
    ['bianji', 'c333333333333333', 7, 'pinyin'],
    ['xh', 'c333333333333333', 8, 'initials'],
    ['bj', 'c333333333333333', 9, 'initials'],
    ['knowledge', '00000000-0000-4000-8000-000000000001', 10, 'name'],
  ]

  for (const [query, id, rank, match] of cases) {
    const result = searchEntries(query, allEntries, index)[0]
    assert.ok(result, `expected a result for ${query}`)
    assert.equal(result.entry.id, id, query)
    assert.equal(result.rank, rank, query)
    assert.equal(result.match, match, query)
  }
})

test('orders matching results by relevance across different ranking tiers', () => {
  const exactName = { id: 'fixed-exact', name: 'Orbit', aliases: [], kind: 'app', subtitle: '本地应用' }
  const exactAlias = { id: 'fixed-alias', name: 'Aardvark Utility', aliases: ['Orbit'], kind: 'app', subtitle: '本地应用' }
  const entries = [exactAlias, exactName]
  const results = searchEntries('orbit', entries, buildSearchIndex(entries))

  assert.deepEqual(results.map(({ entry }) => entry.id), ['fixed-exact', 'fixed-alias'])
})

test('normalizes case and accents without changing the stable result identity', () => {
  const uppercase = searchEntries('ORCHID BROWSER', appEntries, index)[0]
  const unaccented = searchEntries('cafe scheduler', appEntries, index)[0]

  assert.equal(uppercase.entry.id, 'a111111111111111')
  assert.equal(uppercase.rank, 0)
  assert.equal(unaccented.entry.id, '0777777777777777')
})

test('returns no result for an unmatched query', () => {
  assert.deepEqual(searchEntries('qzxwv', allEntries, index), [])
})

test('keeps equal-name results in input order after ranking', () => {
  const first = { id: 'fixed-first', name: 'Duplicate Utility', kind: 'app', subtitle: '本地应用' }
  const second = { id: 'fixed-second', name: 'Duplicate Utility', kind: 'app', subtitle: '本地应用' }
  const entries = [second, first]
  const results = searchEntries('duplicate utility', entries, buildSearchIndex(entries))

  assert.deepEqual(results.map(({ entry }) => entry.id), ['fixed-second', 'fixed-first'])
})

test('matches website names, URL fragments, and indexed descriptions with saved IDs', () => {
  const nameMatch = searchEntries('orbit', websiteEntries, index)[0]
  const urlMatch = searchEntries('handbook', websiteEntries, index)[0]
  const upperUrlMatch = searchEntries('HANDBOOK', websiteEntries, index)[0]
  const descriptionMatch = searchEntries('knowledge', websiteEntries, index)[0]

  assert.equal(nameMatch.entry.id, '00000000-0000-4000-8000-000000000001')
  assert.equal(nameMatch.match, 'name')
  assert.equal(urlMatch.entry.id, '00000000-0000-4000-8000-000000000001')
  assert.equal(urlMatch.match, 'alias')
  assert.equal(upperUrlMatch.entry.id, '00000000-0000-4000-8000-000000000001')
  assert.equal(descriptionMatch.entry.id, '00000000-0000-4000-8000-000000000001')
})

test('normal local search mixes apps and websites while slash mode returns websites only', () => {
  const normal = searchLauncherEntries('orbit', 'local', appEntries, websiteEntries, index, null)
  const savedWebsites = searchLauncherEntries('orbit', 'saved-websites', appEntries, websiteEntries, index, 'b222222222222222')

  assert.deepEqual(new Set(normal.map(({ entry }) => entry.kind)), new Set(['app', 'website']))
  assert.deepEqual(normal.map(({ entry }) => entry.id), ['00000000-0000-4000-8000-000000000001', 'b222222222222222'])
  assert.deepEqual(savedWebsites.map(({ entry }) => entry.id), ['00000000-0000-4000-8000-000000000001'])
})

test('web and Everything command modes do not return local search rows', () => {
  assert.deepEqual(searchLauncherEntries('orbit', 'web', appEntries, websiteEntries, index, null), [])
  assert.deepEqual(searchLauncherEntries('orbit', 'files', appEntries, websiteEntries, index, null), [])
})

test('remembered app promotion applies to local search without changing saved-website mode', () => {
  const local = searchLauncherEntries('orbit', 'local', appEntries, websiteEntries, index, 'b222222222222222')
  const savedWebsites = searchLauncherEntries('orbit', 'saved-websites', appEntries, websiteEntries, index, 'b222222222222222')

  assert.equal(local[0].entry.id, 'b222222222222222')
  assert.equal(savedWebsites[0].entry.id, '00000000-0000-4000-8000-000000000001')
})

test('ordinary local results share an eight-row limit and preserve a ninth translation slot', () => {
  const limitedApps = fixture.limitApplications.map(toLauncherAppEntry)
  const limitedWebsites = fixture.limitWebsites.map(toLauncherWebsiteEntry)
  const limitedIndex = buildSearchIndex([...limitedApps, ...limitedWebsites])
  const ordinary = searchLauncherEntries('parity', 'local', limitedApps, limitedWebsites, limitedIndex, null)
  const withTranslation = appendTranslationAction(ordinary.map(toLauncherAction), 'parity', 'local')

  assert.equal(ordinary.length, 8)
  assert.equal(ordinary.some(({ entry }) => entry.kind === 'website' && entry.id === '00000000-0000-4000-8000-000000000004'), true)
  assert.equal(ordinary.some(({ entry }) => entry.id === '1000000000000008'), false)
  assert.equal(ordinary.some(({ entry }) => entry.id === '1000000000000009'), false)
  assert.equal(withTranslation.length, 9)
  assert.equal(withTranslation[8].kind, 'translation')
  assert.equal(withTranslation[8].text, 'parity')
})

test('promotes a remembered result beyond the initial limit before truncating', () => {
  const limitedApps = fixture.limitApplications.map(toLauncherAppEntry)
  const limitedWebsites = fixture.limitWebsites.map(toLauncherWebsiteEntry)
  const limitedIndex = buildSearchIndex([...limitedApps, ...limitedWebsites])
  const ordinary = searchLauncherEntries('parity', 'local', limitedApps, limitedWebsites, limitedIndex, '1000000000000009')
  const withTranslation = appendTranslationAction(ordinary.map(toLauncherAction), 'parity', 'local')

  assert.equal(ordinary.length, 8)
  assert.equal(ordinary[0].entry.id, '1000000000000009')
  assert.equal(ordinary.some(({ entry }) => entry.id === '1000000000000008'), false)
  assert.equal(withTranslation.length, 9)
  assert.equal(withTranslation[8].kind, 'translation')
})

test('maps app, website, and file results to typed actions while preserving IDs', () => {
  const appAction = toLauncherAction(searchEntries('orbit editor', appEntries, index)[0])
  const websiteAction = toLauncherAction(searchEntries('orbit docs', websiteEntries, index)[0])
  const fileAction = toLauncherFileAction({ id: 'everything-token-01', name: 'Guide.pdf', locationLabel: '文档', kind: 'file' })

  assert.equal(appAction.kind, 'application')
  assert.equal(appAction.id, 'b222222222222222')
  assert.equal(websiteAction.kind, 'website')
  assert.equal(websiteAction.id, '00000000-0000-4000-8000-000000000001')
  assert.equal(websiteAction.url, 'https://docs.orbit.example/handbook/index')
  assert.deepEqual(fileAction, { kind: 'file', id: 'everything-token-01', name: 'Guide.pdf', locationLabel: '文档', fileKind: 'file' })
})
