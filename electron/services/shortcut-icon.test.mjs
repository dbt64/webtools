import assert from 'node:assert/strict'
import test from 'node:test'

async function loadResolver() {
  const module = await import('./shortcut-icon.ts').catch(() => ({}))
  return module.resolveShortcutIcon
}

test('uses an executable icon before the generic .lnk icon', async () => {
  const resolveShortcutIcon = await loadResolver()
  assert.equal(typeof resolveShortcutIcon, 'function')

  const target = {
    shortcutPath: 'C:\\Apps\\Visual Studio Code.lnk',
    targetPath: 'C:\\Apps\\Microsoft VS Code\\Code.exe',
    cwd: 'C:\\Apps\\Microsoft VS Code',
  }
  const iconByPath = new Map([
    [target.shortcutPath, 'generic-shortcut-icon'],
    [target.targetPath, 'visual-studio-code-icon'],
  ])
  const requestedPaths = []
  const result = await resolveShortcutIcon(target, undefined, async (path) => {
    requestedPaths.push(path)
    return iconByPath.get(path) ?? null
  })

  assert.equal(result, 'visual-studio-code-icon')
  assert.deepEqual(requestedPaths, [target.targetPath])
})

test('tries an explicit shortcut icon before the target and uses the .lnk only as fallback', async () => {
  const resolveShortcutIcon = await loadResolver()
  assert.equal(typeof resolveShortcutIcon, 'function')

  const target = {
    shortcutPath: 'C:\\Apps\\QQ.lnk',
    targetPath: 'C:\\Apps\\QQ\\QQ.exe',
    cwd: 'C:\\Apps\\QQ',
  }
  const declaredIcon = 'C:\\Apps\\QQ\\Resources\\QQIcon.dll'
  const iconByPath = new Map([
    [declaredIcon, 'qq-icon'],
    [target.targetPath, 'qq-target-icon'],
    [target.shortcutPath, 'generic-shortcut-icon'],
  ])
  const requestedPaths = []
  const result = await resolveShortcutIcon(target, declaredIcon, async (path) => {
    requestedPaths.push(path)
    return iconByPath.get(path) ?? null
  })

  assert.equal(result, 'qq-icon')
  assert.deepEqual(requestedPaths, [declaredIcon])
})

test('falls back to the .lnk icon only when declared and executable icons are unavailable', async () => {
  const resolveShortcutIcon = await loadResolver()
  assert.equal(typeof resolveShortcutIcon, 'function')

  const target = {
    shortcutPath: 'C:\\Apps\\Unknown.lnk',
    targetPath: 'C:\\Apps\\Unknown.exe',
    cwd: '',
  }
  const requestedPaths = []
  const result = await resolveShortcutIcon(target, 'C:\\missing\\icon.dll', async (path) => {
    requestedPaths.push(path)
    return path === target.shortcutPath ? 'generic-shortcut-icon' : null
  })

  assert.equal(result, 'generic-shortcut-icon')
  assert.deepEqual(requestedPaths, ['C:\\missing\\icon.dll', target.targetPath, target.shortcutPath])
})
