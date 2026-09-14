import 'server-only'

import type { ItemStatus, ItemType, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUserId } from '@/lib/auth-guard'

/**
 * Data access for subject items: the tasks, assignments, projects and exams a
 * subject contains.
 *
 * Same isolation rules as lib/data/schedule.ts. `userId` comes only from the
 * session, reads filter by it, and writes address rows through `id_userId`.
 * Creating an item needs no separate subject ownership check: the relation to
 * Subject is on (subjectId, userId), so the insert fails at the database if the
 * subject belongs to anyone else.
 */

export const itemSelect = {
  id: true,
  subjectId: true,
  title: true,
  type: true,
  status: true,
  dueDate: true,
  estimatedMinutes: true,
  priority: true,
  notes: true,
  createdAt: true,
  events: {
    // Enough to show "2h of 6h booked" without a second query. Cancelled blocks
    // are not effort.
    where: { status: { not: 'CANCELLED' } },
    select: { startsAt: true, endsAt: true, status: true, generatedAt: true },
  },
} satisfies Prisma.SubjectItemSelect

export type SubjectItemDTO = Prisma.SubjectItemGetPayload<{ select: typeof itemSelect }>

/** Open items first, then by due date with undated work last. */
const itemOrder: Prisma.SubjectItemOrderByWithRelationInput[] = [
  { status: 'asc' },
  { dueDate: { sort: 'asc', nulls: 'last' } },
  { priority: 'desc' },
  { createdAt: 'asc' },
]

export async function listItems(
  options: { status?: ItemStatus; subjectId?: string } = {},
): Promise<SubjectItemDTO[]> {
  const userId = await requireUserId()

  return prisma.subjectItem.findMany({
    where: {
      userId,
      ...(options.status ? { status: options.status } : {}),
      ...(options.subjectId ? { subjectId: options.subjectId } : {}),
    },
    select: itemSelect,
    orderBy: itemOrder,
  })
}

export interface ItemInput {
  subjectId: string
  title: string
  type: ItemType
  dueDate?: Date | null
  estimatedMinutes?: number | null
  priority?: number
  notes?: string | null
}

export async function createItem(input: ItemInput) {
  const userId = await requireUserId()

  return prisma.subjectItem.create({
    data: { ...input, userId },
    select: itemSelect,
  })
}

/**
 * Edits an item. Moving it to another subject is allowed; the compound
 * relation rejects a subject the caller does not own, which surfaces as a
 * thrown error the action turns into a message.
 */
export async function updateItem(itemId: string, patch: Partial<ItemInput> & { status?: ItemStatus }) {
  const userId = await requireUserId()

  return prisma.subjectItem.update({
    where: { id_userId: { id: itemId, userId } },
    data: patch,
    select: itemSelect,
  })
}

/**
 * Deletes an item and the blocks still waiting to be worked.
 *
 * Unfinished blocks for work that no longer exists are clutter, so they go.
 * Completed ones stay, detached by `onDelete: SetNull`, because they are time
 * the user actually spent and they carry earned XP.
 */
export async function deleteItem(itemId: string): Promise<boolean> {
  const userId = await requireUserId()

  const [, deleted] = await prisma.$transaction([
    prisma.scheduleEvent.deleteMany({
      where: { userId, itemId, status: { not: 'COMPLETED' } },
    }),
    prisma.subjectItem.deleteMany({ where: { id: itemId, userId } }),
  ])

  return deleted.count > 0
}

/**
 * Items in a set of ids that belong to this user, with their subject.
 *
 * Used by the plan confirmation, which receives ids from the browser: the
 * caller compares the result against what it was sent.
 */
export async function findOwnedItems(itemIds: string[]) {
  const userId = await requireUserId()
  if (itemIds.length === 0) return []

  return prisma.subjectItem.findMany({
    where: { userId, id: { in: itemIds } },
    select: { id: true, subjectId: true },
  })
}
