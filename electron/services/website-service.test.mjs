import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DataStore } from './data-store.ts'

const websiteModule = await import('./website-service.ts').catch((error) => ({ loadError: error }))
const bookmarkModule = await import('./bookmark-service.ts').catch((error) => ({ loadError: error }))
const WebsiteService = websiteModule.WebsiteService
const BookmarkService = bookmarkModule.BookmarkService

const folders = [
  { id: 'daily', name: '常用', createdAt: 1 },
  { id: 'news', name: '资讯', createdAt: 2 },
]

const websites = [
  { id: 'site-a', name: 'A', url: 'https://a.example', folderIds: ['daily'], createdAt: 1 },
  { id: 'shared', name: 'Shared', url: 'https://shared.example', folderIds: ['daily', 'news'], createdAt: 2 },
  { id: 'unassigned', name: 'Loose', url: 'https://loose.example', folderIds: [], createdAt: 3 },
]

async function withStore(run) {
  const directory = await mkdtemp(join(tmpdir(), 'webtools-order-'))
  try {
    const store = new DataStore(join(directory, 'data.json'))
    await store.load()
    await store.update((data) => ({
      ...data,
      bookmarkFolders: structuredClone(folders),
      webEntries: structuredClone(websites),
      websiteOrderByCollection: {
        unclassified: ['unassigned'],
        folders: { daily: ['site-a', 'shared'], news: ['shared'] },
      },
    }))
    await run(store)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('website and bookmark services load for the Node test runner', () => {
  assert.equal(websiteModule.loadError, undefined, websiteModule.loadError?.message)
  assert.equal(bookmarkModule.loadError, undefined, bookmarkModule.loadError?.message)
  assert.equal(typeof WebsiteService, 'function')
  assert.equal(typeof BookmarkService, 'function')
})

test('reorders one folder without changing the order of a shared website in another', async () => {
  assert.equal(typeof WebsiteService, 'function', websiteModule.loadError?.message)
  await withStore(async (store) => {
    const service = new WebsiteService(store)
    assert.equal(typeof service.reorder, 'function', 'WebsiteService.reorder exists')
    const result = await service.reorder({ kind: 'folder', folderId: 'daily' }, ['shared', 'site-a'])
    assert.equal(result.ok, true)
    assert.deepEqual(store.snapshot().websiteOrderByCollection.folders, {
      daily: ['shared', 'site-a'],
      news: ['shared'],
    })
  })
})

test('rejects a reorder unless IDs exactly match the current collection', async () => {
  assert.equal(typeof WebsiteService, 'function', websiteModule.loadError?.message)
  await withStore(async (store) => {
    const service = new WebsiteService(store)
    assert.equal(typeof service.reorder, 'function', 'WebsiteService.reorder exists')
    const before = store.snapshot()
    for (const ids of [['site-a'], ['site-a', 'site-a'], ['site-a', 'shared', 'unassigned']]) {
      const result = await service.reorder({ kind: 'folder', folderId: 'daily' }, ids)
      assert.equal(result.ok, false)
      assert.deepEqual(store.snapshot().websiteOrderByCollection, before.websiteOrderByCollection)
      assert.deepEqual(store.snapshot().webEntries, before.webEntries)
    }
    const missingFolder = await service.reorder({ kind: 'folder', folderId: 'missing' }, [])
    assert.equal(missingFolder.ok, false)
    assert.deepEqual(store.snapshot().websiteOrderByCollection, before.websiteOrderByCollection)
  })
})

test('website create, membership changes, and delete update collection order atomically', async () => {
  assert.equal(typeof WebsiteService, 'function', websiteModule.loadError?.message)
  await withStore(async (store) => {
    const service = new WebsiteService(store)
    const created = await service.save({ name: 'New site', url: 'https://new.example', folderIds: [] })
    assert.equal(created.ok, true)
    if (!created.ok) return
    assert.deepEqual(store.snapshot().websiteOrderByCollection.unclassified, ['unassigned', created.data.id])

    const moved = await service.addWebsiteToFolders('unassigned', ['news'])
    assert.equal(moved.ok, true)
    assert.deepEqual(store.snapshot().websiteOrderByCollection.unclassified, [created.data.id])
    assert.deepEqual(store.snapshot().websiteOrderByCollection.folders.news, ['shared', 'unassigned'])

    const edited = await service.save({ id: 'site-a', name: 'A', url: 'https://a.example', folderIds: ['news'] })
    assert.equal(edited.ok, true)
    assert.deepEqual(store.snapshot().websiteOrderByCollection.folders.daily, ['shared'])
    assert.deepEqual(store.snapshot().websiteOrderByCollection.folders.news, ['shared', 'unassigned', 'site-a'])

    const deleted = await service.delete('shared')
    assert.equal(deleted.ok, true)
    assert.deepEqual(store.snapshot().websiteOrderByCollection.folders.daily, [])
    assert.deepEqual(store.snapshot().websiteOrderByCollection.folders.news, ['unassigned', 'site-a'])
  })
})

test('folder creation starts empty and folder deletion preserves websites as unclassified', async () => {
  assert.equal(typeof BookmarkService, 'function', bookmarkModule.loadError?.message)
  await withStore(async (store) => {
    const service = new BookmarkService(store)
    const created = await service.saveFolder({ name: 'Empty' })
    assert.deepEqual(store.snapshot().websiteOrderByCollection.folders[created.id], [])

    await service.deleteFolder('daily')
    const snapshot = store.snapshot()
    assert.equal(snapshot.webEntries.some((website) => website.id === 'site-a'), true)
    assert.deepEqual(snapshot.webEntries.find((website) => website.id === 'site-a')?.folderIds, [])
    assert.deepEqual(snapshot.websiteOrderByCollection.unclassified, ['unassigned', 'site-a'])
    assert.equal(Object.hasOwn(snapshot.websiteOrderByCollection.folders, 'daily'), false)
    assert.deepEqual(snapshot.websiteOrderByCollection.folders.news, ['shared'])
  })
})

test('folder names, website membership, and independent ordering survive a DataStore reload', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'webtools-reload-'))
  const filePath = join(directory, 'data.json')
  try {
    const store = new DataStore(filePath)
    await store.load()
    const foldersService = new BookmarkService(store)
    const websitesService = new WebsiteService(store)
    const folder = await foldersService.saveFolder({ name: '重启后保留' })
    const first = await websitesService.save({ name: 'First', url: 'https://first.example', folderIds: [folder.id] })
    const second = await websitesService.save({ name: 'Second', url: 'https://second.example', folderIds: [folder.id] })
    assert.equal(first.ok && second.ok, true)
    if (!first.ok || !second.ok) return
    await foldersService.saveFolder({ id: folder.id, name: '重命名并保留' })
    const reordered = await websitesService.reorder({ kind: 'folder', folderId: folder.id }, [second.data.id, first.data.id])
    assert.equal(reordered.ok, true)

    const afterRestart = new DataStore(filePath)
    await afterRestart.load()
    const persisted = afterRestart.snapshot()
    assert.deepEqual(persisted.bookmarkFolders.map(({ id, name }) => ({ id, name })), [{ id: folder.id, name: '重命名并保留' }])
    assert.deepEqual(persisted.webEntries.map((website) => [website.id, website.folderIds]), [
      [first.data.id, [folder.id]],
      [second.data.id, [folder.id]],
    ])
    assert.deepEqual(persisted.websiteOrderByCollection.folders[folder.id], [second.data.id, first.data.id])

    await new BookmarkService(afterRestart).deleteFolder(folder.id)
    const afterDeleteRestart = new DataStore(filePath)
    await afterDeleteRestart.load()
    const unclassified = afterDeleteRestart.snapshot()
    assert.equal(unclassified.bookmarkFolders.length, 0)
    assert.deepEqual(unclassified.webEntries.map((website) => website.folderIds), [[], []])
    assert.deepEqual(unclassified.webEntries.map((website) => website.id), [first.data.id, second.data.id])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
