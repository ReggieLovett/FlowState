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
  generatedAt: true,
  planReason: true,
  subject: { select: { id: true, name: true, code: true, colorHex: true } },
  item: { select: { id: true, title: true, type: true, dueDate: true } },
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

  // A planner's reason describes the slot it chose ("gets your fresher
  // hours"), so it stops being true once the block moves. Cleared only when a
  // time actually changes: the edit dialog always posts both times, and
  // renaming a block should not throw its explanation away.
  let clearReason = false
  if (patch.startsAt || patch.endsAt) {
    const current = await prisma.scheduleEvent.findUnique({
      where: { id_userId: { id: eventId, userId } },
      select: { startsAt: true, endsAt: true, planReason: true },
    })
    clearReason = Boolean(
      current?.planReason &&
        ((patch.startsAt && patch.startsAt.getTime() !== current.startsAt.getTime()) ||
          (patch.endsAt && patch.endsAt.getTime() !== current.endsAt.getTime())),
    )
  }

  return prisma.scheduleEvent.update({
    where: { id_userId: { id: eventId, userId } },
    data: clearReason ? { ...patch, planReason: null } : patch,
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

// ---------------------------------------------------------------------------
// Smart scheduling
// ---------------------------------------------------------------------------

/**
 * The blocks the scheduler wrote inside [from, to).
 *
 * `generatedAt: { not: null }` is the whole definition of "machine-made", which
 * is why the column exists: without it this query would have to guess from the
 * title, and a user who renamed a block would have it treated as their own work
 * on one screen and as disposable on another.
 */
export async function listGeneratedInRange(from: Date, to: Date) {
  const userId = await requireUserId()

  return prisma.scheduleEvent.findMany({
    where: {
      userId,
      generatedAt: { not: null },
      startsAt: { lt: to },
      endsAt: { gt: from },
    },
    select: eventSelect,
    orderBy: { startsAt: 'asc' },
  })
}

export async function countGeneratedInRange(from: Date, to: Date): Promise<number> {
  const userId = await requireUserId()

  return prisma.scheduleEvent.count({
    where: {
      userId,
      generatedAt: { not: null },
      startsAt: { lt: to },
      endsAt: { gt: from },
    },
  })
}

/**
 * Removes generated blocks in a window, leaving hand-made events alone.
 *
 * Completed blocks are kept. XP, streaks and badges are derived from completed
 * events, so clearing a plan must not quietly take back what was earned.
 *
 * `deleteMany` with `userId` in the filter rather than a read-then-delete: the
 * count comes back without a second round trip, and there is no window between
 * the ownership check and the write.
 */
export async function deleteGeneratedInRange(from: Date, to: Date): Promise<number> {
  const userId = await requireUserId()

  const { count } = await prisma.scheduleEvent.deleteMany({
    where: {
      userId,
      generatedAt: { not: null },
      status: { not: 'COMPLETED' },
      startsAt: { lt: to },
      endsAt: { gt: from },
    },
  })

  return count
}

export interface GeneratedEventInput {
  subjectId: string
  /** The sub-item the block works on, if the planner scheduled one. */
  itemId?: string | null
  title: string
  category: Category
  startsAt: Date
  endsAt: Date
  notes?: string | null
  /** The planner's one-sentence reason, shown when hovering the block. */
  planReason?: string | null
}

/**
 * Writes a batch of generated blocks, optionally replacing the previous batch
 * in the same window.
 *
 * The subject ids arrive from the browser, so every one of them is checked
 * against this user before anything is written. A single `findMany` does it:
 * asking for the ids scoped by `userId` and comparing set sizes costs one query
 * regardless of how many blocks are in the batch.
 *
 * Delete and insert share a transaction so a failed insert cannot leave the
 * user with an emptied week.
 */
export async function replaceGeneratedEvents(
  blocks: GeneratedEventInput[],
  options: { replaceFrom?: Date; replaceTo?: Date } = {},
): Promise<{ created: number; removed: number }> {
  const userId = await requireUserId()
  if (blocks.length === 0) return { created: 0, removed: 0 }

  const subjectIds = [...new Set(blocks.map((b) => b.subjectId))]
  const owned = await prisma.subject.findMany({
    where: { userId, id: { in: subjectIds } },
    select: { id: true },
  })
  if (owned.length !== subjectIds.length) throw new Error('Subject not found')

  // Item ids arrive from the browser too. Each must be this user's, and must
  // sit in the subject the block claims, or a crafted payload could file one
  // subject's block under another subject's item.
  const itemIds = [...new Set(blocks.map((b) => b.itemId).filter((id): id is string => Boolean(id)))]
  if (itemIds.length > 0) {
    const items = await prisma.subjectItem.findMany({
      where: { userId, id: { in: itemIds } },
      select: { id: true, subjectId: true },
    })
    const subjectOfItem = new Map(items.map((item) => [item.id, item.subjectId]))
    const mismatch = blocks.some((b) => b.itemId && subjectOfItem.get(b.itemId) !== b.subjectId)
    if (items.length !== itemIds.length || mismatch) throw new Error('Item not found')
  }

  const generatedAt = new Date()
  const shouldReplace = Boolean(options.replaceFrom && options.replaceTo)

  const [removed, created] = await prisma.$transaction([
    prisma.scheduleEvent.deleteMany({
      where: shouldReplace
        ? {
            userId,
            generatedAt: { not: null },
            // Completed blocks hold earned XP; see deleteGeneratedInRange.
            status: { not: 'COMPLETED' },
            startsAt: { lt: options.replaceTo! },
            endsAt: { gt: options.replaceFrom! },
          }
        : // Matches nothing. Keeps the transaction a single shape.
          { userId, id: '' },
    }),
    prisma.scheduleEvent.createMany({
      data: blocks.map((block) => ({
        userId,
        subjectId: block.subjectId,
        itemId: block.itemId ?? null,
        title: block.title,
        category: block.category,
        startsAt: block.startsAt,
        endsAt: block.endsAt,
        notes: block.notes ?? null,
        planReason: block.planReason ?? null,
        isAllDay: false,
        status: 'SCHEDULED' as const,
        generatedAt,
      })),
    }),
  ])

  return { created: created.count, removed: removed.count }
}
