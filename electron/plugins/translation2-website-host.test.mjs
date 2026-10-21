import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Translation2WebsiteHost, buildGoogleTranslationUrl, isAllowedGoogleTranslationUrl, isAllowedTranslationWebsiteUrl } from './translation2-website-host.ts'
import { TRANSLATION2_WEBSITE_PROVIDER_IDS } from '../../src/shared/translation2-contracts.ts'

class FakeView {
  constructor() {
    this.bounds = []
    this.destroyed = false
    this.webContents = Object.assign(new EventEmitter(), {
      url: '', destroyed: false,
      loadURL: async url => { this.webContents.url = url },
      getURL: () => this.webContents.url,
      executeJavaScript: async () => this.webContents.sourceValue,
      isDestroyed: () => this.webContents.destroyed,
      close: () => { this.webContents.destroyed = true },
    })
  }
  setBounds(value) { this.bounds.push(value) }
}

test('Google URL handoff is HTTPS-origin bound and carries only the explicit source/languages', () => {
  const url = buildGoogleTranslationUrl('Hello world', 'auto', 'zh-CN')
  assert.equal(url, 'https://translate.google.com/?sl=auto&tl=zh-CN&text=Hello+world&op=translate')
  assert.equal(isAllowedGoogleTranslationUrl(url), true)
  assert.equal(isAllowedGoogleTranslationUrl('https://accounts.google.com/login'), false)
  assert.equal(isAllowedGoogleTranslationUrl('http://translate.google.com/'), false)
})

test('website view is lazy, reuses the provider session, syncs URL text, and is destroyed on close', async () => {
  const views = []
  const children = []
  const removed = []
  const cleared = []
  const host = new Translation2WebsiteHost({
    getWindow: () => ({ contentView: { addChildView: view => children.push(view), removeChildView: view => removed.push(view) } }),
    createView: () => { const view = new FakeView(); views.push(view); return view },
    clearSession: async id => { cleared.push(id) },
  })
  assert.equal(views.length, 0)
  host.setBounds({ x: 10, y: 60, width: 800, height: 600 })

  let result = await host.select('google', 'Hello', 'auto', 'zh-CN', 1)
  assert.equal(views.length, 1)
  assert.equal(children.length, 1)
  assert.equal(new URL(views[0].webContents.url).searchParams.get('text'), 'Hello')
  assert.equal(views[0].bounds.at(-1).width, 800)

  views[0].webContents.url = buildGoogleTranslationUrl('edited on site', 'auto', 'zh-CN')
  views[0].webContents.sourceValue = 'edited on site'
  result = await host.select(null, result.sourceText, 'auto', 'zh-CN', 1)
  assert.equal(result.sourceText, 'edited on site')
  assert.equal(result.sourceSynchronized, true)
  assert.equal(views[0].bounds.at(-1).width, 1)

  await host.select('google', result.sourceText, 'auto', 'zh-CN', 1)
  assert.equal(views.length, 1)
  await host.closeAll()
  assert.equal(removed.length, 1)
  assert.equal(views[0].destroyed || views[0].webContents.destroyed, true)
  assert.deepEqual(cleared, ['google'])
})

test('returning from a provider without a readable source reports the fallback explicitly', async () => {
  const view = new FakeView()
  const host = new Translation2WebsiteHost({
    getWindow: () => ({ contentView: { addChildView: () => {}, removeChildView: () => {} } }),
    createView: () => view,
    clearSession: async () => {},
  })
  await host.select('google', 'fallback', 'auto', 'zh-CN', 1)
  view.webContents.url = 'https://translate.google.com/'
  view.webContents.sourceValue = null
  const result = await host.select(null, 'fallback', 'auto', 'zh-CN', 1)
  assert.deepEqual(result, { sourceText: 'fallback', sourceSynchronized: false })
})

test('invalid bounds and unsupported providers are rejected without creating a view', async () => {
  let created = 0
  const host = new Translation2WebsiteHost({
    getWindow: () => null,
    createView: () => { created += 1; return new FakeView() },
    clearSession: async () => {},
  })
  assert.throws(() => host.setBounds({ x: -1, y: 0, width: 10, height: 10 }), /bounds/i)
  await assert.rejects(() => host.select('unknown', 'text', 'auto', 'zh-CN', 1), /unsupported/i)
  assert.equal(created, 0)
})

test('a newer Host handoff replaces the active website source instead of reading stale page text', async () => {
  const view = new FakeView()
  const host = new Translation2WebsiteHost({
    getWindow: () => ({ contentView: { addChildView: () => {}, removeChildView: () => {} } }),
    createView: () => view,
    clearSession: async () => {},
  })
  await host.select('google', 'old selection', 'auto', 'zh-CN', 3)
  view.webContents.sourceValue = 'old page edit'
  const result = await host.select('google', 'new selection', 'auto', 'zh-CN', 4)
  assert.equal(result.sourceText, 'new selection')
  assert.equal(new URL(view.webContents.url).searchParams.get('text'), 'new selection')
})

test('slow website load does not hold tab selection and unchanged reactivation does not reload', async () => {
  const view = new FakeView()
  let loads = 0
  view.webContents.loadURL = url => { loads++; view.webContents.url = url; return new Promise(() => {}) }
  const host = new Translation2WebsiteHost({ getWindow: () => ({ contentView: { addChildView() {}, removeChildView() {} } }), createView: () => view, clearSession: async () => {} })
  const first = await Promise.race([host.select('google', 'Hello', 'auto', 'zh-CN', 1), new Promise(resolve => setTimeout(() => resolve('blocked'), 100))])
  assert.notEqual(first, 'blocked')
  view.webContents.sourceValue = 'Hello'
  await host.select(null, 'Hello', 'auto', 'zh-CN', 1)
  await host.select('google', 'Hello', 'auto', 'zh-CN', 1)
  assert.equal(loads, 1)
})

test('every listed website creates its own reusable view with a bounded HTTPS navigation policy', async () => {
  const created = new Map()
  const host = new Translation2WebsiteHost({ getWindow: () => ({ contentView: { addChildView() {}, removeChildView() {} } }), createView: id => { const v=new FakeView();created.set(id,v);return v }, clearSession: async () => {} })
  for (const id of TRANSLATION2_WEBSITE_PROVIDER_IDS) {
    await host.select(id, '', 'auto', 'zh-CN', 1)
    assert.equal(isAllowedTranslationWebsiteUrl(id, created.get(id).webContents.url), true)
    assert.equal(isAllowedTranslationWebsiteUrl(id, 'https://unrelated.example/'), false)
  }
  assert.equal(created.size, 8)
  await host.closeAll()
})
