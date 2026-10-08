import test from 'node:test'
import assert from 'node:assert/strict'
import { webManifest, webPackage } from './fixtures.mjs'
import { isValidatedWebPackageSnapshot, validateWebPackageForRuntime } from './package-validator.ts'
import { buildRuntimeCsp, createRuntimeOrigin, buildRuntimeResourceUrl, parseRuntimePackageUrl, resolveRuntimeResource, selectValidatedWebFeature } from './web-runtime-policy.ts'

async function snapshot(overrides = {}) {
  return validateWebPackageForRuntime(webPackage(webManifest(overrides)), '0.1.0')
}

test('runtime origin uses an independent lowercase 128-bit random host', () => {
  const first = createRuntimeOrigin()
  const second = createRuntimeOrigin()
  assert.match(first.host, /^[0-9a-f]{32}$/)
  assert.equal(first.origin, `webtools-plugin://${first.host}`)
  assert.notEqual(first.host, second.host)
})

test('runtime route policy accepts only canonical inventory paths on the exact active origin', async () => {
  const value = await snapshot()
  const host = createRuntimeOrigin().host
  const valid = buildRuntimeResourceUrl(host, 'web/index.html')
  assert.equal(parseRuntimePackageUrl(valid, host), 'web/index.html')
  assert.equal(resolveRuntimeResource(value, host, valid).mimeType, 'text/html')
  const blocked = [
    `webtools-plugin://${'a'.repeat(32)}/web/index.html`,
    `webtools-plugin://${host}/web/../index.html`,
    `webtools-plugin://${host}/./web/index.html`,
    `webtools-plugin://${host}//web/index.html`,
    `webtools-plugin://${host}/web/%2e%2e/index.html`,
    `webtools-plugin://${host}/web/%252e%252e/secret`,
    `webtools-plugin://${host}/web%2findex.html`,
    `webtools-plugin://${host}/web%5cindex.html`,
    `webtools-plugin://${host}/web/%00index.html`,
    `webtools-plugin://${host}/web/index.html.`,
    `webtools-plugin://${host}/web/index.html%20`,
    `webtools-plugin://${host}/web/%65%CC%81/index.html`,
    `webtools-plugin://user@${host}/web/index.html`,
    `webtools-plugin://${host}:443/web/index.html`,
    `webtools-plugin://${host}/web/index.html?x=1`,
    `webtools-plugin://${host}/web/index.html#frag`,
    `file:///web/index.html`,
  ]
  for (const url of blocked) assert.equal(resolveRuntimeResource(value, host, url), undefined, url)
  for (const url of blocked.slice(0, 5).concat(blocked.slice(6, 8), blocked.slice(11))) assert.equal(parseRuntimePackageUrl(url, host), null, url)
  assert.equal(resolveRuntimeResource(value, host, `webtools-plugin://${host}/web/unknown.js`), undefined)
})

test('runtime CSP keeps JavaScript eval and remote origins denied; WASM is feature scoped', () => {
  const strict = buildRuntimeCsp()
  assert.match(strict, /script-src 'self'/)
  assert.doesNotMatch(strict, /unsafe-inline|unsafe-eval|https?:|wss:/)
  assert.match(strict, /worker-src 'none'/)
  assert.match(strict, /frame-src 'none'/)
  assert.match(buildRuntimeCsp(true), /script-src 'self' 'wasm-unsafe-eval'/)
})

test('selection accepts only a validated package feature with an inventoried HTML entry and network none', async () => {
  const value = await snapshot()
  assert.equal(selectValidatedWebFeature(value, 'hello').entryPath, 'web/index.html')
  assert.throws(() => selectValidatedWebFeature({}, 'hello'), /Host-validated/)
  assert.throws(() => selectValidatedWebFeature(value, 'missing'), /does not belong/)
  const domains = await snapshot({ requestedCapabilities: ['network.domains'], network: { mode: 'domains', domains: [{ host: 'example.org', protocol: 'https' }] } })
  assert.throws(() => selectValidatedWebFeature(domains, 'hello'), /network mode is unavailable/)
})

test('runtime snapshot authority cannot be forged or copied with a mismatched package hash', async () => {
  const value = await snapshot()
  const forged = { ...value, packageHash: '0'.repeat(64) }
  assert.equal(isValidatedWebPackageSnapshot(value), true)
  assert.equal(isValidatedWebPackageSnapshot(forged), false)
  assert.throws(() => selectValidatedWebFeature(forged, 'hello'), /Host-validated/)
  assert.equal(Object.isFrozen(value), true)
  assert.throws(() => { value.packageHash = '0'.repeat(64) }, TypeError)
  assert.notEqual(value.packageHash, '0'.repeat(64))
})
