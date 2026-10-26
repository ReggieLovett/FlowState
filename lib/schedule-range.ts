import { addDays } from '@/lib/format'

/** Ten years of navigation without invalid dates or arbitrarily large scans. */
export const MAX_SCHEDULE_WEEK_OFFSET = 520
export const MAX_SCHEDULE_DAY_OFFSET = MAX_SCHEDULE_WEEK_OFFSET * 7
export const PLANNER_HORIZON_DAYS = 28

export function boundedScheduleOffset(value: string | undefined, maximum: number): number {
  const parsed = Number.parseInt(value ?? '0', 10)
  if (Number.isNaN(parsed)) return 0
  return Math.max(-maximum, Math.min(maximum, parsed))
}

/**
 * A past week and today's planning window can be years apart. Read only those
 * two windows instead of every intervening event. Current/future weeks share
 * one contiguous query, preserving the complete 28-day planner context.
 */
export function scheduleReadRanges(weekStart: Date, todayStart: Date) {
  const weekEnd = addDays(weekStart, 7)
  const planStart = weekStart > todayStart ? weekStart : todayStart
  const horizonEnd = addDays(planStart, PLANNER_HORIZON_DAYS)
  return weekEnd >= planStart
    ? [{ from: weekStart, to: horizonEnd }]
    : [{ from: weekStart, to: weekEnd }, { from: planStart, to: horizonEnd }]
}

/** A long event may overlap both disjoint windows; show and plan it once. */
export function mergeScheduleEvents<T extends { id: string; startsAt: Date; title: string }>(groups: T[][]): T[] {
  const unique = new Map<string, T>()
  for (const group of groups) for (const event of group) unique.set(event.id, event)
  return [...unique.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.title.localeCompare(b.title))
}
