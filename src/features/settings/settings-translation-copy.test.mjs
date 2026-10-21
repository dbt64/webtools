import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
test('Translation service setup provides a key form and keeps JSON import under advanced settings', async () => {
 const editor = await readFile(new URL('../translation2/TranslationServiceEditor.vue', import.meta.url), 'utf8')
 const app = await readFile(new URL('../translation2/TranslationApp.vue', import.meta.url), 'utf8')
 assert.match(editor, /API Key/); assert.match(editor, /'text' : 'password'/); assert.match(editor, /保存并测试连接/)
 assert.match(editor, /DeepL API Free/); assert.match(app, /高级：导入 JSON/); assert.doesNotMatch(app, /class="brand"/)
})
