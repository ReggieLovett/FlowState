/**
 * XP, levels, streaks, achievements and unlockable cosmetics.
 *
 * Restored from the original Smart Study Scheduler specification
 * (legacy-vue/TECHNICAL_SPEC.md, "Gamification Layer") and the level curve and
 * achievement catalogue in legacy-tailwind/lib/gamification.ts.
 *
 * Everything here is derived from schedule events rather than stored. XP is a
 * function of which blocks were completed and when, so it cannot drift from the
 * calendar: un-ticking a block takes its XP back, deleting a completed block
 * removes it, and there is no ledger to reconcile or migrate. The cost is a read
 * of the user's timed events, which is one indexed query.
 *
 * Pure functions only. `now` is always an argument so the rules are testable.
 */

import { addDays, startOfWeek, toDateInput } from '@/lib/format'

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export const XP_RULES = {
  /** 10 XP for every 25 minutes of completed focus, pro-rated. */
  xpPerBlock: 10,
  blockMinutes: 25,
  /** A single event cannot earn more than this many minutes of credit. */
  maxCreditedMinutes: 180,
  /** Every timed event on a day is done. */
  fullDayBonus: 50,
  /** Awarded on the 7th, 14th, 21st... consecutive day. */
  streakBonus: 100,
  streakBonusEvery: 7,
  /** Each consecutive day adds 10% to that day's block XP, up to 1.5x. */
  streakStep: 0.1,
  maxStreakMultiplier: 1.5,
} as const

/** The shape lib/data reads. Deliberately minimal. */
export interface ActivityEvent {
  startsAt: Date
  endsAt: Date
  status: string
  subjectId: string | null
}

export function minutesOf(event: Pick<ActivityEvent, 'startsAt' | 'endsAt'>): number {
  return Math.max(0, (event.endsAt.getTime() - event.startsAt.getTime()) / 60_000)
}

export function blockXP(minutes: number): number {
  if (minutes <= 0) return 0
  const credited = Math.min(minutes, XP_RULES.maxCreditedMinutes)
  return Math.max(1, Math.round((credited / XP_RULES.blockMinutes) * XP_RULES.xpPerBlock))
}

export function streakMultiplier(dayInRun: number): number {
  return Math.min(
    XP_RULES.maxStreakMultiplier,
    1 + Math.max(0, dayInRun - 1) * XP_RULES.streakStep,
  )
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

/** Cumulative XP to reach a level: 100 for level 2, 1,000 for 5, 4,500 for 10. */
export function xpForLevel(level: number): number {
  return 50 * level * (level - 1)
}

export function levelFromXP(xp: number): number {
  if (xp <= 0) return 1
  return Math.floor((1 + Math.sqrt(1 + (4 * xp) / 50)) / 2)
}

export interface LevelProgress {
  level: number
  earnedInLevel: number
  levelSpan: number
  fraction: number
  xpToNextLevel: number
}

export function levelProgress(totalXP: number): LevelProgress {
  const level = levelFromXP(totalXP)
  const floor = xpForLevel(level)
  const ceiling = xpForLevel(level + 1)
  return {
    level,
    earnedInLevel: totalXP - floor,
    levelSpan: ceiling - floor,
    fraction: (totalXP - floor) / (ceiling - floor),
    xpToNextLevel: ceiling - totalXP,
  }
}

// ---------------------------------------------------------------------------
// Cosmetics
// ---------------------------------------------------------------------------

export type AvatarId = 'novice' | 'student' | 'scholar' | 'master' | 'prodigy'
export type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter'

/** The five base avatars and their XP thresholds, as the spec defines them. */
export const AVATARS: { id: AvatarId; name: string; xp: number; blurb: string }[] = [
  { id: 'novice', name: 'Novice', xp: 0, blurb: 'Straw hat, fresh seeds, big plans.' },
  { id: 'student', name: 'Student', xp: 100, blurb: 'Cap on, backpack packed.' },
  { id: 'scholar', name: 'Scholar', xp: 250, blurb: 'Never without a book.' },
  { id: 'master', name: 'Master', xp: 500, blurb: 'Knows a spell for every syllabus.' },
  { id: 'prodigy', name: 'Prodigy', xp: 1000, blurb: 'Crowned by a thousand focused minutes.' },
]

export const SEASONS: { id: SeasonId; name: string; xp: number; blurb: string }[] = [
  { id: 'spring', name: 'Spring', xp: 0, blurb: 'Blossom and new growth.' },
  { id: 'summer', name: 'Summer', xp: 100, blurb: 'Long days, tall grass.' },
  { id: 'autumn', name: 'Autumn', xp: 250, blurb: 'Harvest colours.' },
  { id: 'winter', name: 'Winter', xp: 500, blurb: 'Snow on the fence posts.' },
]

export function isAvatarId(value: unknown): value is AvatarId {
  return AVATARS.some((a) => a.id === value)
}

export function isSeasonId(value: unknown): value is SeasonId {
  return SEASONS.some((s) => s.id === value)
}

export interface Look {
  avatar: (typeof AVATARS)[number]
  season: (typeof SEASONS)[number]
  /** False when nothing was chosen, so the avatar follows progress. */
  avatarChosen: boolean
}

/**
 * The avatar and season to show.
 *
 * A stored choice is honoured only while it is unlocked, because the choice
 * lives in a cookie the browser can edit. With no choice the avatar is the
 * highest one earned, so progress is visible without a visit to the rewards
 * page; the season defaults to spring, as the spec has it.
 */
export function resolveLook(
  totalXP: number,
  chosen: { avatar?: string | null; season?: string | null } = {},
): Look {
  const earnedAvatars = AVATARS.filter((a) => totalXP >= a.xp)
  const earnedSeasons = SEASONS.filter((s) => totalXP >= s.xp)

  const pickedAvatar = earnedAvatars.find((a) => a.id === chosen.avatar)
  const pickedSeason = earnedSeasons.find((s) => s.id === chosen.season)

  return {
    avatar: pickedAvatar ?? earnedAvatars[earnedAvatars.length - 1],
    season: pickedSeason ?? SEASONS[0],
    avatarChosen: Boolean(pickedAvatar),
  }
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface DayActivity {
  date: string
  /** Completed minutes on events that have started. */
  completedMinutes: number
  completedCount: number
  /** Minutes of every non-cancelled timed event, including future ones. */
  plannedMinutes: number
  plannedCount: number
  /** Non-cancelled events that have started: the denominator of completion. */
  dueCount: number
  completedEarlyCount: number
  baseXP: number
}

export interface XPBreakdown {
  blocks: number
  streakMultiplier: number
  fullDays: number
  streakBonuses: number
  total: number
}

export interface WeekBar {
  date: string
  completedMinutes: number
  plannedMinutes: number
  isToday: boolean
  isFuture: boolean
}

export interface HeatCell {
  date: string
  minutes: number
  /** 0 = nothing, 1-4 = quartiles of the user's own active days. */
  level: 0 | 1 | 2 | 3 | 4
  isFuture: boolean
}

export interface Progress {
  totalXP: number
  xp: XPBreakdown
  level: LevelProgress
  streak: { current: number; longest: number; activeToday: boolean }
  completion: { done: number; due: number; rate: number | null }
  studyMinutes: { thisWeek: number; lastWeek: number }
  week: WeekBar[]
  heatmap: HeatCell[][]
  subjectMinutes: { subjectId: string | null; minutes: number }[]
  counts: {
    completedBlocks: number
    earlyBlocks: number
    distinctSubjects: number
    fullDays: number
  }
}

function emptyDay(date: string): DayActivity {
  return {
    date,
    completedMinutes: 0,
    completedCount: 0,
    plannedMinutes: 0,
    plannedCount: 0,
    dueCount: 0,
    completedEarlyCount: 0,
    baseXP: 0,
  }
}

function dayDiff(fromISO: string, toISO: string): number {
  const [fy, fm, fd] = fromISO.split('-').map(Number)
  const [ty, tm, td] = toISO.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

function isoAdd(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return toDateInput(new Date(y, m - 1, d + days))
}

/**
 * Everything the dashboard, the rewards page and the XP toast need, from one
 * pass over the events.
 *
 * Only events that have started count toward XP, streaks and completion. That
 * closes the obvious exploit, ticking next month's blocks for instant XP, and
 * it also means an early tick is not lost: the XP arrives when the block's
 * start time passes.
 */
export function buildProgress(events: ActivityEvent[], now: Date): Progress {
  const todayISO = toDateInput(now)
  const days = new Map<string, DayActivity>()
  const subjectMinutes = new Map<string | null, number>()
  const subjectsTouched = new Set<string>()
  const thirtyDaysAgo = addDays(now, -30)

  for (const event of events) {
    if (event.status === 'CANCELLED') continue
    const date = toDateInput(event.startsAt)
    const day = days.get(date) ?? emptyDay(date)
    const minutes = minutesOf(event)
    const started = event.startsAt <= now

    day.plannedMinutes += minutes
    day.plannedCount += 1

    if (started) {
      day.dueCount += 1
      if (event.status === 'COMPLETED') {
        day.completedMinutes += minutes
        day.completedCount += 1
        day.baseXP += blockXP(minutes)
        if (event.startsAt.getHours() < 12) day.completedEarlyCount += 1
        if (event.subjectId) subjectsTouched.add(event.subjectId)
        if (event.startsAt >= thirtyDaysAgo) {
          subjectMinutes.set(event.subjectId, (subjectMinutes.get(event.subjectId) ?? 0) + minutes)
        }
      }
    }

    days.set(date, day)
  }

  // Streak runs, walked oldest first so each day knows its place in its run.
  const activeDates = [...days.values()]
    .filter((d) => d.completedCount > 0 && d.date <= todayISO)
    .map((d) => d.date)
    .sort()

  const xp: XPBreakdown = { blocks: 0, streakMultiplier: 0, fullDays: 0, streakBonuses: 0, total: 0 }
  let longest = 0
  let run = 0
  let previous: string | null = null
  let fullDayCount = 0

  for (const date of activeDates) {
    run = previous !== null && dayDiff(previous, date) === 1 ? run + 1 : 1
    longest = Math.max(longest, run)
    previous = date

    const day = days.get(date)!
    const multiplied = Math.round(day.baseXP * streakMultiplier(run))
    xp.blocks += day.baseXP
    xp.streakMultiplier += multiplied - day.baseXP

    // A full day needs every timed event on it done, including any still to
    // come later today, so today's bonus lands with its last block.
    if (day.completedCount === day.plannedCount) {
      xp.fullDays += XP_RULES.fullDayBonus
      fullDayCount += 1
    }
    if (run % XP_RULES.streakBonusEvery === 0) xp.streakBonuses += XP_RULES.streakBonus
  }
  xp.total = xp.blocks + xp.streakMultiplier + xp.fullDays + xp.streakBonuses

  // A day still in progress does not break the streak.
  const activeToday = days.get(todayISO)?.completedCount ? true : false
  let current = 0
  let cursor = activeToday ? todayISO : isoAdd(todayISO, -1)
  while ((days.get(cursor)?.completedCount ?? 0) > 0) {
    current += 1
    cursor = isoAdd(cursor, -1)
  }

  // This week, Monday first, to match the schedule page.
  const weekStart = startOfWeek(now)
  const week: WeekBar[] = Array.from({ length: 7 }, (_, i) => {
    const date = toDateInput(addDays(weekStart, i))
    const day = days.get(date)
    return {
      date,
      completedMinutes: day?.completedMinutes ?? 0,
      plannedMinutes: day?.plannedMinutes ?? 0,
      isToday: date === todayISO,
      isFuture: date > todayISO,
    }
  })

  const sumWeek = (start: Date) =>
    Array.from({ length: 7 }, (_, i) => days.get(toDateInput(addDays(start, i)))).reduce(
      (acc, day) => {
        if (!day) return acc
        return {
          minutes: acc.minutes + day.completedMinutes,
          done: acc.done + day.completedCount,
          due: acc.due + day.dueCount,
        }
      },
      { minutes: 0, done: 0, due: 0 },
    )
  const thisWeek = sumWeek(weekStart)
  const lastWeek = sumWeek(addDays(weekStart, -7))

  // Eighteen weeks of history, Monday-aligned columns. Intensity is relative to
  // the user's own active days so a light studier still sees a gradient.
  const heatWeeks = 18
  const heatStart = addDays(weekStart, -7 * (heatWeeks - 1))
  const activeMinutes = [...days.values()]
    .filter((d) => d.completedMinutes > 0)
    .map((d) => d.completedMinutes)
    .sort((a, b) => a - b)
  const quantile = (q: number) =>
    activeMinutes.length === 0 ? 0 : activeMinutes[Math.min(activeMinutes.length - 1, Math.floor(q * activeMinutes.length))]
  const cuts = [quantile(0.25), quantile(0.5), quantile(0.75)]

  const heatmap: HeatCell[][] = Array.from({ length: heatWeeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = toDateInput(addDays(heatStart, w * 7 + d))
      const minutes = days.get(date)?.completedMinutes ?? 0
      const level: HeatCell['level'] =
        minutes === 0 ? 0 : minutes <= cuts[0] ? 1 : minutes <= cuts[1] ? 2 : minutes <= cuts[2] ? 3 : 4
      return { date, minutes, level, isFuture: date > todayISO }
    }),
  )

  const completedBlocks = [...days.values()].reduce((sum, d) => sum + d.completedCount, 0)

  return {
    totalXP: xp.total,
    xp,
    level: levelProgress(xp.total),
    streak: { current, longest: Math.max(longest, current), activeToday },
    completion: {
      done: thisWeek.done,
      due: thisWeek.due,
      rate: thisWeek.due === 0 ? null : thisWeek.done / thisWeek.due,
    },
    studyMinutes: { thisWeek: thisWeek.minutes, lastWeek: lastWeek.minutes },
    week,
    heatmap,
    subjectMinutes: [...subjectMinutes.entries()]
      .map(([subjectId, minutes]) => ({ subjectId, minutes }))
      .sort((a, b) => b.minutes - a.minutes),
    counts: {
      completedBlocks,
      earlyBlocks: [...days.values()].reduce((sum, d) => sum + d.completedEarlyCount, 0),
      distinctSubjects: subjectsTouched.size,
      fullDays: fullDayCount,
    },
  }
}

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

export type BadgeGlyph = 'sprout' | 'book' | 'trophy' | 'flame' | 'sun' | 'gem' | 'star' | 'apple' | 'chest'

export interface Achievement {
  id: string
  title: string
  description: string
  glyph: BadgeGlyph
  group: 'Volume' | 'Consistency' | 'Mastery'
}

/**
 * Titles carried over from the legacy catalogue, trimmed to the milestones the
 * spec names. Badges are cosmetic: they do not grant XP, which keeps "earn
 * 1,000 XP" from feeding itself.
 */
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-block', title: 'First Seed', description: 'Complete your first block', glyph: 'sprout', group: 'Volume' },
  { id: 'ten-blocks', title: 'Getting Started', description: 'Complete 10 blocks', glyph: 'book', group: 'Volume' },
  { id: 'fifty-blocks', title: 'Dedicated Learner', description: 'Complete 50 blocks', glyph: 'chest', group: 'Volume' },
  { id: 'hundred-blocks', title: 'Study Warrior', description: 'Complete 100 blocks', glyph: 'trophy', group: 'Volume' },
  { id: 'week-streak', title: 'Week Warrior', description: 'Study 7 days in a row', glyph: 'flame', group: 'Consistency' },
  { id: 'month-streak', title: 'Monthly Master', description: 'Study 30 days in a row', glyph: 'flame', group: 'Consistency' },
  { id: 'full-day', title: 'Clean Harvest', description: 'Finish every block in a day', glyph: 'apple', group: 'Consistency' },
  { id: 'early-bird', title: 'Early Bird', description: 'Finish 20 blocks that start before midday', glyph: 'sun', group: 'Consistency' },
  { id: 'xp-1000', title: 'XP Master', description: 'Earn 1,000 XP', glyph: 'gem', group: 'Mastery' },
  { id: 'level-5', title: 'Rising Star', description: 'Reach level 5', glyph: 'star', group: 'Mastery' },
  { id: 'all-rounder', title: 'All-Rounder', description: 'Complete blocks in 5 subjects', glyph: 'gem', group: 'Mastery' },
]

export interface AchievementState extends Achievement {
  unlocked: boolean
  progress: number
  progressLabel: string
}

export function evaluateAchievements(progress: Progress): AchievementState[] {
  const { counts, streak, totalXP, level } = progress
  const targets: Record<string, { value: number; target: number; unit: string }> = {
    'first-block': { value: counts.completedBlocks, target: 1, unit: 'block' },
    'ten-blocks': { value: counts.completedBlocks, target: 10, unit: 'blocks' },
    'fifty-blocks': { value: counts.completedBlocks, target: 50, unit: 'blocks' },
    'hundred-blocks': { value: counts.completedBlocks, target: 100, unit: 'blocks' },
    // Longest, not current: a badge once earned should not disappear with a
    // missed Sunday.
    'week-streak': { value: streak.longest, target: 7, unit: 'days' },
    'month-streak': { value: streak.longest, target: 30, unit: 'days' },
    'full-day': { value: counts.fullDays, target: 1, unit: 'day' },
    'early-bird': { value: counts.earlyBlocks, target: 20, unit: 'blocks' },
    'xp-1000': { value: totalXP, target: 1000, unit: 'XP' },
    'level-5': { value: level.level, target: 5, unit: 'levels' },
    'all-rounder': { value: counts.distinctSubjects, target: 5, unit: 'subjects' },
  }

  return ACHIEVEMENTS.map((achievement) => {
    const { value, target, unit } = targets[achievement.id]
    const capped = Math.min(value, target)
    return {
      ...achievement,
      unlocked: value >= target,
      progress: capped / target,
      progressLabel: `${capped.toLocaleString('en-GB')} / ${target.toLocaleString('en-GB')} ${unit}`,
    }
  })
}

/** What changed between two snapshots, for the completion toast. */
export function diffRewards(before: Progress, after: Progress) {
  const beforeBadges = new Set(evaluateAchievements(before).filter((a) => a.unlocked).map((a) => a.id))
  return {
    xpDelta: after.totalXP - before.totalXP,
    level: after.level.level,
    leveledUp: after.level.level > before.level.level,
    avatars: AVATARS.filter((a) => before.totalXP < a.xp && after.totalXP >= a.xp).map((a) => a.name),
    seasons: SEASONS.filter((s) => before.totalXP < s.xp && after.totalXP >= s.xp).map((s) => s.name),
    badges: evaluateAchievements(after)
      .filter((a) => a.unlocked && !beforeBadges.has(a.id))
      .map((a) => a.title),
    streak: after.streak.current,
  }
}

export type RewardDiff = ReturnType<typeof diffRewards>
