import assert from 'node:assert/strict'
import test from 'node:test'

const orderModule = await import('./website-order.ts').catch(() => ({}))
const normalizeWebsiteOrderByCollection = orderModule.normalizeWebsiteOrderByCollection

const folders = [
  { id: 'daily', name: '常用', createdAt: 1 },
  { id: 'news', name: '资讯', createdAt: 2 },
]

const websites = [
  { id: 'a', name: 'A', url: 'https://a.example', folderIds: ['daily'], createdAt: 1 },
  { id: 'b', name: 'B', url: 'https://b.example', folderIds: [], createdAt: 2 },
  { id: 'c', name: 'C', url: 'https://c.example', folderIds: ['daily', 'news'], createdAt: 3 },
  { id: 'd', name: 'D', url: 'https://d.example', folderIds: ['removed-folder'], createdAt: 4 },
]

test('normalizes missing or malformed collection order from current website data', () => {
  assert.equal(typeof normalizeWebsiteOrderByCollection, 'function', 'collection-order normalizer exists')
  assert.deepEqual(normalizeWebsiteOrderByCollection(undefined, websites, folders), {
    unclassified: ['b', 'd'],
    folders: { daily: ['a', 'c'], news: ['c'] },
  })
  assert.deepEqual(normalizeWebsiteOrderByCollection({ unclassified: 42, folders: null }, websites, folders), {
    unclassified: ['b', 'd'],
    folders: { daily: ['a', 'c'], news: ['c'] },
  })
})

test('drops duplicate and stale IDs and appends missing collection members deterministically', () => {
  assert.equal(typeof normalizeWebsiteOrderByCollection, 'function', 'collection-order normalizer exists')
  assert.deepEqual(normalizeWebsiteOrderByCollection({
    unclassified: ['d', 'd', 'not-saved'],
    folders: {
      daily: ['c', 'c', 'not-saved'],
      news: [],
      deleted: ['a'],
    },
  }, websites, folders), {
    unclassified: ['d', 'b'],
    folders: { daily: ['c', 'a'], news: ['c'] },
  })
})

test('keeps a shared website independently ordered in each folder', () => {
  assert.equal(typeof normalizeWebsiteOrderByCollection, 'function', 'collection-order normalizer exists')
  assert.deepEqual(normalizeWebsiteOrderByCollection({
    unclassified: ['b'],
    folders: { daily: ['c', 'a'], news: ['c'] },
  }, websites, folders), {
    unclassified: ['b', 'd'],
    folders: { daily: ['c', 'a'], news: ['c'] },
  })
})
