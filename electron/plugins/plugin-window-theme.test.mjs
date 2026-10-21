import test from 'node:test'
import assert from 'node:assert/strict'
import { resolvePluginWindowTheme } from './plugin-window-theme.ts'

test('explicit plugin themes ignore the system setting; system tracks it', () => {
  for (const [preference, systemDark, scheme, background] of [
    ['light', true, 'light', '#f3f5f8'], ['dark', false, 'dark', '#0b0c0e'],
    ['system', true, 'dark', '#0b0c0e'], ['system', false, 'light', '#f3f5f8'],
  ]) {
    const theme = resolvePluginWindowTheme(preference, systemDark)
    assert.equal(theme.scheme, scheme)
    assert.equal(theme.backgroundColor, background)
  }
})

test('Host CSS provides exactly the optional root variables without page/control styling', () => {
  const names = ['scheme', 'background', 'surface', 'surface-raised', 'text', 'muted', 'border', 'accent', 'accent-foreground']
  for (const scheme of ['light', 'dark']) {
    const { css } = resolvePluginWindowTheme(scheme, false)
    assert.match(css, /^:root \{[^{}]+\}$/)
    const declarations = css.slice(css.indexOf('{') + 1, -1).split(';').map(value => value.trim()).filter(Boolean)
    assert.deepEqual(declarations.map(value => value.split(':')[0]), names.map(name => `--webtools-color-${name}`))
    assert.ok(declarations.includes(`--webtools-color-scheme: ${scheme}`))
    assert.ok(declarations.every(value => /^--webtools-color-[a-z-]+: (light|dark|#[0-9a-f]{6})$/.test(value)))
  }
})
