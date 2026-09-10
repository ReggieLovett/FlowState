import 'server-only'

import type { Category, EventStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUserId } from '@/lib/auth-guard'

/**
 * Data access for schedule events.
 *
 * The isolation rules this module follows, in order of importance:
 *
 *   1. `userId` comes from `requireUserId()`, never from a function argument, a
 *      request body, a query string or a route param. A caller cannot ask for
 *      another user's data because there is no parameter through which to ask.
 *
 *   2. Reads always carry `where: { userId }`.
 *
 *   3. Writes address rows through the compound unique `id_userId`, so ownership
 *      is part of the same statement that mutates. `update({ where: { id } })`
 *      cannot express ownership, which is why the schema declares
 *      `@@unique([id, userId])`.
 *
 *   4. `import 'server-only'` makes it a build error to pull this file into a
 *      client component, so `prisma` can never be bundled for the browser.
 */

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Fields sent to the client. Excludes anything the UI does not render. */
const eventSelect = {
  id: true,
  title: true,
  category: true,
  startsAt: true,
  endsAt: true,
  isAllDay: true,
  location: true,
  notes: true,
  status: true,
  recurrenceRule: true,
  subject: { select: { id: true, name: true, code: true, colorHex: true } },
} satisfies Prisma.ScheduleEventSelect

export type ScheduleEventDTO = Prisma.ScheduleEventGetPayload<{
  select: typeof eventSelect
}>

/**
 * Events overlapping [from, to).
 *
 * The overlap test is `startsAt < to AND endsAt > from`, not
 * `startsAt BETWEEN from AND to`: the latter drops a Tuesday lab that began on
 * Monday evening. Served by the `@@index([userId, startsAt])`.
 */
export async function listEventsInRange(
  from: Date,
  to: Date,
  options: { categories?: Category[]; status?: EventStatus } = {},
): Promise<ScheduleEventDTO[]> {
  const userId = await requireUserId()

  return prisma.scheduleEvent.findMany({
    where: {
      userId,
      startsAt: { lt: to },
      endsAt: { gt: from },
      ...(options.categories?.length ? { category: { in: options.categories } } : {}),
      ...(options.status ? { status: options.status } : {}),
    },
    select: eventSelect,
    orderBy: [{ startsAt: 'asc' }, { title: 'asc' }],
  })
}

/**
 * A single event, or null.
 *
 * Returns null rather than throwing when the row belongs to someone else, so the
 * caller renders a 404. A "403 Forbidden" would confirm the id exists, which
 * leaks the shape of other users' data.
 */
export async function getEvent(eventId: string): Promise<ScheduleEventDTO | null> {
  const userId = await requireUserId()

  return prisma.scheduleEvent.findUnique({
    where: { id_userId: { id: eventId, userId } },
    select: eventSelect,
  })
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface EventInput {
  title: string
  category: Category
  startsAt: Date
  endsAt: Date
  subjectId?: string | null
  isAllDay?: boolean
  location?: string | null
  notes?: string | null
  recurrenceRule?: string | null
  status?: EventStatus
}

export async function createEvent(input: EventInput) {
  const userId = await requireUserId()

  // A subjectId arrives from the client, so it is the one field here that could
  // point at another user's row. Verified against this user before it is stored;
  // without this check a crafted request could attach an event to a stranger's
  // subject and read its name back through the include above.
  if (input.subjectId) {
    const owned = await prisma.subject.findUnique({
      where: { id_userId: { id: input.subjectId, userId } },
      select: { id: true },
    })
    if (!owned) throw new Error('Subject not found')
  }

  return prisma.scheduleEvent.create({
    data: { ...input, userId },
    select: eventSelect,
  })
}

/**
 * Updates an event the caller owns.
 *
 * `id_userId` is what makes this safe. With `where: { id }` the statement would
 * update the row whoever owns it, and a separate ownership read beforehand both
 * costs a round trip and leaves a window between check and write.
 */
export async function updateEvent(eventId: string, patch: Partial<EventInput>) {
  const userId = await requireUserId()

  if (patch.subjectId) {
    const owned = await prisma.subject.findUnique({
      where: { id_userId: { id: patch.subjectId, userId } },
      select: { id: true },
    })
    if (!owned) throw new Error('Subject not found')
  }

  return prisma.scheduleEvent.update({
    where: { id_userId: { id: eventId, userId } },
    data: patch,
    select: eventSelect,
  })
}

/**
 * Deletes an event the caller owns.
 *
 * `deleteMany` rather than `delete`: it returns a count instead of throwing, so
 * "not yours" and "already gone" are the same harmless outcome, and the caller
 * gets a boolean to turn into 404.
 */
export async function deleteEvent(eventId: string): Promise<boolean> {
  const userId = await requireUserId()

  const { count } = await prisma.scheduleEvent.deleteMany({
    where: { id: eventId, userId },
  })

  return count > 0
}

/** Dashboard counters. Aggregates are scoped exactly like every other read. */
export async function getDashboardSummary(from: Date, to: Date) {
  const userId = await requireUserId()

  const [byCategory, upcomingDeadlines, totalEvents] = await Promise.all([
    prisma.scheduleEvent.groupBy({
      by: ['category'],
      where: { userId, startsAt: { gte: from, lt: to } },
      _count: { _all: true },
    }),
    prisma.scheduleEvent.findMany({
      where: {
        userId,
        category: 'PROJECT_DEADLINE',
        status: 'SCHEDULED',
        startsAt: { gte: from },
      },
      select: eventSelect,
      orderBy: { startsAt: 'asc' },
      take: 5,
    }),
    prisma.scheduleEvent.count({
      where: { userId, startsAt: { gte: from, lt: to } },
    }),
  ])

  return { byCategory, upcomingDeadlines, totalEvents }
}
