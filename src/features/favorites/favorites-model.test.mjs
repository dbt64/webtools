import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFavoriteSections } from './favorites-model.ts'

test('groups saved websites into their folders and keeps unassigned sites visible', () => {
  const folders = [
    { id: 'daily', name: '综合常用', createdAt: 1 },
    { id: 'news', name: '社区资讯', createdAt: 2 },
    { id: 'empty', name: '空收藏夹', createdAt: 3 },
  ]
  const websites = [
    { id: 'jd', name: '京东商城', url: 'https://jd.com', folderIds: ['daily'], createdAt: 1 },
    { id: 'zhihu', name: '知乎', url: 'https://zhihu.com', folderIds: ['news'], createdAt: 2 },
    { id: 'shared', name: '新浪微博', url: 'https://weibo.com', folderIds: ['daily', 'news'], createdAt: 3 },
    { id: 'orphaned', name: '未分类网址', url: 'https://example.com', folderIds: ['deleted-folder'], createdAt: 4 },
  ]

  assert.deepEqual(buildFavoriteSections(folders, websites), [
    { id: 'daily', name: '综合常用', websites: [websites[0], websites[2]] },
    { id: 'news', name: '社区资讯', websites: [websites[1], websites[2]] },
    { id: 'empty', name: '空收藏夹', websites: [] },
    { id: 'uncategorized', name: '未分类', websites: [websites[3]] },
  ])
})

test('omits an unnecessary uncategorized section when no websites are unassigned', () => {
  assert.deepEqual(buildFavoriteSections(
    [{ id: 'daily', name: '综合常用', createdAt: 1 }],
    [{ id: 'jd', name: '京东商城', url: 'https://jd.com', folderIds: ['daily'], createdAt: 1 }],
  ), [
    { id: 'daily', name: '综合常用', websites: [{ id: 'jd', name: '京东商城', url: 'https://jd.com', folderIds: ['daily'], createdAt: 1 }] },
  ])
})

test('applies independent saved ordering to folders and unclassified websites', async () => {
  const shared = { id: 'shared', name: 'Shared', url: 'https://shared.example', folderIds: ['daily', 'news'], createdAt: 1 }
  const first = { id: 'first', name: 'First', url: 'https://first.example', folderIds: ['daily'], createdAt: 2 }
  const loose = { id: 'loose', name: 'Loose', url: 'https://loose.example', folderIds: [], createdAt: 3 }
  const folders = [
    { id: 'daily', name: '常用', createdAt: 1 },
    { id: 'news', name: '资讯', createdAt: 2 },
    { id: 'empty', name: '空收藏夹', createdAt: 3 },
  ]
  const { buildFavoriteSections } = await import('./favorites-model.ts')
  const sections = buildFavoriteSections(folders, [shared, first, loose], {
    unclassified: ['loose'],
    folders: { daily: ['first', 'shared'], news: ['shared'], empty: [] },
  })

  assert.deepEqual(sections.map((section) => [section.id, section.websites.map((website) => website.id)]), [
    ['daily', ['first', 'shared']],
    ['news', ['shared']],
    ['empty', []],
    ['uncategorized', ['loose']],
  ])
})

test('partial saved order falls back to website data order and appends missing members', async () => {
  const { buildFavoriteSections } = await import('./favorites-model.ts')
  const websites = [
    { id: 'first', name: 'First', url: 'https://first.example', folderIds: ['daily'], createdAt: 1 },
    { id: 'second', name: 'Second', url: 'https://second.example', folderIds: ['daily'], createdAt: 2 },
    { id: 'loose', name: 'Loose', url: 'https://loose.example', folderIds: [], createdAt: 3 },
  ]
  const sections = buildFavoriteSections([{ id: 'daily', name: '常用', createdAt: 1 }], websites, {
    unclassified: [],
    folders: { daily: ['second'] },
  })

  assert.deepEqual(sections.map((section) => [section.id, section.websites.map((website) => website.id)]), [
    ['daily', ['second', 'first']],
    ['uncategorized', ['loose']],
  ])
})
