import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  MAX_ITEMS,
  MAX_LOCAL_EVENTS,
  type EventSnapshot,
  type PlanningWindow,
} from './validation'

const eventSelect = {
  id: true,
  title: true,
  startsAt: true,
  endsAt: true,
  updatedAt: true,
  status: true,
  isAllDay: true,
  recurrenceRule: true,
} satisfies Prisma.ScheduleEventSelect

// Keep the application's global omit configuration on both ordinary and
// transaction clients; the unconfigured Prisma.TransactionClient includes
// passwordHash in relation result types and is not structurally equivalent.
type Database = Pick<typeof prisma, 'scheduleEvent' | 'subjectItem'>

export async function readLocalContext(userId: string, window: PlanningWindow, db: Database = prisma) {
  const [rows, items, recurring] = await Promise.all([
    db.scheduleEvent.findMany({
      where: {
        userId,
        status: 'SCHEDULED',
        startsAt: { lt: window.end },
        endsAt: { gt: window.start },
      },
      select: eventSelect,
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: MAX_LOCAL_EVENTS + 1,
    }),
    db.subjectItem.findMany({
      where: { userId, status: 'TODO', subject: { archivedAt: null } },
      select: {
        id: true,
        title: true,
        type: true,
        dueDate: true,
        estimatedMinutes: true,
        priority: true,
        subject: { select: { name: true, difficulty: true, examDate: true } },
      },
      orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }, { id: 'asc' }],
      take: MAX_ITEMS + 1,
    }),
    // The current calendar stores RRULEs without an occurrence-expansion
    // service. A series starting before this window can still occupy it. Do
    // not silently ignore it or pretend the first stored row is every repeat.
    db.scheduleEvent.findFirst({
      where: { userId, status: 'SCHEDULED', recurrenceRule: { not: null }, startsAt: { lt: window.end } },
      select: { id: true },
    }),
  ])

  const events: EventSnapshot[] = rows.slice(0, MAX_LOCAL_EVENTS).map((row) => ({
    ...row,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }))

  return {
    events,
    items: items.slice(0, MAX_ITEMS).map((item) => ({
      ...item,
      dueDate: item.dueDate?.toISOString() ?? null,
      subject: { ...item.subject, examDate: item.subject.examDate?.toISOString() ?? null },
    })),
    truncated: rows.length > MAX_LOCAL_EVENTS || items.length > MAX_ITEMS,
    hasUnexpandedRecurrence: recurring !== null,
  }
}

export type LocalContext = Awaited<ReturnType<typeof readLocalContext>>
