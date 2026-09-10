/**
 * Priority-based scheduling engine.
 *
 * Ported from legacy-tailwind/lib/scheduling.ts and adapted to work with the
 * current Prisma Subject/ScheduleEvent models. The scoring model is unchanged:
 * subjects are ranked by a weighted blend of exam proximity (35%), difficulty
 * (25%), urgency (20%) and outstanding workload (20%), then study time is
 * divided between them in proportion to that score.
 *
 * Pure functions only. No storage access, so it is trivially testable.
 */

import type { Category } from '@prisma/client'

// ---------------------------------------------------------------------------
// Types – minimal DTOs matching what lib/data actually returns
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
}

/** Serialised form of ExistingEvent as passed from server to client. */
export interface SchedulingEvent {
  id: string
  subjectId: string | null
  startsAt: string
  endsAt: string
  isAllDay: boolean
  status: string
}

export interface SchedulingPrefs {
  /** Minutes of study targeted per day. */
  dailyGoalMinutes: number
  /** Length of a single focus block, in minutes. */
  blockDuration: number
  /** Minutes of rest inserted between blocks. */
  breakDuration: number
  /** A longer break is inserted after this many consecutive blocks. */
  breakAfterBlocks: number
  /** Earliest hour a block may start, 0-23. */
  dayStartHour: number
  /** Latest hour a block may end, 0-23. */
  dayEndHour: number
  /** Weekday indexes (0 = Sunday) the scheduler is allowed to use. */
  studyDays: number[]
}

export interface ScoredSubject extends SchedulingSubject {
  daysUntilExam: number | null
  examProximityScore: number
  difficultyScore: number
  urgencyScore: number
  workloadScore: number
  priorityScore: number
}

export interface GeneratedBlock {
  subjectId: string
  subjectName: string
  subjectColor: string
  category: Category
  date: string
  startTime: string
  duration: number
  startsAt: Date
  endsAt: Date
}

// ---------------------------------------------------------------------------
// Date helpers (local-time, no UTC shifting)
// ---------------------------------------------------------------------------

function toISODate(date: Date): string {
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

function addDaysISO(iso: string, days: number): string {
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
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)))
  const hours = Math.floor(clamped / 60)
  const mins = clamped % 60
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
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

export function examProximityScore(daysUntilExam: number | null): number {
  if (daysUntilExam === null) return examProximityScore(NO_EXAM_HORIZON_DAYS)
  if (daysUntilExam < 0) return 0
  if (daysUntilExam === 0) return 100
  if (daysUntilExam <= 7) return 90
  if (daysUntilExam <= 14) return 75
  if (daysUntilExam <= 30) return 50
  return Math.max(10, 100 - daysUntilExam / 10)
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

export function scoreSubjects(
  subjects: SchedulingSubject[],
  existingEvents: ExistingEvent[],
  fromDate: string,
): ScoredSubject[] {
  const minutesBySubject = new Map<string, number>()
  for (const event of existingEvents) {
    if (!event.subjectId) continue
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
    const prox = examProximityScore(daysUntilExam)
    const diff = difficultyScore(subject.difficulty)
    const urg = urgencyScore(daysUntilExam, subject.difficulty)
    const work = workloadScore(minutesBySubject.get(subject.id) ?? 0)

    return {
      ...subject,
      daysUntilExam,
      examProximityScore: prox,
      difficultyScore: diff,
      urgencyScore: urg,
      workloadScore: work,
      priorityScore:
        prox * WEIGHTS.examProximity +
        diff * WEIGHTS.difficulty +
        urg * WEIGHTS.urgency +
        work * WEIGHTS.workload,
    }
  })
}

// ---------------------------------------------------------------------------
// Allocation & slot picker
// ---------------------------------------------------------------------------

interface Allocation {
  subject: ScoredSubject
  allocated: number
  remaining: number
}

function buildAllocations(
  scored: ScoredSubject[],
  studyDayCount: number,
  prefs: SchedulingPrefs,
): Allocation[] {
  const capacity = prefs.dailyGoalMinutes * studyDayCount
  const totalPriority = scored.reduce((sum, s) => sum + s.priorityScore, 0)

  if (totalPriority <= 0) {
    const evenShare =
      Math.floor(capacity / scored.length / prefs.blockDuration) *
      prefs.blockDuration
    return scored.map((subject) => ({
      subject,
      allocated: evenShare,
      remaining: evenShare,
    }))
  }

  return scored.map((subject) => {
    const share = (subject.priorityScore / totalPriority) * capacity
    const allocated =
      Math.round(share / prefs.blockDuration) * prefs.blockDuration
    return { subject, allocated, remaining: allocated }
  })
}

function pickAllocation(
  allocations: Allocation[],
  blockDuration: number,
): Allocation | undefined {
  let best: Allocation | undefined
  let bestDeficit = -Infinity

  for (const allocation of allocations) {
    if (allocation.remaining < blockDuration) continue
    const deficit =
      allocation.allocated === 0
        ? 0
        : allocation.remaining / allocation.allocated
    if (deficit > bestDeficit) {
      best = allocation
      bestDeficit = deficit
    }
  }

  return best
}

function overlaps(
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): boolean {
  return startA < endB && startB < endA
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

export function generateSchedule(
  subjects: SchedulingSubject[],
  existingEvents: ExistingEvent[],
  startDate: string,
  endDate: string,
  prefs: SchedulingPrefs,
  notBefore: string = todayISO(),
): GeneratedBlock[] {
  const active = subjects
  if (active.length === 0) return []

  const totalDays = daysBetween(startDate, endDate) + 1
  if (totalDays <= 0) return []

  const dates: string[] = []
  for (let i = 0; i < totalDays; i += 1) {
    const date = addDaysISO(startDate, i)
    if (date < notBefore) continue
    if (prefs.studyDays.includes(parseISODate(date).getDay())) dates.push(date)
  }
  if (dates.length === 0) return []

  const scored = scoreSubjects(active, existingEvents, startDate).sort(
    (a, b) => b.priorityScore - a.priorityScore,
  )
  const allocations = buildAllocations(scored, dates.length, prefs)

  const windowStart = prefs.dayStartHour * 60
  const windowEnd = prefs.dayEndHour * 60
  const longBreak = prefs.breakDuration * 3

  const generated: GeneratedBlock[] = []
  const subjectMeta = new Map(
    active.map((s) => [s.id, { name: s.name, color: s.colorHex, category: s.category }]),
  )

  for (const date of dates) {
    // Find existing events on this day that occupy time
    const dayEvents = existingEvents.filter((e) => {
      if (e.status === 'CANCELLED') return false
      const eDate = toISODate(e.startsAt)
      return eDate === date
    })

    const occupied = dayEvents.map((e) => ({
      start: e.isAllDay ? 0 : e.startsAt.getHours() * 60 + e.startsAt.getMinutes(),
      end: e.isAllDay ? 24 * 60 : e.endsAt.getHours() * 60 + e.endsAt.getMinutes(),
    }))

    const alreadyScheduled = dayEvents.reduce((sum, e) => {
      if (e.isAllDay) return sum
      return sum + (e.endsAt.getTime() - e.startsAt.getTime()) / 60_000
    }, 0)
    let budget = prefs.dailyGoalMinutes - alreadyScheduled
    if (budget < prefs.blockDuration) continue

    let cursor = windowStart
    let placedToday = 0

    while (
      budget >= prefs.blockDuration &&
      cursor + prefs.blockDuration <= windowEnd
    ) {
      const slotEnd = cursor + prefs.blockDuration
      const clash = occupied.find((slot) =>
        overlaps(cursor, slotEnd, slot.start, slot.end),
      )

      if (clash) {
        cursor = clash.end + prefs.breakDuration
        continue
      }

      const allocation = pickAllocation(allocations, prefs.blockDuration)
      if (!allocation) break

      const meta = subjectMeta.get(allocation.subject.id)!
      const startDT = makeDate(date, cursor)
      const endDT = makeDate(date, slotEnd)

      generated.push({
        subjectId: allocation.subject.id,
        subjectName: meta.name,
        subjectColor: meta.color,
        category: meta.category,
        date,
        startTime: minutesToTime(cursor),
        duration: prefs.blockDuration,
        startsAt: startDT,
        endsAt: endDT,
      })

      allocation.remaining -= prefs.blockDuration
      budget -= prefs.blockDuration
      occupied.push({ start: cursor, end: slotEnd })
      placedToday += 1

      const needsLongBreak = placedToday % prefs.breakAfterBlocks === 0
      cursor = slotEnd + (needsLongBreak ? longBreak : prefs.breakDuration)
    }
  }

  return generated
}

function makeDate(dateStr: string, minutes: number): Date {
  const d = parseISODate(dateStr)
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
  return d
}

// ---------------------------------------------------------------------------
// Summary & warnings
// ---------------------------------------------------------------------------

export function summarise(
  blocks: GeneratedBlock[],
  subjects: SchedulingSubject[],
) {
  const totalMinutes = blocks.reduce((sum, b) => sum + b.duration, 0)
  const bySubject = subjects
    .map((subject) => {
      const owned = blocks.filter((b) => b.subjectId === subject.id)
      return {
        subject,
        blocks: owned.length,
        minutes: owned.reduce((sum, b) => sum + b.duration, 0),
      }
    })
    .filter((entry) => entry.blocks > 0)
    .sort((a, b) => b.minutes - a.minutes)

  return {
    totalBlocks: blocks.length,
    totalMinutes,
    days: new Set(blocks.map((b) => b.date)).size,
    bySubject,
  }
}

export function scheduleWarnings(
  blocks: GeneratedBlock[],
  subjects: SchedulingSubject[],
  fromDate: string,
): string[] {
  const warnings: string[] = []

  for (const subject of subjects) {
    const minutes = blocks
      .filter((b) => b.subjectId === subject.id)
      .reduce((sum, b) => sum + b.duration, 0)
    const daysUntilExam = subject.examDate
      ? daysBetween(fromDate, toISODate(subject.examDate))
      : null

    if (minutes === 0) {
      warnings.push(
        `${subject.name} did not fit in this range. Widen your study window or add days.`,
      )
      continue
    }
    if (
      daysUntilExam !== null &&
      daysUntilExam >= 0 &&
      daysUntilExam <= 3 &&
      minutes < 240
    ) {
      warnings.push(
        `${subject.name} has an exam in ${daysUntilExam === 0 ? 'under a day' : `${daysUntilExam} days`} but only ${Math.round(minutes / 60)}h scheduled.`,
      )
      continue
    }
    if (subject.difficulty >= 7 && minutes < 180) {
      warnings.push(
        `${subject.name} is rated hard but has under 3h scheduled.`,
      )
    }
  }

  return warnings.slice(0, 3)
}
