import assert from 'node:assert/strict'
import test from 'node:test'
import { LauncherDataService } from './launcher-data.ts'

test('returns each launcher dataset only when its version changes', () => {
  let appListCalls = 0
  let websiteListCalls = 0
  const apps = [{ id: 'app-1', name: 'Editor', aliases: [], source: 'desktop' }]
  const websites = [{ id: 'site-1', name: 'Docs', url: 'https://docs.example', folderIds: [] }]
  const service = new LauncherDataService(
    { list: () => { appListCalls++; return apps } },
    { listForLauncher: () => { websiteListCalls++; return websites } },
  )

  const initial = service.getChanges({ apps: -1, websites: -1 })
  assert.deepEqual(initial, { versions: { apps: 0, websites: 0 }, apps, websites })
  assert.deepEqual(service.getChanges(initial.versions), { versions: initial.versions })
  assert.equal(appListCalls, 1)
  assert.equal(websiteListCalls, 1)

  service.markWebsitesChanged()
  const websiteUpdate = service.getChanges(initial.versions)
  assert.deepEqual(websiteUpdate, { versions: { apps: 0, websites: 1 }, websites })
  assert.equal(appListCalls, 1)
  assert.equal(websiteListCalls, 2)

  service.markAppsChanged()
  const appUpdate = service.getChanges(websiteUpdate.versions)
  assert.deepEqual(appUpdate, { versions: { apps: 1, websites: 1 }, apps })
  assert.equal(appListCalls, 2)
  assert.equal(websiteListCalls, 2)
})

test('requests full launcher data when the renderer reports stale versions', () => {
  const service = new LauncherDataService(
    { list: () => [{ id: 'app-1', name: 'Editor', aliases: [], source: 'desktop' }] },
    { listForLauncher: () => [{ id: 'site-1', name: 'Docs', url: 'https://docs.example', folderIds: [] }] },
  )
  service.markAppsChanged()
  service.markWebsitesChanged()

  assert.deepEqual(service.getChanges({ apps: 0, websites: 0 }), {
    versions: { apps: 1, websites: 1 },
    apps: [{ id: 'app-1', name: 'Editor', aliases: [], source: 'desktop' }],
    websites: [{ id: 'site-1', name: 'Docs', url: 'https://docs.example', folderIds: [] }],
  })
})

test('returns website icons only for requested IDs', () => {
  const requestedIds = []
  const service = new LauncherDataService(
    { list: () => [] },
    {
      listForLauncher: () => [],
      getIcons: (ids) => {
        requestedIds.push(...ids)
        return Object.fromEntries(ids.map((id) => [id, id === 'site-1' ? 'data:image/png;base64,icon' : null]))
      },
    },
  )

  assert.deepEqual(service.getWebsiteIcons(['site-1', 'site-2']), {
    'site-1': 'data:image/png;base64,icon',
    'site-2': null,
  })
  assert.deepEqual(requestedIds, ['site-1', 'site-2'])
})
