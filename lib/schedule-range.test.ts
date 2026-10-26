import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addDays } from './format'
import {
  MAX_SCHEDULE_DAY_OFFSET,
  MAX_SCHEDULE_WEEK_OFFSET,
  boundedScheduleOffset,
  mergeScheduleEvents,
  scheduleReadRanges,
} from './schedule-range'

const today = new Date(2026, 9, 28)
const weekStart = new Date(2026, 9, 26)

test('calendar offsets reject invalid values and bound huge positive and negative input', () => {
  assert.equal(boundedScheduleOffset(undefined, MAX_SCHEDULE_WEEK_OFFSET), 0)
  assert.equal(boundedScheduleOffset('invalid', MAX_SCHEDULE_WEEK_OFFSET), 0)
  assert.equal(boundedScheduleOffset('12', MAX_SCHEDULE_WEEK_OFFSET), 12)
  assert.equal(boundedScheduleOffset('-12', MAX_SCHEDULE_WEEK_OFFSET), -12)
  assert.equal(boundedScheduleOffset('9'.repeat(400), MAX_SCHEDULE_WEEK_OFFSET), 520)
  assert.equal(boundedScheduleOffset(`-${'9'.repeat(400)}`, MAX_SCHEDULE_DAY_OFFSET), -3640)
})

test('current and future weeks retain the entire planner window in one read', () => {
  assert.deepEqual(scheduleReadRanges(weekStart, today), [{ from: weekStart, to: addDays(today, 28) }])
  const future = addDays(weekStart, 14)
  assert.deepEqual(scheduleReadRanges(future, today), [{ from: future, to: addDays(future, 28) }])
})

test('a historical week reads seven visible days and 28 future days without the intervening years', () => {
  const past = addDays(weekStart, -7 * 520)
  const ranges = scheduleReadRanges(past, today)
  assert.deepEqual(ranges, [
    { from: past, to: addDays(past, 7) },
    { from: today, to: addDays(today, 28) },
  ])
  assert.ok(ranges[0].to < ranges[1].from)
})

test('adjacent visible and planner windows combine without a gap', () => {
  const previousMonday = addDays(weekStart, -7)
  assert.deepEqual(scheduleReadRanges(previousMonday, weekStart), [{ from: previousMonday, to: addDays(weekStart, 28) }])
})

test('events spanning both reads are deduplicated and returned in chronological order', () => {
  const old = { id: 'old', title: 'Old event', startsAt: addDays(today, -10) }
  const spanning = { id: 'long', title: 'Long event', startsAt: addDays(today, -20) }
  const future = { id: 'future', title: 'Future event', startsAt: addDays(today, 2) }
  assert.deepEqual(mergeScheduleEvents([[old, spanning], [spanning, future]]), [spanning, old, future])
})
