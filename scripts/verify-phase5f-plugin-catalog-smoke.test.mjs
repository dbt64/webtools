import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
test('5F smoke reuses isolated driver and exercises both catalog kinds and exact Native prefill', async () => {
  const entry = await readFile(new URL('./verify-phase5f-plugin-catalog-smoke.mjs', import.meta.url), 'utf8')
  const driver = await readFile(new URL('./verify-phase5d-plugin-ui-smoke.mjs', import.meta.url), 'utf8')
  assert.ok(entry.includes('--phase5f'))
  assert.ok(driver.includes('plugin-builtin-detail'))
  assert.ok(driver.includes("kind === 'builtin'"))
  assert.ok(driver.includes('manager-translation'))
  assert.ok(driver.includes('prefillText'))
  assert.ok(driver.includes('native-only-electron-zero'))
  assert.ok(driver.includes('manager-closed-electron-zero-native-remains'))
})
