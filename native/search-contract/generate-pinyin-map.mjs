// Build-time data only. The published Native Host never invokes JavaScript.
// pinyin-pro 3.29.4 is MIT licensed; generate one-character readings plus
// context readings needed by the frozen parity corpus.
import { pinyin } from 'pinyin-pro'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const lines = []
for (const [first, last] of [[0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xf900, 0xfaff]]) {
  for (let code = first; code <= last; code++) {
    const character = String.fromCodePoint(code)
    const syllable = pinyin(character, { toneType: 'none', type: 'array' })[0]
    if (syllable && syllable !== character) lines.push(`${code.toString(16)}\t${syllable}`)
  }
}
writeFileSync(fileURLToPath(new URL('../WebTools.NativeHost/Search/pinyin-map.txt', import.meta.url)), lines.join('\n') + '\n')
console.log(`${lines.length} Han readings generated`)
