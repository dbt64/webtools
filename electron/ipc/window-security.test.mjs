import test from 'node:test'
import assert from 'node:assert/strict'
import { isCurrentAppMainFrame, isCurrentWindowMainFrame } from './window-security.ts'

function makeWindow() {
  const mainFrame = {}
  const webContents = { mainFrame, isDestroyed: () => false }
  return { window: { webContents, isDestroyed: () => false }, webContents, mainFrame }
}

test('accepts only the current window main-frame sender', () => {
  const manager = makeWindow()
  assert.equal(isCurrentWindowMainFrame({ sender: manager.webContents, senderFrame: manager.mainFrame }, manager.window), true)
  assert.equal(isCurrentWindowMainFrame({ sender: {}, senderFrame: manager.mainFrame }, manager.window), false)
  assert.equal(isCurrentWindowMainFrame({ sender: manager.webContents, senderFrame: {} }, manager.window), false)
})

test('rejects destroyed windows and accepts only current app windows', () => {
  const manager = makeWindow()
  const launcher = makeWindow()
  const event = { sender: launcher.webContents, senderFrame: launcher.mainFrame }
  assert.equal(isCurrentAppMainFrame(event, [manager.window, launcher.window]), true)
  assert.equal(isCurrentWindowMainFrame(event, manager.window), false)
  launcher.window.isDestroyed = () => true
  assert.equal(isCurrentAppMainFrame(event, [manager.window, launcher.window]), false)
})
