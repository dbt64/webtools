import assert from 'node:assert/strict'
import test from 'node:test'
import { LauncherSearchIndexCache } from './launcher-search-index-cache.ts'
import { buildSearchIndex } from '../../shared/pinyin-index.ts'
import { searchEntries } from '../../shared/search.ts'

test('reuses unchanged app and website indexes across dataset changes', () => {
  let builds = 0
  const cache = new LauncherSearchIndexCache((entries) => {
    builds++
    return buildSearchIndex(entries)
  })
  const apps = [{ id: 'app-1', name: 'Visual Studio Code', kind: 'app', subtitle: '本地应用' }]
  const websites = [{ id: 'site-1', name: '百度', aliases: ['https://baidu.com'], kind: 'website', subtitle: 'https://baidu.com' }]

  const initial = cache.get(apps, websites)
  assert.equal(builds, 2)
  assert.equal(cache.get(apps, websites), initial)
  assert.equal(builds, 2)

  const changedWebsites = [{ id: 'site-2', name: '文档', aliases: ['https://docs.example'], kind: 'website', subtitle: 'https://docs.example' }]
  const afterWebsiteChange = cache.get(apps, changedWebsites)
  assert.notEqual(afterWebsiteChange, initial)
  assert.equal(builds, 3)
  assert.equal(searchEntries('vs code', apps, afterWebsiteChange)[0]?.entry.id, 'app-1')
  assert.equal(searchEntries('wd', changedWebsites, afterWebsiteChange)[0]?.entry.id, 'site-2')

  const folderMembershipOnly = [{ ...changedWebsites[0], folderIds: ['favorites'] }]
  assert.equal(cache.get(apps, folderMembershipOnly), afterWebsiteChange)
  assert.equal(builds, 3)

  const changedApps = [{ id: 'app-2', name: 'Microsoft Word', kind: 'app', subtitle: '本地应用' }]
  const afterAppChange = cache.get(changedApps, folderMembershipOnly)
  assert.equal(builds, 4)
  assert.equal(searchEntries('word', changedApps, afterAppChange)[0]?.entry.id, 'app-2')
})
