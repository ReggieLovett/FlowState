/**
 * Priority-based scheduling engine.
 *
 * Subjects are ranked by a weighted blend of exam proximity (35%), difficulty
 * (25%), urgency (20%) and outstanding workload (20%). That ranking decides how
 * many focus blocks each subject is owed; the placer then walks the calendar and
 * drops those blocks into real gaps.
 *
 * Two rules make the output usable rather than merely fair:
 *
 *   1. Nothing is placed after a subject's exam date, so revision cannot be
 *      scheduled for a paper that has already been sat.
 *   2. No subject may take more than `maxBlocksPerSubjectPerDay` on one day.
 *      Within that, blocks either alternate between subjects or stack into
 *      longer single-subject sessions, depending on `interleave`.
 *
 * Pure functions only. No storage access, no clock reads except the default
 * argument on `planSchedule`, so it is trivially testable.
 */

import type { Category } from '@prisma/client'

// ---------------------------------------------------------------------------
// Types - minimal DTOs matching what lib/data actually returns
// ---------------------------------------------------------------------------

export interface SchedulingSubject {
  id: string
  name: string
  category: Category
  colorHex: string
  difficulty: number
  examDate: Date | null
}

export interface ExistingEvent {
  id: string
  subjectId: string | null
  startsAt: Date
  endsAt: Date
  isAllDay: boolean
  status: string
  /** True when a previous run of this engine created the row. */
  isGenerated?: boolean
}

/** Serialised form of ExistingEvent as passed from server to client. */
export interface SchedulingEvent {
  id: string
  subjectId: string | null
  startsAt: string
  endsAt: string
  isAllDay: boolean
  status: string
  isGenerated?: boolean
}

export interface SchedulingPrefs {
  /** Minutes of study targeted per day. Counts focus blocks only. */
  dailyGoalMinutes: number
  /** Length of a single focus block, in minutes. */
  blockDuration: number
  /** Minutes of rest inserted between blocks. */
  breakDuration: number
  /** A longer break is inserted after this many consecutive blocks. */
  breakAfterBlocks: number
  /** Earliest hour a block may start, 0-23. */
  dayStartHour: number
  /** Latest hour a block may end, 1-24. */
  dayEndHour: number
  /** Weekday indexes (0 = Sunday) the scheduler is allowed to use. */
  studyDays: number[]
  /** Ceiling on how much of one day a single subject may take. */
  maxBlocksPerSubjectPerDay: number
  /** Alternate subjects between blocks. Off stacks each up to its daily limit. */
  interleave: boolean
}

export const DEFAULT_PREFS: SchedulingPrefs = {
  dailyGoalMinutes: 180,
  blockDuration: 50,
  breakDuration: 10,
  breakAfterBlocks: 3,
  dayStartHour: 9,
  dayEndHour: 21,
  studyDays: [1, 2, 3, 4, 5],
  maxBlocksPerSubjectPerDay: 2,
  interleave: true,
}

export interface ScoredSubject extends SchedulingSubject {
  daysUntilExam: number | null
  examProximityScore: number
  difficultyScore: number
  urgencyScore: number
  workloadScore: number
  priorityScore: number
  /** Minutes already on the calendar for this subject inside the window. */
  scheduledMinutes: number
  /** Short human phrases explaining the rank, most significant first. */
  reasons: string[]
}

export interface GeneratedBlock {
  subjectId: string
  subjectName: string
  subjectColor: string
  category: Category
  date: string
  startTime: string
  endTime: string
  duration: number
  startsAt: Date
  endsAt: Date
}

export interface DayPlan {
  date: string
  blocks: GeneratedBlock[]
  minutes: number
}

export interface SubjectPlan {
  subject: ScoredSubject
  blocks: number
  minutes: number
  /** Blocks the allocator owed this subject but the calendar could not hold. */
  unplaced: number
  share: number
}

export interface SchedulePlan {
  blocks: GeneratedBlock[]
  byDay: DayPlan[]
  bySubject: SubjectPlan[]
  totalBlocks: number
  totalMinutes: number
  days: number
  /** Blocks the allocator owed in total but could not place anywhere. */
  unplaced: number
  /** Study days in the range that ended up empty. */
  emptyDays: number
  warnings: string[]
  scored: ScoredSubject[]
}

// ---------------------------------------------------------------------------
// Date helpers (local-time, no UTC shifting)
// ---------------------------------------------------------------------------

export function toISODate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function parseISODate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function todayISO(): string {
  return toISODate(new Date())
}

export function addDaysISO(iso: string, days: number): string {
  const date = parseISODate(iso)
  date.setDate(date.getDate() + days)
  return toISODate(date)
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (parseISODate(to).getTime() - parseISODate(from).getTime()) / 86_400_000,
  )
}

function minutesToTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(minutes)))
  const hours = Math.floor(clamped / 60)
  const mins = clamped % 60
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

function makeDate(dateStr: string, minutes: number): Date {
  const d = parseISODate(dateStr)
  d.setHours(0, 0, 0, 0)
  d.setMinutes(minutes)
  return d
}

/** Minutes since midnight, rounded up to the next multiple of `step`. */
function ceilToStep(minutes: number, step: number): number {
  return Math.ceil(minutes / step) * step
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const WEIGHTS = {
  examProximity: 0.35,
  difficulty: 0.25,
  urgency: 0.2,
  workload: 0.2,
} as const

const NO_EXAM_HORIZON_DAYS = 60

/**
 * 100 on the day, stepping down through the final month, then a linear decay
 * to a floor of 10.
 *
 * The tail used to be `100 - days / 10`, which jumped from 50 at thirty days to
 * roughly 97 at thirty-one. A subject with no exam, scored as if it were sixty
 * days out, landed at 94 and outranked every exam inside the month. The curve
 * now only ever falls as the exam moves away.
 */
export function examProximityScore(daysUntilExam: number | null): number {
  if (daysUntilExam === null) return examProximityScore(NO_EXAM_HORIZON_DAYS)
  if (daysUntilExam < 0) return 0
  if (daysUntilExam === 0) return 100
  if (daysUntilExam <= 7) return 90
  if (daysUntilExam <= 14) return 75
  if (daysUntilExam <= 30) return 50
  return Math.max(10, 50 - (daysUntilExam - 30))
}

export function difficultyScore(difficulty: number): number {
  return (difficulty / 10) * 100
}

export function urgencyScore(
  daysUntilExam: number | null,
  difficulty: number,
): number {
  const days = daysUntilExam ?? NO_EXAM_HORIZON_DAYS
  const proximityFactor = Math.max(0, 100 - Math.max(0, days) * 3)
  return (proximityFactor + difficultyScore(difficulty)) / 2
}

export function workloadScore(scheduledMinutes: number): number {
  return Math.max(0, 100 - scheduledMinutes / 3)
}

/**
 * Why this subject sits where it does, in the order a reader would say it.
 *
 * Kept next to the scoring rather than in the dialog: if a weight changes, the
 * explanation has to change with it, and that is easier to remember when the
 * two sit ten lines apart.
 */
function explain(
  daysUntilExam: number | null,
  difficulty: number,
  scheduledMinutes: number,
): string[] {
  const reasons: string[] = []

  if (daysUntilExam !== null) {
    if (daysUntilExam < 0) reasons.push('Exam has passed')
    else if (daysUntilExam === 0) reasons.push('Exam today')
    else if (daysUntilExam === 1) reasons.push('Exam tomorrow')
    else if (daysUntilExam <= 30) reasons.push(`Exam in ${daysUntilExam} days`)
    else reasons.push(`Exam in ${Math.round(daysUntilExam / 7)} weeks`)
  }

  if (difficulty >= 7) reasons.push('Rated hard')
  else if (difficulty <= 3) reasons.push('Rated easy')

  if (scheduledMinutes === 0) reasons.push('Nothing booked yet')
  else if (scheduledMinutes >= 480)
    reasons.push(`${Math.round(scheduledMinutes / 60)}h already booked`)

  return reasons
}

export function scoreSubjects(
  subjects: SchedulingSubject[],
  existingEvents: ExistingEvent[],
  fromDate: string,
): ScoredSubject[] {
  const minutesBySubject = new Map<string, number>()
  for (const event of existingEvents) {
    if (!event.subjectId) continue
    if (event.status === 'CANCELLED') continue
    const duration =
      (event.endsAt.getTime() - event.startsAt.getTime()) / 60_000
    minutesBySubject.set(
      event.subjectId,
      (minutesBySubject.get(event.subjectId) ?? 0) + duration,
    )
  }

  return subjects.map((subject) => {
    const daysUntilExam = subject.examDate
      ? daysBetween(fromDate, toISODate(subject.examDate))
      : null
    const scheduledMinutes = minutesBySubject.get(subject.id) ?? 0
    const prox = examProximityScore(daysUntilExam)
    const diff = difficultyScore(subject.difficulty)
    const urg = urgencyScore(daysUntilExam, subject.difficulty)
    const work = workloadScore(scheduledMinutes)

    return {
      ...subject,
      daysUntilExam,
      scheduledMinutes,
      examProximityScore: prox,
      difficultyScore: diff,
      urgencyScore: urg,
      workloadScore: work,
      priorityScore:
        prox * WEIGHTS.examProximity +
        diff * WEIGHTS.difficulty +
        urg * WEIGHTS.urgency +
        work * WEIGHTS.workload,
      reasons: explain(daysUntilExam, subject.difficulty, scheduledMinutes),
    }
  })
}

// ---------------------------------------------------------------------------
// Allocation
// ---------------------------------------------------------------------------

interface Allocation {
  subject: ScoredSubject
  /** Blocks this subject is owed across the whole range. */
  owed: number
  /** Blocks still to place. */
  remaining: number
  /** Last date this subject may be studied, or null for no limit. */
  lastDate: string | null
  placed: number
}

/**
 * Splits `totalBlocks` between subjects in proportion to priority.
 *
 * Largest-remainder rather than round-and-hope. Rounding each share
 * independently loses or invents blocks, which showed up as a plan that
 * quietly under-filled the week; the remainder pass hands every leftover block
 * to whoever was rounded down hardest, so the parts sum to the whole.
 *
 * Two adjustments run on top. A subject whose exam falls inside the range
 * cannot absorb more blocks than the days before it can hold, and the surplus
 * is pushed back to the others. Then, while there are more blocks than
 * subjects, every subject is guaranteed at least one, taken from the largest
 * holding, so nothing silently drops out of a short plan.
 */
export function allocateBlocks(
  scored: ScoredSubject[],
  totalBlocks: number,
  capacityBySubject: Map<string, number>,
): Map<string, number> {
  const result = new Map<string, number>()
  if (scored.length === 0 || totalBlocks <= 0) return result

  const weights = scored.map((s) => Math.max(s.priorityScore, 0.01))
  const weightTotal = weights.reduce((sum, w) => sum + w, 0)

  const ideal = scored.map((s, i) => (weights[i] / weightTotal) * totalBlocks)
  const base = ideal.map(Math.floor)
  let leftover = totalBlocks - base.reduce((sum, n) => sum + n, 0)

  const byRemainder = scored
    .map((_, i) => i)
    .sort((a, b) => ideal[b] - Math.floor(ideal[b]) - (ideal[a] - Math.floor(ideal[a])))

  for (let i = 0; leftover > 0; i = (i + 1) % byRemainder.length) {
    base[byRemainder[i]] += 1
    leftover -= 1
  }

  scored.forEach((s, i) => result.set(s.id, base[i]))

  // Push back anything a subject cannot physically hold, up to a fixed number
  // of passes so a pathological input cannot spin.
  for (let pass = 0; pass < 8; pass += 1) {
    let surplus = 0
    for (const s of scored) {
      const cap = capacityBySubject.get(s.id) ?? Number.MAX_SAFE_INTEGER
      const owed = result.get(s.id) ?? 0
      if (owed > cap) {
        surplus += owed - cap
        result.set(s.id, cap)
      }
    }
    if (surplus === 0) break

    const takers = scored
      .filter((s) => (result.get(s.id) ?? 0) < (capacityBySubject.get(s.id) ?? Number.MAX_SAFE_INTEGER))
      .sort((a, b) => b.priorityScore - a.priorityScore)
    if (takers.length === 0) break

    for (let i = 0; surplus > 0; i = (i + 1) % takers.length) {
      const taker = takers[i]
      const cap = capacityBySubject.get(taker.id) ?? Number.MAX_SAFE_INTEGER
      const owed = result.get(taker.id) ?? 0
      if (owed >= cap) {
        if (takers.every((t) => (result.get(t.id) ?? 0) >= (capacityBySubject.get(t.id) ?? Number.MAX_SAFE_INTEGER))) break
        continue
      }
      result.set(taker.id, owed + 1)
      surplus -= 1
    }
  }

  // Floor of one block each, while the range is long enough to afford it.
  if (totalBlocks >= scored.length) {
    for (const s of scored) {
      if ((result.get(s.id) ?? 0) > 0) continue
      if ((capacityBySubject.get(s.id) ?? Number.MAX_SAFE_INTEGER) < 1) continue
      const donor = [...scored]
        .filter((d) => (result.get(d.id) ?? 0) > 1)
        .sort((a, b) => (result.get(b.id) ?? 0) - (result.get(a.id) ?? 0))[0]
      if (!donor) break
      result.set(donor.id, (result.get(donor.id) ?? 0) - 1)
      result.set(s.id, 1)
    }
  }

  return result
}

/**
 * The next subject to place, given what has already gone on this day.
 *
 * Preference order: relative deficit first, so a subject that is furthest from
 * its target catches up; priority as the tie-break.
 *
 * The per-day cap is hard, because it is a number the user typed in.
 *
 * With rotation on, the subject just placed steps aside whenever anyone else
 * can take the slot; if nobody can, it takes it, since a plan with holes in it
 * is worse than a slightly batched one. With rotation off, the subject just
 * placed keeps the next slot until it reaches its daily limit, which gives
 * longer single-subject sessions.
 */
function pickAllocation(
  allocations: Allocation[],
  date: string,
  placedTodayBySubject: Map<string, number>,
  prefs: SchedulingPrefs,
  avoidSubjectId: string | null,
): Allocation | undefined {
  const pool = allocations.filter(
    (a) =>
      a.remaining > 0 &&
      (a.lastDate === null || date <= a.lastDate) &&
      (placedTodayBySubject.get(a.subject.id) ?? 0) < prefs.maxBlocksPerSubjectPerDay,
  )
  if (pool.length === 0) return undefined

  if (!prefs.interleave && avoidSubjectId) {
    const current = pool.find((a) => a.subject.id === avoidSubjectId)
    if (current) return current
  }

  const rotated =
    prefs.interleave && avoidSubjectId && pool.length > 1
      ? pool.filter((a) => a.subject.id !== avoidSubjectId)
      : pool
  const candidates = rotated.length > 0 ? rotated : pool

  return candidates.reduce((best, candidate) => {
    const deficit = candidate.remaining / Math.max(candidate.owed, 1)
    const bestDeficit = best.remaining / Math.max(best.owed, 1)
    if (deficit !== bestDeficit) return deficit > bestDeficit ? candidate : best
    return candidate.subject.priorityScore > best.subject.priorityScore ? candidate : best
  })
}

function overlaps(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

export interface PlanOptions {
  /** Nothing is placed before this date. Defaults to today. */
  notBefore?: string
  /** Minutes since midnight before which nothing may start on `notBefore`. */
  notBeforeMinutes?: number
}

export function planSchedule(
  subjects: SchedulingSubject[],
  existingEvents: ExistingEvent[],
  startDate: string,
  endDate: string,
  prefs: SchedulingPrefs,
  options: PlanOptions = {},
): SchedulePlan {
  const notBefore = options.notBefore ?? todayISO()
  const empty: SchedulePlan = {
    blocks: [],
    byDay: [],
    bySubject: [],
    totalBlocks: 0,
    totalMinutes: 0,
    days: 0,
    unplaced: 0,
    emptyDays: 0,
    warnings: [],
    scored: [],
  }

  const scored = scoreSubjects(subjects, existingEvents, startDate).sort(
    (a, b) => b.priorityScore - a.priorityScore,
  )
  if (scored.length === 0) return empty

  const totalDays = daysBetween(startDate, endDate) + 1
  if (totalDays <= 0) return { ...empty, scored }

  const dates: string[] = []
  for (let i = 0; i < totalDays; i += 1) {
    const date = addDaysISO(startDate, i)
    if (date < notBefore) continue
    if (prefs.studyDays.includes(parseISODate(date).getDay())) dates.push(date)
  }
  if (dates.length === 0) {
    return {
      ...empty,
      scored,
      warnings: ['No study days fall inside this range. Pick more days of the week.'],
    }
  }

  const windowStart = prefs.dayStartHour * 60
  const windowEnd = prefs.dayEndHour * 60
  const longBreak = prefs.breakDuration * 3

  const eventsByDate = new Map<string, ExistingEvent[]>()
  for (const event of existingEvents) {
    if (event.status === 'CANCELLED') continue
    const key = toISODate(event.startsAt)
    const list = eventsByDate.get(key) ?? []
    list.push(event)
    eventsByDate.set(key, list)
  }

  // Only focus blocks count against the daily goal. A day full of lectures
  // still gets study time wherever it has gaps; the lectures block their own
  // slots but do not spend the study budget. Blocks from an earlier run do
  // spend it, so generating twice tops a day up rather than doubling it.
  const budgetByDate = new Map<string, number>()
  for (const date of dates) {
    const prior = (eventsByDate.get(date) ?? []).reduce(
      (sum, e) =>
        e.isGenerated && !e.isAllDay
          ? sum + (e.endsAt.getTime() - e.startsAt.getTime()) / 60_000
          : sum,
      0,
    )
    budgetByDate.set(date, Math.max(0, prefs.dailyGoalMinutes - prior))
  }

  // How many blocks each subject could take before its exam, so the allocator
  // never owes a subject more than the calendar can give it.
  const capacityBySubject = new Map<string, number>()
  for (const subject of scored) {
    const lastDate = subject.examDate ? toISODate(subject.examDate) : null
    const usableDays = lastDate === null ? dates.length : dates.filter((d) => d <= lastDate).length
    capacityBySubject.set(subject.id, usableDays * prefs.maxBlocksPerSubjectPerDay)
  }

  // What the user asked for, net of what is already booked. Anything the
  // calendar cannot then hold is reported as unplaced; time an earlier run
  // already covered is not.
  const totalBlocks = dates.reduce(
    (sum, date) => sum + Math.floor((budgetByDate.get(date) ?? 0) / prefs.blockDuration),
    0,
  )
  const owedBySubject = allocateBlocks(scored, totalBlocks, capacityBySubject)

  const allocations: Allocation[] = scored.map((subject) => ({
    subject,
    owed: owedBySubject.get(subject.id) ?? 0,
    remaining: owedBySubject.get(subject.id) ?? 0,
    lastDate: subject.examDate ? toISODate(subject.examDate) : null,
    placed: 0,
  }))

  const blocks: GeneratedBlock[] = []
  const byDay: DayPlan[] = []

  for (const date of dates) {
    const dayEvents = eventsByDate.get(date) ?? []

    const occupied = dayEvents.map((e) => {
      if (e.isAllDay) return { start: 0, end: 24 * 60 }
      const start = e.startsAt.getHours() * 60 + e.startsAt.getMinutes()
      const rawEnd = e.endsAt.getHours() * 60 + e.endsAt.getMinutes()
      // An event running past midnight reads as an end before its start.
      return { start, end: rawEnd <= start ? 24 * 60 : rawEnd }
    })

    let budget = budgetByDate.get(date) ?? 0
    const dayBlocks: GeneratedBlock[] = []

    let cursor = windowStart
    if (date === notBefore && options.notBeforeMinutes !== undefined) {
      cursor = Math.max(cursor, ceilToStep(options.notBeforeMinutes, 5))
    }

    const placedTodayBySubject = new Map<string, number>()
    let placedToday = 0
    let lastSubjectId: string | null = null

    while (budget >= prefs.blockDuration && cursor + prefs.blockDuration <= windowEnd) {
      const slotEnd = cursor + prefs.blockDuration
      const clash = occupied.find((slot) => overlaps(cursor, slotEnd, slot.start, slot.end))

      if (clash) {
        cursor = clash.end + prefs.breakDuration
        continue
      }

      const allocation = pickAllocation(
        allocations,
        date,
        placedTodayBySubject,
        prefs,
        lastSubjectId,
      )
      if (!allocation) break

      const { subject } = allocation
      const block: GeneratedBlock = {
        subjectId: subject.id,
        subjectName: subject.name,
        subjectColor: subject.colorHex,
        category: subject.category,
        date,
        startTime: minutesToTime(cursor),
        endTime: minutesToTime(slotEnd),
        duration: prefs.blockDuration,
        startsAt: makeDate(date, cursor),
        endsAt: makeDate(date, slotEnd),
      }
      blocks.push(block)
      dayBlocks.push(block)

      allocation.remaining -= 1
      allocation.placed += 1
      placedTodayBySubject.set(subject.id, (placedTodayBySubject.get(subject.id) ?? 0) + 1)
      lastSubjectId = subject.id
      budget -= prefs.blockDuration
      occupied.push({ start: cursor, end: slotEnd })
      placedToday += 1

      const needsLongBreak =
        prefs.breakAfterBlocks > 0 && placedToday % prefs.breakAfterBlocks === 0
      cursor = slotEnd + (needsLongBreak ? longBreak : prefs.breakDuration)
    }

    byDay.push({
      date,
      blocks: dayBlocks,
      minutes: dayBlocks.reduce((sum, b) => sum + b.duration, 0),
    })
  }

  const totalMinutes = blocks.reduce((sum, b) => sum + b.duration, 0)

  const bySubject: SubjectPlan[] = allocations
    .map((allocation) => ({
      subject: allocation.subject,
      blocks: allocation.placed,
      minutes: allocation.placed * prefs.blockDuration,
      unplaced: allocation.remaining,
      share: totalMinutes === 0 ? 0 : (allocation.placed * prefs.blockDuration) / totalMinutes,
    }))
    .sort((a, b) => b.minutes - a.minutes || b.subject.priorityScore - a.subject.priorityScore)

  const owedTotal = allocations.reduce((sum, a) => sum + a.owed, 0)
  const unplaced =
    allocations.reduce((sum, a) => sum + a.remaining, 0) + Math.max(0, totalBlocks - owedTotal)

  return {
    blocks,
    byDay,
    bySubject,
    totalBlocks: blocks.length,
    totalMinutes,
    days: byDay.filter((d) => d.blocks.length > 0).length,
    unplaced,
    emptyDays: byDay.filter((d) => d.blocks.length === 0).length,
    warnings: buildWarnings(bySubject, unplaced, prefs),
    scored,
  }
}

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

function buildWarnings(
  bySubject: SubjectPlan[],
  unplaced: number,
  prefs: SchedulingPrefs,
): string[] {
  const warnings: string[] = []

  if (unplaced > 0) {
    const hours = Math.round((unplaced * prefs.blockDuration) / 60)
    warnings.push(
      `${unplaced} ${unplaced === 1 ? 'block' : 'blocks'} (about ${hours}h) had nowhere to go. Widen the daily window, add study days or raise the per-subject limit.`,
    )
  }

  for (const entry of bySubject) {
    const { subject, minutes } = entry
    const { daysUntilExam } = subject

    if (daysUntilExam !== null && daysUntilExam < 0) {
      warnings.push(`${subject.name} has an exam date in the past. Update it or untick the subject.`)
      continue
    }
    if (minutes === 0) {
      warnings.push(`${subject.name} got no time in this range.`)
      continue
    }
    if (daysUntilExam !== null && daysUntilExam >= 0 && daysUntilExam <= 3 && minutes < 240) {
      const when = daysUntilExam === 0 ? 'today' : daysUntilExam === 1 ? 'tomorrow' : `in ${daysUntilExam} days`
      warnings.push(
        `${subject.name} has an exam ${when} but only ${Math.round(minutes / 60)}h scheduled.`,
      )
      continue
    }
    if (subject.difficulty >= 7 && minutes < 180) {
      warnings.push(`${subject.name} is rated hard but has under 3h scheduled.`)
    }
  }

  return warnings.slice(0, 4)
}

// ===========================================================================
// Item planning
//
// Subjects contain items: tasks, assignments, projects and exams, each with a
// due date and an amount of effort. `planItems` turns them into concrete
// sessions on the calendar. The subject-level planner above still runs after
// it, filling whatever daily goal is left with general study time, so a user
// with no items gets exactly the behaviour they had before.
// ===========================================================================

export type ItemKind = 'TASK' | 'ASSIGNMENT' | 'PROJECT' | 'EXAM'

export interface SchedulingItem {
  id: string
  subjectId: string
  title: string
  type: ItemKind
  /** Local calendar day, or null for work with no deadline. */
  dueDate: Date | null
  /** Null asks the planner to suggest an effort. */
  estimatedMinutes: number | null
  /** 1 low, 2 normal, 3 high. */
  priority: number
  /** Minutes already on the calendar for this item that will survive the save. */
  bookedMinutes: number
}

/** Typical effort at average difficulty, before scaling. */
const EFFORT_BASE: Record<ItemKind, number> = {
  TASK: 60,
  ASSIGNMENT: 240,
  PROJECT: 600,
  EXAM: 480,
}

export const ITEM_LABELS: Record<ItemKind, { label: string; session: string; icon: string }> = {
  TASK: { label: 'Task', session: 'Session', icon: 'bi-check2-square' },
  ASSIGNMENT: { label: 'Assignment', session: 'Session', icon: 'bi-file-earmark-text' },
  PROJECT: { label: 'Project', session: 'Work session', icon: 'bi-kanban' },
  EXAM: { label: 'Exam', session: 'Revision', icon: 'bi-mortarboard' },
}

/**
 * A starting estimate when the user leaves effort blank: the type's typical
 * effort scaled from 0.7x for a difficulty-1 subject to 1.3x for a 10.
 */
export function suggestEstimate(type: ItemKind, difficulty: number): number {
  const d = Math.min(10, Math.max(1, difficulty))
  const factor = 0.7 + ((d - 1) / 9) * 0.6
  return Math.max(15, Math.round((EFFORT_BASE[type] * factor) / 15) * 15)
}

export interface PlannedBlock extends GeneratedBlock {
  itemId: string | null
  itemTitle: string | null
  itemType: ItemKind | null
  /** 1-based position among the item's sessions in this plan, 0 for study time. */
  session: number
  sessions: number
  /** Placed past the daily goal because the deadline left no other room. */
  overGoal: boolean
  /** The title the saved event will carry. */
  title: string
}

export interface ItemPlanEntry {
  item: SchedulingItem
  subject: SchedulingSubject
  effortMinutes: number
  /** True when effort came from `suggestEstimate`. */
  estimated: boolean
  /** Effort still needed when the plan was made. */
  neededMinutes: number
  plannedMinutes: number
  unplacedMinutes: number
  sessions: number
  /** Latest day this item's work may land on. */
  lastDate: string
  overdue: boolean
}

export interface ItemPlan {
  blocks: PlannedBlock[]
  entries: ItemPlanEntry[]
  overGoalDays: string[]
  warnings: string[]
}

interface DayState {
  date: string
  windowStart: number
  windowEnd: number
  /** Minutes of the daily goal still free. */
  budget: number
  busy: { start: number; end: number }[]
  placed: { start: number; end: number; itemId: string }[]
}

/**
 * First start time on a day where `duration` fits, honouring breaks.
 *
 * Candidates are the window start and the end of everything already on the
 * day, each pushed out by a break. A candidate is valid if it clears every
 * commitment and every placed block with a break either side, and if it would
 * not extend a run of back-to-back blocks past `breakAfterBlocks`; in that case
 * the long break applies instead.
 */
function findSlot(day: DayState, duration: number, prefs: SchedulingPrefs): number | null {
  const pad = prefs.breakDuration
  const longBreak = prefs.breakDuration * 3
  const candidates = [
    day.windowStart,
    ...day.busy.map((b) => b.end + pad),
    ...day.placed.map((b) => b.end + pad),
  ]
    .map((m) => ceilToStep(Math.max(m, day.windowStart), 5))
    .sort((a, b) => a - b)

  for (let start of candidates) {
    // Enforce the long break by walking back through the chain of blocks that
    // end right before this start.
    let chain = 0
    let edge = start
    for (;;) {
      // +5 because candidate starts are rounded up to five minutes.
      const prev = day.placed.find((b) => b.end <= edge && edge - b.end <= pad + 5)
      if (!prev) break
      chain += 1
      edge = prev.start
    }
    if (prefs.breakAfterBlocks > 0 && chain >= prefs.breakAfterBlocks) {
      const lastEnd = Math.max(...day.placed.filter((b) => b.end <= start).map((b) => b.end))
      start = ceilToStep(lastEnd + longBreak, 5)
    }

    const end = start + duration
    if (end > day.windowEnd) continue
    const clashBusy = day.busy.some((b) => overlaps(start - pad, end + pad, b.start, b.end))
    const clashPlaced = day.placed.some((b) => overlaps(start - pad, end + pad, b.start, b.end))
    if (!clashBusy && !clashPlaced) return start
  }
  return null
}

/** Session lengths for `minutes` of work in blocks of `block` minutes. */
function splitSessions(minutes: number, block: number): number[] {
  if (minutes <= 0) return []
  const full = Math.floor(minutes / block)
  const rest = minutes - full * block
  const out = Array.from({ length: full }, () => block)
  if (rest >= 15 || out.length === 0) out.push(Math.max(15, ceilToStep(rest, 5)))
  // A sliver under 15 minutes rides along with the last full session.
  else out[out.length - 1] += rest
  return out
}

/**
 * Where, across its `m` eligible days, the k-th of `n` sessions would ideally
 * fall. Exams are spaced evenly with the last session on the final eligible
 * day, because spaced revision beats cramming. Assignments and projects are
 * spread over the first 80% of their window so the end stays free for slippage.
 * Tasks and anything undated go as soon as possible.
 */
function idealIndex(type: ItemKind, dated: boolean, k: number, n: number, m: number): number {
  if (m <= 1) return 0
  if (!dated || type === 'TASK') return Math.min(m - 1, k)
  if (type === 'EXAM') return Math.round(((m - 1) * (k + 1)) / n)
  return Math.round(((m - 1) * 0.8 * k) / Math.max(1, n - 1))
}

export function planItems(
  items: SchedulingItem[],
  subjects: SchedulingSubject[],
  existingEvents: ExistingEvent[],
  startDate: string,
  endDate: string,
  prefs: SchedulingPrefs,
  options: PlanOptions = {},
): ItemPlan {
  const notBefore = options.notBefore ?? todayISO()
  const subjectById = new Map(subjects.map((s) => [s.id, s]))
  const result: ItemPlan = { blocks: [], entries: [], overGoalDays: [], warnings: [] }

  const allDates: string[] = []
  for (let i = 0; i <= daysBetween(startDate, endDate); i += 1) {
    const date = addDaysISO(startDate, i)
    if (date >= notBefore) allDates.push(date)
  }
  const studyDates = allDates.filter((d) => prefs.studyDays.includes(parseISODate(d).getDay()))
  if (allDates.length === 0) return result

  // Per-day state, built once and shared by every item so they compete for
  // the same hours rather than each seeing an empty calendar.
  const days = new Map<string, DayState>()
  for (const date of allDates) {
    const dayEvents = existingEvents.filter(
      (e) => e.status !== 'CANCELLED' && toISODate(e.startsAt) === date,
    )
    const busy = dayEvents.map((e) => {
      if (e.isAllDay) return { start: 0, end: 24 * 60 }
      const start = e.startsAt.getHours() * 60 + e.startsAt.getMinutes()
      const rawEnd = e.endsAt.getHours() * 60 + e.endsAt.getMinutes()
      return { start, end: rawEnd <= start ? 24 * 60 : rawEnd }
    })
    const prior = dayEvents.reduce(
      (sum, e) =>
        e.isGenerated && !e.isAllDay ? sum + (e.endsAt.getTime() - e.startsAt.getTime()) / 60_000 : sum,
      0,
    )
    let windowStart = prefs.dayStartHour * 60
    if (date === notBefore && options.notBeforeMinutes !== undefined) {
      windowStart = Math.max(windowStart, ceilToStep(options.notBeforeMinutes, 5))
    }
    days.set(date, {
      date,
      windowStart,
      windowEnd: prefs.dayEndHour * 60,
      budget: Math.max(0, prefs.dailyGoalMinutes - prior),
      busy,
      placed: [],
    })
  }

  // Earliest deadline first: the classic order for meeting deadlines, with
  // priority and subject difficulty breaking ties. Undated work goes last.
  const prepared = items
    .map((item) => {
      const subject = subjectById.get(item.subjectId)
      if (!subject) return null
      const estimated = item.estimatedMinutes === null
      const effortMinutes = item.estimatedMinutes ?? suggestEstimate(item.type, subject.difficulty)
      const neededMinutes = Math.max(0, effortMinutes - item.bookedMinutes)

      const dueISO = item.dueDate ? toISODate(item.dueDate) : null
      const overdue = dueISO !== null && dueISO < startDate
      let lastDate = endDate
      if (dueISO && !overdue) {
        // Finish the day before, except plain tasks, which can be done on the
        // day. When the day before is already gone, the due day is allowed.
        const dayBefore = item.type === 'TASK' ? dueISO : addDaysISO(dueISO, -1)
        lastDate = dayBefore >= (allDates[0] ?? startDate) ? dayBefore : dueISO
        if (lastDate > endDate) lastDate = endDate
      }
      return { item, subject, estimated, effortMinutes, neededMinutes, dueISO, overdue, lastDate }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1
      const ad = a.dueISO ?? '9999-12-31'
      const bd = b.dueISO ?? '9999-12-31'
      if (ad !== bd) return ad < bd ? -1 : 1
      if (a.item.priority !== b.item.priority) return b.item.priority - a.item.priority
      return b.subject.difficulty - a.subject.difficulty
    })

  const overGoal = new Set<string>()

  for (const p of prepared) {
    const sessions = splitSessions(p.neededMinutes, prefs.blockDuration)
    // Study days first; if the deadline leaves none, any day in the window.
    let eligible = studyDates.filter((d) => d <= p.lastDate)
    if (eligible.length === 0 && sessions.length > 0) eligible = allDates.filter((d) => d <= p.lastDate)
    const m = eligible.length
    const perDayCap = Math.max(prefs.maxBlocksPerSubjectPerDay, Math.ceil(sessions.length / Math.max(1, m)))

    const placedHere: PlannedBlock[] = []
    let unplacedMinutes = 0

    sessions.forEach((duration, k) => {
      // Overdue work has no window left to spread over, so it goes first-come.
      const ideal = idealIndex(p.item.type, p.dueISO !== null && !p.overdue, k, sessions.length, m)

      // Pass 1 respects the daily goal and the per-day cap. Pass 2 exists for
      // deadlines: it ignores both and only needs a free slot in the window.
      for (const strict of [true, false]) {
        let best: { day: DayState; start: number; cost: number } | null = null

        eligible.forEach((date, index) => {
          const day = days.get(date)!
          const sameItem = day.placed.filter((b) => b.itemId === p.item.id).length
          if (strict && (duration > day.budget + 10 || sameItem >= perDayCap)) return
          const start = findSlot(day, duration, prefs)
          if (start === null) return

          const load = (prefs.dailyGoalMinutes - day.budget) / Math.max(1, prefs.dailyGoalMinutes)
          const cost =
            Math.abs(index - ideal) / Math.max(1, m) +
            0.6 * Math.max(0, load) +
            (sameItem > 0 ? 1.5 : 0) +
            // Mornings slightly preferred for hard subjects, evenings are not
            // penalised enough to push work past its deadline.
            start / (24 * 60 * 20)
          if (!best || cost < best.cost) best = { day, start, cost }
        })

        if (best) {
          const { day, start } = best as { day: DayState; start: number }
          day.placed.push({ start, end: start + duration, itemId: p.item.id })
          day.budget -= duration
          if (!strict) overGoal.add(day.date)
          placedHere.push({
            subjectId: p.subject.id,
            subjectName: p.subject.name,
            subjectColor: p.subject.colorHex,
            category: p.subject.category,
            date: day.date,
            startTime: minutesToTime(start),
            endTime: minutesToTime(start + duration),
            duration,
            startsAt: makeDate(day.date, start),
            endsAt: makeDate(day.date, start + duration),
            itemId: p.item.id,
            itemTitle: p.item.title,
            itemType: p.item.type,
            session: 0,
            sessions: 0,
            overGoal: !strict,
            title: p.item.title,
          })
          return
        }
      }
      unplacedMinutes += duration
    })

    // Number sessions in calendar order, whatever order they were placed in.
    placedHere.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    placedHere.forEach((block, i) => {
      block.session = i + 1
      block.sessions = placedHere.length
      block.title =
        placedHere.length > 1
          ? `${p.item.title} · ${ITEM_LABELS[p.item.type].session} ${i + 1}/${placedHere.length}`
          : p.item.title
    })
    result.blocks.push(...placedHere)

    const plannedMinutes = placedHere.reduce((sum, b) => sum + b.duration, 0)
    result.entries.push({
      item: p.item,
      subject: p.subject,
      effortMinutes: p.effortMinutes,
      estimated: p.estimated,
      neededMinutes: p.neededMinutes,
      plannedMinutes,
      unplacedMinutes,
      sessions: placedHere.length,
      lastDate: p.lastDate,
      overdue: p.overdue,
    })

    if (p.overdue) {
      result.warnings.push(`${p.item.title} was due ${formatISOShort(p.dueISO!)}. It is planned as soon as possible.`)
    }
    if (unplacedMinutes > 0) {
      const by = p.dueISO && !p.overdue ? ` before ${formatISOShort(p.dueISO)}` : ''
      result.warnings.push(
        `${p.item.title}: ${formatMinutes(unplacedMinutes)} could not fit${by}. Add study days, widen the hours or plan further ahead.`,
      )
    }
  }

  result.blocks.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
  result.overGoalDays = [...overGoal].sort()
  if (result.overGoalDays.length > 0) {
    const n = result.overGoalDays.length
    result.warnings.push(
      `${n} ${n === 1 ? 'day goes' : 'days go'} past your daily goal so deadlines are met.`,
    )
  }
  return result
}

const SHORT_DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

function formatISOShort(iso: string): string {
  return SHORT_DAY.format(parseISODate(iso))
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

// ---------------------------------------------------------------------------
// Combined plan
// ---------------------------------------------------------------------------

export interface CombinedPlan {
  blocks: PlannedBlock[]
  items: ItemPlan
  study: SchedulePlan
  totalMinutes: number
  warnings: string[]
}

/**
 * Items first, because they carry deadlines; general study time second, into
 * whatever daily goal remains. The item blocks are handed to the study planner
 * as already-generated events, so it treats their slots as taken and their
 * minutes as spent without knowing anything about items.
 */
export function planCombined(
  items: SchedulingItem[],
  subjects: SchedulingSubject[],
  existingEvents: ExistingEvent[],
  startDate: string,
  endDate: string,
  prefs: SchedulingPrefs,
  options: PlanOptions & { fillStudyTime?: boolean; studySubjects?: SchedulingSubject[] } = {},
): CombinedPlan {
  const itemPlan = planItems(items, subjects, existingEvents, startDate, endDate, prefs, options)

  const asEvents: ExistingEvent[] = itemPlan.blocks.map((b, i) => ({
    id: `planned-${i}`,
    // No subject: these hold slots and spend the daily goal, but they are not
    // "already booked" study for the subject's priority, which would otherwise
    // report this plan's own sessions back as existing work.
    subjectId: null,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    isAllDay: false,
    status: 'SCHEDULED',
    isGenerated: true,
  }))

  const study =
    options.fillStudyTime === false || (options.studySubjects ?? subjects).length === 0
      ? planSchedule([], [], startDate, endDate, prefs, options)
      : planSchedule(
          options.studySubjects ?? subjects,
          [...existingEvents, ...asEvents],
          startDate,
          endDate,
          prefs,
          options,
        )

  const studyBlocks: PlannedBlock[] = study.blocks.map((b) => ({
    ...b,
    itemId: null,
    itemTitle: null,
    itemType: null,
    session: 0,
    sessions: 0,
    overGoal: false,
    title: `${b.subjectName} · Focus block`,
  }))

  const blocks = [...itemPlan.blocks, ...studyBlocks].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  )

  // With items present, the study planner's "nowhere to go" warning is noise:
  // the items took that room on purpose.
  const studyWarnings =
    itemPlan.blocks.length > 0 ? study.warnings.filter((w) => !w.includes('nowhere to go')) : study.warnings

  return {
    blocks,
    items: itemPlan,
    study,
    totalMinutes: blocks.reduce((sum, b) => sum + b.duration, 0),
    warnings: [...itemPlan.warnings, ...studyWarnings].slice(0, 6),
  }
}
