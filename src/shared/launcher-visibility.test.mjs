import assert from 'node:assert/strict'
import test from 'node:test'
import { LauncherVisibilitySequence, isNewerLauncherVisibilityEvent } from './launcher-visibility.ts'

test('a pending show becomes stale after hide and a newer show', () => {
  const sequence = new LauncherVisibilitySequence()
  const firstShow = sequence.next()
  const hide = sequence.next()
  const secondShow = sequence.next()

  assert.equal(firstShow, 1)
  assert.equal(hide, 2)
  assert.equal(secondShow, 3)
  assert.equal(sequence.isCurrent(firstShow), false)
  assert.equal(sequence.isCurrent(hide), false)
  assert.equal(sequence.isCurrent(secondShow), true)
})

test('renderer ignores stale and duplicate hidden events after a newer show', () => {
  assert.equal(isNewerLauncherVisibilityEvent(3, 2), false)
  assert.equal(isNewerLauncherVisibilityEvent(3, 3), false)
  assert.equal(isNewerLauncherVisibilityEvent(2, 3), true)
})

test('a matching renderer acknowledgement releases the current show', async () => {
  const sequence = new LauncherVisibilitySequence()
  const generation = sequence.next()
  const ready = sequence.waitForAcknowledgement(generation)
  sequence.acknowledge(generation + 1)
  assert.equal(sequence.isCurrent(generation), true)
  sequence.acknowledge(generation)
  await ready
})

test('a new visibility intent releases a stale pending show without accepting its acknowledgement', async () => {
  const sequence = new LauncherVisibilitySequence()
  const previous = sequence.next()
  const previousReady = sequence.waitForAcknowledgement(previous)
  const current = sequence.next()
  await previousReady
  const currentReady = sequence.waitForAcknowledgement(current)
  sequence.acknowledge(previous)
  sequence.acknowledge(current)
  await currentReady
  assert.equal(sequence.isCurrent(current), true)
})
