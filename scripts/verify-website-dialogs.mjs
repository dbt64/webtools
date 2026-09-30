import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'electron'
import { createDefaultAppData } from '../src/shared/domain.ts'

// Run after npm run build. All CRUD below uses a disposable, independent profile.
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const fixture = await mkdtemp(join(tmpdir(), 'webtools-dialog-regression-'))
const profile = join(fixture, 'profile')
await mkdir(join(profile, 'WebTools-Dev'), { recursive: true })
const data = createDefaultAppData()
data.bookmarkFolders = [{ id: 'focus-test', name: '焦点回归测试', createdAt: 1 }]
await writeFile(join(profile, 'WebTools-Dev', 'nook-data.json'), JSON.stringify(data))
const reservation = createServer()
reservation.listen(0, '127.0.0.1')
await once(reservation, 'listening')
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const harness = join(fixture, 'fixture.cjs')
await writeFile(harness, `const {app}=require('electron');
app.setPath('appData', ${JSON.stringify(profile)});
app.commandLine.appendSwitch('remote-debugging-port', ${JSON.stringify(String(port))});
process.stdin.on('data', () => app.quit());
require(${JSON.stringify(join(root, 'out/main/index.js'))});`)
const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE
const child = spawn(electron, [harness], { env: environment, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
let log = ''
child.stderr.on('data', bytes => { log += bytes.toString() })
let socket
const pending = new Map()
let sequence = 0
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

async function until(read, predicate, label) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const value = await read()
    if (predicate(value)) return value
    await delay(30)
  }
  throw new Error(`Timed out: ${label}\n${log}`)
}

function command(method, params = {}) {
  const id = ++sequence
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 10_000)
    pending.set(id, { resolve, reject, timeout })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result?.value
}

async function click(expression) { await evaluate(`(${expression}).click()`); await delay(30) }
async function mouseClick(selector) {
  const rect = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return null; const rect = element.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })()`)
  assert.ok(rect, `Element is present for mouse focus: ${selector}`)
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
  await delay(30)
}
async function deleteFolder(name) {
  await click(`document.querySelector('[aria-label="删除${name}"]')`)
  await until(() => evaluate(`!!document.querySelector('.delete-confirmation-dialog')`), Boolean, 'in-page delete confirmation')
  await click(`document.querySelector('.delete-confirmation-dialog .primary-button')`)
  await until(() => evaluate(`document.querySelectorAll('.favorite-folder').length`), count => count === 0, 'folder deletion')
}

try {
  const pages = await until(async () => {
    try { return await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() } catch { return [] }
  }, pages => pages.some(page => page.type === 'page'), 'Electron renderer start')
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl)
  await once(socket, 'open')
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    const request = pending.get(message.id)
    if (!request) return
    clearTimeout(request.timeout)
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  })
  console.log('Electron dialog fixture connected')
  await until(() => evaluate(`document.querySelectorAll('.favorite-folder').length`), count => count === 1, 'fixture data load')
  // Install only after navigation has completed so the guard survives in the real page context.
  await evaluate('window.confirm = () => false')
  await click(`document.querySelector('.favorites-page-actions button')`)
  let name = '焦点回归测试'
  for (let cycle = 1; cycle <= 10; cycle++) {
    await deleteFolder(name)
    await click(`[...document.querySelectorAll('.favorites-page-actions button')].find(button => button.textContent.includes('新建收藏夹'))`)
    await until(() => evaluate(`document.activeElement === document.querySelector('[aria-labelledby="folder-dialog-title"] input')`), Boolean, 'new-folder input focus')
    await evaluate(`document.querySelector('[aria-labelledby="folder-dialog-title"] input').blur()`)
    await mouseClick('[aria-labelledby="folder-dialog-title"] input')
    assert.equal(await evaluate(`document.activeElement === document.querySelector('[aria-labelledby="folder-dialog-title"] input')`), true, 'Mouse click should focus the new-folder input.')
    await click(`document.querySelector('[aria-labelledby="folder-dialog-title"] .secondary-button')`)
    await until(() => evaluate(`!document.querySelector('[aria-labelledby="folder-dialog-title"]')`), Boolean, 'new-folder cancel')
    await click(`[...document.querySelectorAll('.favorites-page-actions button')].find(button => button.textContent.includes('新建收藏夹'))`)
    await until(() => evaluate(`document.activeElement === document.querySelector('[aria-labelledby="folder-dialog-title"] input')`), Boolean, 'new-folder input focus after cancel')
    name = `重新创建 ${cycle}`
    await command('Input.insertText', { text: name })
    assert.equal(await evaluate(`document.querySelector('[aria-labelledby="folder-dialog-title"] input').value`), name)
    await click(`document.querySelector('[aria-labelledby="folder-dialog-title"] .primary-button')`)
    await until(() => evaluate(`document.querySelector('.favorite-folder-toggle')?.textContent.includes('${name}')`), Boolean, 'folder recreation')
    console.log(`PASS delete → new folder → mouse focus → cancel → keyboard input → save (cycle ${cycle})`)
  }
  await click(`[...document.querySelectorAll('.favorite-folder-actions button')].find(button => button.getAttribute('aria-label') === ${JSON.stringify(`重命名${'重新创建 10'}`)})`)
  await until(() => evaluate(`document.querySelector('[aria-labelledby="folder-dialog-title"] input')?.value === '重新创建 10'`), Boolean, 'rename dialog')
  await evaluate(`document.querySelector('[aria-labelledby="folder-dialog-title"] input').blur()`)
  await mouseClick('[aria-labelledby="folder-dialog-title"] input')
  assert.equal(await evaluate(`document.activeElement === document.querySelector('[aria-labelledby="folder-dialog-title"] input')`), true, 'Mouse click should focus the rename input.')
  await click(`document.querySelector('[aria-labelledby="folder-dialog-title"] .secondary-button')`)
  await until(() => evaluate(`!document.querySelector('[aria-labelledby="folder-dialog-title"]')`), Boolean, 'rename cancel')
  await click(`[...document.querySelectorAll('.favorite-folder-actions button')].find(button => button.getAttribute('aria-label') === ${JSON.stringify(`重命名${'重新创建 10'}`)})`)
  await until(() => evaluate(`document.querySelector('[aria-labelledby="folder-dialog-title"] input')?.value === '重新创建 10'`), Boolean, 'rename dialog after cancel')
  await command('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', modifiers: 2 })
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2 })
  await command('Input.insertText', { text: '重命名完成' })
  await click(`document.querySelector('[aria-labelledby="folder-dialog-title"] .primary-button')`)
  await until(() => evaluate(`document.querySelector('.favorite-folder-toggle')?.textContent.includes('重命名完成')`), Boolean, 'rename save')
  console.log('PASS rename → cancel → rename → keyboard edit → save')

  await click(`[...document.querySelectorAll('.favorites-page-actions button')].find(button => button.textContent.includes('新建收藏夹'))`)
  await until(() => evaluate(`document.activeElement === document.querySelector('[aria-labelledby="folder-dialog-title"] input')`), Boolean, 'second folder focus')
  await command('Input.insertText', { text: '并行折叠测试' })
  await click(`document.querySelector('[aria-labelledby="folder-dialog-title"] .primary-button')`)
  await until(() => evaluate(`document.querySelectorAll('.favorite-folder').length === 2`), Boolean, 'second folder creation')
  const collapseState = async () => evaluate(`Array.from(document.querySelectorAll('.favorite-folder')).map(folder => ({ name: folder.querySelector('.favorite-folder-toggle span').textContent.trim(), expanded: !!folder.querySelector('.favorite-folder-content') }))`)
  const foldersBeforeCollapse = await collapseState()
  assert.equal(foldersBeforeCollapse.length, 2)
  await click(`Array.from(document.querySelectorAll('.favorite-folder')).find(folder => folder.querySelector('.favorite-folder-toggle span').textContent.includes('重命名完成')).querySelector('.favorite-folder-toggle')`)
  await until(collapseState, states => states.find(folder => folder.name.includes('重命名完成'))?.expanded === false, 'first folder collapse')
  assert.equal((await collapseState()).find(folder => folder.name.includes('并行折叠测试'))?.expanded, true, 'Collapsing one folder must leave the other open.')
  await click(`Array.from(document.querySelectorAll('.favorite-folder')).find(folder => folder.querySelector('.favorite-folder-toggle span').textContent.includes('并行折叠测试')).querySelector('.favorite-folder-toggle')`)
  await until(collapseState, states => states.find(folder => folder.name.includes('并行折叠测试'))?.expanded === false, 'second folder collapse')
  assert.equal((await collapseState()).find(folder => folder.name.includes('重命名完成'))?.expanded, false, 'Collapsing the other folder must not expand the first.')
  await click(`Array.from(document.querySelectorAll('.favorite-folder')).find(folder => folder.querySelector('.favorite-folder-toggle span').textContent.includes('重命名完成')).querySelector('.favorite-folder-toggle')`)
  await until(collapseState, states => states.find(folder => folder.name.includes('重命名完成'))?.expanded === true, 'first folder re-expansion')
  console.log('PASS multiple folder collapse/expand state remains independent')

  await evaluate(`(() => {
    const host = document.querySelector('.favorites-folders')
    const folder = document.createElement('section')
    folder.className = 'favorite-folder acceptance-grid-folder'
    const heading = document.createElement('div')
    heading.className = 'favorite-folder-heading'
    const title = document.createElement('span')
    title.textContent = 'Temporary responsive-grid fixture'
    heading.append(title)
    const content = document.createElement('div')
    content.className = 'favorite-folder-content'
    const grid = document.createElement('div')
    grid.className = 'favorite-bookmark-grid acceptance-grid'
    for (let index = 0; index < 18; index++) {
      const item = document.createElement('div')
      item.className = 'favorite-bookmark-item'
      const button = document.createElement('button')
      button.className = 'favorite-bookmark'
      const icon = document.createElement('span')
      icon.className = 'favorite-bookmark-icon'
      const fallback = document.createElement('span')
      fallback.className = 'favicon-fallback'
      fallback.textContent = 'W'
      icon.append(fallback)
      const name = document.createElement('span')
      name.className = 'favorite-bookmark-title'
      name.title = index === 0 ? 'A deliberately very long website title used to verify ellipsis behavior' : 'Website ' + index
      name.textContent = name.title
      button.append(icon, name)
      item.append(button)
      grid.append(item)
    }
    content.append(grid)
    folder.append(heading, content)
    host.append(folder)
  })()`)
  const viewportColumns = []
  for (const width of [840, 1040, 1440]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 760, deviceScaleFactor: 1, mobile: false })
    await delay(180)
    const sample = await evaluate(`(() => {
      const grid = document.querySelector('.acceptance-grid')
      const columns = getComputedStyle(grid).gridTemplateColumns.trim().split(/\\s+/).filter(Boolean).length
      const title = grid.querySelector('.favorite-bookmark-title')
      return { viewportWidth: window.innerWidth, columns, gridWidth: grid.clientWidth, gridOverflow: grid.scrollWidth > grid.clientWidth + 1, pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, titleEllipsis: getComputedStyle(title).textOverflow === 'ellipsis' && getComputedStyle(title).whiteSpace === 'nowrap' }
    })()`)
    viewportColumns.push(sample.columns)
    assert.equal(sample.gridOverflow, false, `Grid must not overflow horizontally at width ${width}.`)
    assert.equal(sample.pageOverflow, false, `Page must not overflow horizontally at width ${width}.`)
    assert.equal(sample.titleEllipsis, true, 'Bookmark titles must remain single-line with ellipsis.')
    console.log(`PASS responsive grid width=${sample.viewportWidth}, columns=${sample.columns}, grid=${sample.gridWidth}px`)
  }
  assert.ok(viewportColumns[0] < viewportColumns[1] && viewportColumns[1] < viewportColumns[2], `Grid columns should grow with available width: ${viewportColumns.join(' → ')}`)
  await command('Emulation.clearDeviceMetricsOverride')
  console.log('PASS no native confirmation dialogs; 10 repeated folder recreations accept mouse and keyboard input.')
} catch (error) {
  console.error(log)
  throw error
} finally {
  for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(new Error('Test ended')) }
  pending.clear()
  socket?.close()
  if (child.exitCode === null) {
    child.stdin.write('exit\n')
    await Promise.race([once(child, 'exit'), delay(10_000)])
    if (child.exitCode === null) child.kill()
  }
  assert.ok(resolve(fixture).startsWith(resolve(tmpdir()) + sep), 'Cleanup must stay in the disposable temporary profile.')
  await rm(fixture, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 })
}
