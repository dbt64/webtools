import test from 'node:test'
import assert from 'node:assert/strict'
import { ThemeAcceptanceOwnership } from './plugin-theme-acceptance-ownership.mjs'

const nativePath = 'C:\\Temp\\theme\\native\\WebTools.NativeHost.exe'
const managerPath = 'C:\\Temp\\theme\\manager\\WebTools.exe'
const row = (pid, parentPid, path, created = '2026-10-15T00:00:00.0000000Z', role = 'main') => ({ pid, parentPid, path, created, role })

test('a refused preflight cannot acquire or close pre-existing processes', () => {
  const ownership = new ThemeAcceptanceOwnership(nativePath, managerPath)
  const existing = [row(10, 1, nativePath, undefined, 'native'), row(11, 10, managerPath)]
  ownership.observe(existing)
  assert.deepEqual(ownership.live(existing), [])
})

test('only the launched NativeHost and its currently authenticated descendants are acquired', () => {
  const ownership = new ThemeAcceptanceOwnership(nativePath, managerPath)
  const native = row(20, 2, nativePath, undefined, 'native')
  assert.equal(ownership.claimNative([native], 20, 2), true)
  const main = row(21, 20, managerPath)
  const renderer = row(22, 21, managerPath, undefined, 'renderer')
  const unrelated = row(23, 999, managerPath)
  const otherPath = row(24, 21, 'D:\\webtools\\Manager\\WebTools.exe')
  ownership.observe([native, renderer, main, unrelated, otherPath])
  assert.deepEqual(ownership.live([native, main, renderer, unrelated, otherPath]).map(p => p.pid), [20, 21, 22])
})

test('PID reuse cannot inherit ownership or acquire another process group', () => {
  const ownership = new ThemeAcceptanceOwnership(nativePath, managerPath)
  const native = row(20, 2, nativePath, undefined, 'native')
  assert.equal(ownership.claimNative([native], 20, 2), true)
  const replacement = row(20, 2, nativePath, '2026-10-15T00:01:00.0000000Z', 'native')
  const otherMain = row(21, 20, managerPath)
  ownership.observe([replacement, otherMain])
  assert.deepEqual(ownership.live([replacement, otherMain]), [])
  assert.equal(ownership.claimNative([replacement], 20, 2), false)
})
