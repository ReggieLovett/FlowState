import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { MAX_ITEMS, MAX_LOCAL_EVENTS, type EventSnapshot, type PlanningWindow } from './validation'
import type { FullEventSnapshot, ItemSnapshot, SubjectSnapshot } from './operations'

export const MAX_SUBJECTS = 120
const eventSelect = {
  id: true, title: true, startsAt: true, endsAt: true, updatedAt: true,
  status: true, isAllDay: true, recurrenceRule: true,
  subjectId: true, itemId: true, category: true, location: true, notes: true,
  generatedAt: true, planReason: true,
} satisfies Prisma.ScheduleEventSelect

// The optional delegate keeps the existing move-only transaction harness usable.
// Production's Prisma client always has all three domain delegates.
type Database = Pick<typeof prisma, 'scheduleEvent' | 'subjectItem'> & Partial<Pick<typeof prisma, 'subject'>>

export async function readLocalContext(userId: string, window: PlanningWindow, db: Database = prisma) {
  const [rows, items, subjects, recurring] = await Promise.all([
    db.scheduleEvent.findMany({
      where: { userId, startsAt: { lt: window.end }, endsAt: { gt: window.start } },
      select: eventSelect,
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], take: MAX_LOCAL_EVENTS + 1,
    }),
    db.subjectItem.findMany({
      where: { userId },
      select: {
        id: true, subjectId: true, title: true, type: true, status: true,
        dueDate: true, estimatedMinutes: true, priority: true, notes: true, updatedAt: true,
      },
      orderBy: [{ status: 'asc' }, { priority: 'desc' }, { dueDate: 'asc' }, { id: 'asc' }],
      take: MAX_ITEMS + 1,
    }),
    db.subject?.findMany({
      where: { userId },
      select: {
        id: true, name: true, category: true, code: true, colorHex: true,
        notes: true, difficulty: true, examDate: true, archivedAt: true, updatedAt: true,
      },
      orderBy: [{ archivedAt: { sort: 'desc', nulls: 'first' } }, { name: 'asc' }, { id: 'asc' }], take: MAX_SUBJECTS + 1,
    }) ?? Promise.resolve([]),
    // A stored RRULE can occupy the window even when its first row is older.
    db.scheduleEvent.findFirst({
      where: { userId, status: 'SCHEDULED', recurrenceRule: { not: null }, startsAt: { lt: window.end } },
      select: { id: true },
    }),
  ])

  const events: EventSnapshot[] = rows.slice(0, MAX_LOCAL_EVENTS).map((row) => ({
    id: row.id, title: row.title, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(), status: row.status, isAllDay: row.isAllDay, recurrenceRule: row.recurrenceRule,
  }))
  const fullEvents: FullEventSnapshot[] = rows.slice(0, MAX_LOCAL_EVENTS).map((row, index) => ({
    ...events[index], subjectId: row.subjectId ?? null, itemId: row.itemId ?? null,
    category: row.category ?? 'OTHER', location: row.location ?? null, notes: row.notes ?? null,
    generatedAt: row.generatedAt?.toISOString() ?? null, planReason: row.planReason ?? null,
  }))
  const workItems: ItemSnapshot[] = items.slice(0, MAX_ITEMS).map((row) => ({
    ...row, dueDate: row.dueDate?.toISOString().slice(0, 10) ?? null, updatedAt: row.updatedAt.toISOString(),
  }))
  const classes: SubjectSnapshot[] = subjects.slice(0, MAX_SUBJECTS).map((row) => ({
    ...row, examDate: row.examDate?.toISOString().slice(0, 10) ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString(),
  }))

  return {
    events, fullEvents, items: workItems, subjects: classes,
    eventsTruncated: rows.length > MAX_LOCAL_EVENTS,
    itemsTruncated: items.length > MAX_ITEMS,
    subjectsTruncated: subjects.length > MAX_SUBJECTS,
    truncated: rows.length > MAX_LOCAL_EVENTS || items.length > MAX_ITEMS || subjects.length > MAX_SUBJECTS,
    hasUnexpandedRecurrence: recurring !== null,
  }
}

export type LocalContext = Awaited<ReturnType<typeof readLocalContext>>
