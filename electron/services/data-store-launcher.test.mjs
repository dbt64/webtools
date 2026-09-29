import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DataStore } from './data-store.ts'

test('launcher website summaries omit stored favicon payloads and icon lookup is ID-scoped', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'webtools-launcher-data-'))
  try {
    const store = new DataStore(join(directory, 'data.json'))
    await store.load()
    const favicon = `data:image/png;base64,${'a'.repeat(256_000)}`
    await store.update((data) => ({
      ...data,
      webEntries: [
        { id: 'site-1', name: 'Docs', url: 'https://docs.example', description: 'reference', favicon, folderIds: ['folder-1'], createdAt: 123 },
        { id: 'site-2', name: 'No icon', url: 'https://no-icon.example', folderIds: [], createdAt: 456 },
      ],
    }))

    const summaries = store.listLauncherWebsites()
    assert.deepEqual(summaries[0], { id: 'site-1', name: 'Docs', url: 'https://docs.example', description: 'reference', folderIds: ['folder-1'] })
    assert.equal('favicon' in summaries[0], false)
    assert.equal('createdAt' in summaries[0], false)
    summaries[0].folderIds.push('local-mutation')
    assert.deepEqual(store.listLauncherWebsites()[0].folderIds, ['folder-1'])

    assert.deepEqual(store.getWebsiteFavicons(['site-1', 'missing']), { 'site-1': favicon })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
