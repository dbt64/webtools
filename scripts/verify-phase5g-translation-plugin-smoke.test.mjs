import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const wrapper = await readFile(new URL('./verify-phase5g-translation-plugin-smoke.mjs', import.meta.url), 'utf8')
const driver = await readFile(new URL('./verify-phase5d-plugin-ui-smoke.mjs', import.meta.url), 'utf8')

test('Phase 5G packaged smoke delegates to the existing isolated NativeHost/Manager identity driver', () => {
  assert.ok(wrapper.includes('verify-phase5d-plugin-ui-smoke.mjs'))
  assert.ok(wrapper.includes('--experimental-strip-types'))
  assert.ok(wrapper.includes('--phase5g'))
  assert.ok(driver.includes("process.argv[5] === '--phase5g'"))
  assert.ok(driver.includes('assertSafeManagerEvidenceRoot(resolve(process.argv[2] ??'))
  assert.ok(driver.includes('managerBinaryRoot.endsWith(\'manager-build\\\\win-unpacked\')'))
  assert.ok(driver.includes('WebTools.NativeHost.Resource.P5D${randomUUID()'))
  assert.ok(driver.includes('nativeIdentity = await until('))
  assert.ok(driver.includes('sameProcess(process, identity, expectedPath)'))
})

test('Phase 5G smoke covers persistence, disable gates, handoff acknowledgement and isolated cleanup', () => {
  for (const phrase of [
    "state.status === 'disabled'",
    'Settings remains accessible while Translation is disabled',
    'AI provider settings remain readable while Translation is disabled',
    "error.code, 'TRANSLATION_DISABLED'",
    'declarative Shared AI review preparation stays independent',
    'manager-translation',
    'Native Translation gate presented while disabled',
    'pendingRequestId ?? null, null',
    "disabledProjection.data.status, 'blocked'",
    'exact Unicode, whitespace and punctuation prefill applied',
    'no automatic provider request starts without configured credentials',
    'DataStore, SecretStore, Native launcher/catalog files, declarative registry/config and declarative data hashes unchanged',
    'enabled built-in Translation and declarative grant/status restored',
    "closeOwnedProcess('close', mainIdentity, managerExe",
    "closeOwnedProcess('close-native', nativeIdentity, nativeExe",
  ]) assert.ok(driver.includes(phrase), `expected packaged assertion: ${phrase}`)
  assert.ok(!driver.includes('taskkill'))
  assert.ok(!driver.includes('Stop-Process'))
})
