import { pinyin } from 'pinyin-pro'
import { readFileSync } from 'node:fs'

const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const differences = rows.flatMap(({ Name, Native }) => {
  const Electron = pinyin(Name, { toneType: 'none', type: 'array' })
  return JSON.stringify(Electron) === JSON.stringify(Native) ? [] : [{ Name, Electron, Native }]
})
console.log(JSON.stringify({ total: rows.length, differences: differences.length, sample: differences.slice(0, 30) }, null, 2))
