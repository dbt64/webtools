import assert from 'node:assert/strict'
import test from 'node:test'
import { buildEverythingSearchArgs, openEverythingPath } from './everything-command.ts'

test('uses standard Windows Unicode argv parsing for modern ES with an exact Chinese query', () => {
  const query = '中文文件夹 测试文档'
  const args = buildEverythingSearchArgs(query, 20, { supportsJson: true, supportsUtf8Output: true })

  assert.ok(args.includes('-argv'))
  assert.ok(args.indexOf('-argv') < args.indexOf('--'))
  assert.deepEqual(args.slice(args.indexOf('-cp'), args.indexOf('-cp') + 2), ['-cp', '65001'])
  assert.equal(args.at(-1), query)
})

test('keeps the legacy CSV command compatible with older ES versions', () => {
  const args = buildEverythingSearchArgs('中文文件', 20, { supportsJson: false, supportsUtf8Output: false })

  assert.ok(args.includes('-csv'))
  assert.ok(!args.includes('-argv'))
  assert.ok(!args.includes('-cp'))
  assert.equal(args.at(-1), '中文文件')
})

test('requests UTF-8 output from ES versions that support -cp before JSON was available', () => {
  const args = buildEverythingSearchArgs('中文文件', 20, { supportsJson: false, supportsUtf8Output: true })

  assert.ok(args.includes('-csv'))
  assert.ok(!args.includes('-argv'))
  assert.deepEqual(args.slice(args.indexOf('-cp'), args.indexOf('-cp') + 2), ['-cp', '65001'])
})

test('opens folder results through the normal shell path opener rather than waiting for Explorer', async () => {
  const path = 'D:\\System default\\Desktop\\中文目录'
  const calls = []
  await openEverythingPath(path, async (itemPath) => {
    calls.push(['shell', itemPath])
    return ''
  })

  assert.deepEqual(calls, [['shell', path]])
})

test('reports shell open errors to the caller', async () => {
  await assert.rejects(openEverythingPath('C:\\missing', async () => 'The system cannot find the path specified.'), /cannot find the path/)
})
