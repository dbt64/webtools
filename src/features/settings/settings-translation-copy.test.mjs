import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('MyMemory settings copy matches automatic translation after input pause', async () => {
  const source = await readFile(new URL('./SettingsView.vue', import.meta.url), 'utf8')
  assert.match(source, /MyMemory[^<]*停止输入约 450 毫秒[^<]*自动发送原文/)
  assert.match(source, /仅切换翻译引擎不会发送文本/)
})
