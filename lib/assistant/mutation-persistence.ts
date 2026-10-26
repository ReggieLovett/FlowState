import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { AssistantError } from './errors'
import {
  assistantOperationSchema,
  subjectSnapshotSchema,
  itemSnapshotSchema,
  fullEventSnapshotSchema,
  type AssistantOperation,
  type OperationContext,
} from './operations'
import { eventSnapshotSchema, MAX_MOVES, storedChangesSchema } from './validation'

// Keep bounded complete snapshots of affected relations. A delete is never
// approved using only a total that could hide a different child row.
const MAX_AFFECTED_ROWS = 500
export type MutationDatabase = Pick<typeof prisma, 'subject' | 'subjectItem' | 'scheduleEvent'>

export const subjectSelect = {
  id: true, name: true, category: true, code: true, colorHex: true, notes: true,
  difficulty: true, examDate: true, archivedAt: true, updatedAt: true,
} satisfies Prisma.SubjectSelect
export const itemSelect = {
  id: true, subjectId: true, title: true, type: true, status: true, dueDate: true,
  estimatedMinutes: true, priority: true, notes: true, updatedAt: true,
} satisfies Prisma.SubjectItemSelect
export const fullEventSelect = {
  id: true, subjectId: true, itemId: true, title: true, category: true,
  startsAt: true, endsAt: true, isAllDay: true, location: true, notes: true,
  status: true, recurrenceRule: true, updatedAt: true,
  generatedAt: true, planReason: true,
} satisfies Prisma.ScheduleEventSelect

export const mutationSnapshotSchema = z.strictObject({
  version: z.literal(2),
  calendarConnected: z.boolean(),
  moveEvents: z.array(eventSnapshotSchema),
  subjects: z.array(subjectSnapshotSchema),
  items: z.array(itemSnapshotSchema),
  events: z.array(fullEventSnapshotSchema),
  impacts: z.array(z.strictObject({
    kind: z.enum(['subject.delete', 'item.delete']),
    id: z.string(),
    items: z.array(itemSnapshotSchema),
    events: z.array(fullEventSnapshotSchema),
  })),
})
export type MutationSnapshot = z.infer<typeof mutationSnapshotSchema>
export const storedMutationPlanSchema = z.strictObject({
  version: z.literal(2),
  changes: z.array(storedChangesSchema.element).max(MAX_MOVES),
  operations: z.array(assistantOperationSchema).min(1).max(MAX_MOVES),
})

const dateOnly = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null
const isExisting = (id: string | null | undefined): id is string => Boolean(id && !id.startsWith('new:'))
const sorted = <T extends { id: string }>(rows: T[]) => rows.sort((a, b) => a.id.localeCompare(b.id))

/** Only user-scoped queries can turn model references into authoritative rows. */
export async function readOperationContext(userId: string, operations: AssistantOperation[], db: MutationDatabase = prisma) {
  const subjectIds = new Set<string>()
  const itemIds = new Set<string>()
  const eventIds = new Set<string>()
  const linkedItemIds = operations.filter((operation) => operation.kind === 'item.update').map((operation) => operation.itemId)
  for (const operation of operations) {
    if ('subjectId' in operation && isExisting(operation.subjectId)) subjectIds.add(operation.subjectId)
    if ('itemId' in operation && isExisting(operation.itemId)) itemIds.add(operation.itemId)
    if ('eventId' in operation) eventIds.add(operation.eventId)
  }
  const [initialItemRows, eventRows] = await Promise.all([
    itemIds.size ? db.subjectItem.findMany({ where: { userId, id: { in: [...itemIds] } }, select: itemSelect, orderBy: { id: 'asc' } }) : [],
    eventIds.size || linkedItemIds.length ? db.scheduleEvent.findMany({
      where: { userId, OR: [{ id: { in: [...eventIds] } }, { itemId: { in: linkedItemIds } }] },
      select: fullEventSelect, orderBy: { id: 'asc' }, take: MAX_AFFECTED_ROWS + 1,
    }) : [],
  ])
  const itemRows = [...initialItemRows]
  if (eventRows.length > MAX_AFFECTED_ROWS) throw new AssistantError('This update affects too many calendar blocks. Use the work item editor.', 422)
  // Include original parents and links too, so their archival/deletion or
  // reassignment cannot silently change what the user approved.
  for (const item of itemRows) subjectIds.add(item.subjectId)
  for (const event of eventRows) {
    if (event.subjectId) subjectIds.add(event.subjectId)
    if (event.itemId) itemIds.add(event.itemId)
  }
  const missingItemIds = [...itemIds].filter((id) => !itemRows.some((row) => row.id === id))
  if (missingItemIds.length) itemRows.push(...await db.subjectItem.findMany({
    where: { userId, id: { in: missingItemIds } }, select: itemSelect, orderBy: { id: 'asc' },
  }))
  for (const item of itemRows) subjectIds.add(item.subjectId)
  // All names are needed for the per-user unique-name check. This remains
  // bounded and fail-closed instead of approving from a partial list.
  const subjectRows = await db.subject.findMany({ where: { userId }, select: subjectSelect, orderBy: { id: 'asc' }, take: MAX_AFFECTED_ROWS + 1 })
  if (subjectRows.length > MAX_AFFECTED_ROWS) throw new AssistantError('There are too many classes to safely review this change. Use the class editor.', 422)
  const subjects = sorted(subjectRows.map((row) => ({
    ...row, examDate: dateOnly(row.examDate), archivedAt: row.archivedAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString(),
  })))
  const items = sorted(itemRows.map((row) => ({ ...row, dueDate: dateOnly(row.dueDate), updatedAt: row.updatedAt.toISOString() })))
  const events = sorted(eventRows.map((row) => ({
    ...row, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), updatedAt: row.updatedAt.toISOString(), generatedAt: row.generatedAt?.toISOString() ?? null,
  })))
  const impacts: MutationSnapshot['impacts'] = []
  for (const operation of operations) {
    if (operation.kind !== 'subject.delete' && operation.kind !== 'item.delete') continue
    const id = operation.kind === 'subject.delete' ? operation.subjectId : operation.itemId
    const impactItems = operation.kind === 'subject.delete' ? await db.subjectItem.findMany({
      where: { userId, subjectId: id }, select: itemSelect, orderBy: { id: 'asc' }, take: MAX_AFFECTED_ROWS + 1,
    }) : []
    const impactEvents = await db.scheduleEvent.findMany({
      where: operation.kind === 'subject.delete'
        ? { userId, OR: [{ subjectId: id }, { itemId: { in: impactItems.map((item) => item.id) } }] }
        : { userId, itemId: id },
      select: fullEventSelect, orderBy: { id: 'asc' }, take: MAX_AFFECTED_ROWS + 1,
    })
    if (impactItems.length > MAX_AFFECTED_ROWS || impactEvents.length > MAX_AFFECTED_ROWS) {
      throw new AssistantError('This deletion affects too many records to review safely. Use the class or item editor.', 422)
    }
    impacts.push({
      kind: operation.kind, id,
      items: impactItems.map((row) => ({ ...row, dueDate: dateOnly(row.dueDate), updatedAt: row.updatedAt.toISOString() })),
      events: impactEvents.map((row) => ({ ...row, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), updatedAt: row.updatedAt.toISOString(), generatedAt: row.generatedAt?.toISOString() ?? null })),
    })
  }
  const context: OperationContext = { subjects, items, events }
  // Snapshot only required dependencies. Unrelated class metadata does not
  // invalidate approvals, while unique names are revalidated at confirmation.
  return { context, snapshot: { subjects: subjects.filter((row) => subjectIds.has(row.id)), items, events, impacts } }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object' && value !== null) return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}

export function verifyOperationSnapshot(before: MutationSnapshot, current: Awaited<ReturnType<typeof readOperationContext>>['snapshot']) {
  for (const key of ['subjects', 'items', 'events', 'impacts'] as const) {
    if (canonical(before[key]) !== canonical(current[key])) {
      throw new AssistantError('Your classes, work, or schedule changed after this proposal. Ask for a fresh plan before confirming.', 409)
    }
  }
}

/** Lock parents before the fresh impact read, blocking new FK-linked children. */
export async function lockOperationRows(userId: string, snapshot: MutationSnapshot, tx: Prisma.TransactionClient) {
  const ids = (values: string[]) => [...new Set(values)].sort()
  const subjectIds = ids(snapshot.subjects.map((row) => row.id))
  const itemIds = ids([...snapshot.items.map((row) => row.id), ...snapshot.impacts.flatMap((impact) => impact.items.map((row) => row.id))])
  const eventIds = ids([...snapshot.events.map((row) => row.id), ...snapshot.impacts.flatMap((impact) => impact.events.map((row) => row.id))])
  // Table names are fixed source text; model strings only enter bound values.
  // Acquire classes, items, then events, always sorted, to avoid lock inversion.
  if (subjectIds.length) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Subject" WHERE "userId" = ${userId} AND "id" IN (${Prisma.join(subjectIds)}) ORDER BY "id" FOR UPDATE`)
  if (itemIds.length) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SubjectItem" WHERE "userId" = ${userId} AND "id" IN (${Prisma.join(itemIds)}) ORDER BY "id" FOR UPDATE`)
  if (eventIds.length) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ScheduleEvent" WHERE "userId" = ${userId} AND "id" IN (${Prisma.join(eventIds)}) ORDER BY "id" FOR UPDATE`)
}

/** Attach server-derived cascade effects to the reviewed operation details. */
export function describeDeletionImpact(snapshot: Awaited<ReturnType<typeof readOperationContext>>['snapshot'], operation: AssistantOperation) {
  if (operation.kind !== 'subject.delete' && operation.kind !== 'item.delete') return []
  const id = operation.kind === 'subject.delete' ? operation.subjectId : operation.itemId
  const impact = snapshot.impacts.find((entry) => entry.kind === operation.kind && entry.id === id)
  if (!impact) return []
  if (operation.kind === 'subject.delete') return [
    { label: 'Related work item count', before: String(impact.items.length), after: 'Permanently deleted' },
    { label: 'Related calendar event count', before: String(impact.events.length), after: 'Kept with deleted links detached' },
  ]
  const removed = impact.events.filter((event) => event.status !== 'COMPLETED').length
  return [
    { label: 'Unfinished calendar block count', before: String(removed), after: 'Permanently deleted' },
    { label: 'Completed calendar block count', before: String(impact.events.length - removed), after: 'Kept with item link detached' },
  ]
}

const asDate = (value: string | null) => value === null ? null : new Date(`${value}T00:00:00.000Z`)

/** Called only inside the same serializable transaction as approval status. */
export async function applyOperations(userId: string, operations: AssistantOperation[], db: MutationDatabase, context: OperationContext) {
  const refs = new Map<string, string>()
  const resolve = (value: string | null): string | null => {
    if (!value?.startsWith('new:')) return value
    const id = refs.get(value)
    if (!id) throw new AssistantError('A linked class or work item could not be verified. Ask for a new plan.', 409)
    return id
  }
  // Dependency order is server owned, irrespective of model output order.
  for (const operation of operations.filter((operation) => operation.kind === 'subject.create')) {
    if (operation.kind !== 'subject.create') continue
    const { name, category, code, colorHex, notes, difficulty, examDate } = operation
    const row = await db.subject.create({ data: { userId, name, category, code, colorHex, notes, difficulty, examDate: asDate(examDate) }, select: { id: true } })
    refs.set(operation.ref, row.id)
  }
  for (const operation of operations.filter((operation) => operation.kind === 'item.create')) {
    if (operation.kind !== 'item.create') continue
    const { title, type, status, dueDate, estimatedMinutes, priority, notes } = operation
    const row = await db.subjectItem.create({ data: {
      userId, subjectId: resolve(operation.subjectId)!, title, type, status, dueDate: asDate(dueDate), estimatedMinutes, priority, notes,
    }, select: { id: true } })
    refs.set(operation.ref, row.id)
  }
  for (const operation of operations) {
    switch (operation.kind) {
      case 'subject.create': case 'item.create': break
      case 'subject.update': {
        const { name, category, code, colorHex, notes, difficulty, examDate } = operation
        await db.subject.update({ where: { id_userId: { id: operation.subjectId, userId } }, data: { name, category, code, colorHex, notes, difficulty, examDate: asDate(examDate) } })
        break
      }
      case 'subject.archive':
        await db.subject.update({ where: { id_userId: { id: operation.subjectId, userId } }, data: { archivedAt: operation.archived ? new Date() : null } })
        break
      case 'subject.delete':
        await db.subject.delete({ where: { id_userId: { id: operation.subjectId, userId } } })
        break
      case 'item.update': {
        const { title, type, status, dueDate, estimatedMinutes, priority, notes } = operation
        await db.subjectItem.update({ where: { id_userId: { id: operation.itemId, userId } }, data: {
          subjectId: resolve(operation.subjectId)!, title, type, status, dueDate: asDate(dueDate), estimatedMinutes, priority, notes,
        } })
        break
      }
      case 'item.complete':
        await db.subjectItem.update({ where: { id_userId: { id: operation.itemId, userId } }, data: { status: operation.status } })
        break
      case 'item.delete':
        await db.scheduleEvent.deleteMany({ where: { userId, itemId: operation.itemId, status: { not: 'COMPLETED' } } })
        await db.subjectItem.delete({ where: { id_userId: { id: operation.itemId, userId } } })
        break
      case 'event.create': {
        const { title, category, startsAt, endsAt, isAllDay, location, notes } = operation
        await db.scheduleEvent.create({ data: {
          userId, title, category, startsAt: new Date(startsAt), endsAt: new Date(endsAt), isAllDay, location, notes,
          subjectId: resolve(operation.subjectId), itemId: resolve(operation.itemId),
        } })
        break
      }
      case 'event.update': {
        const { title, category, startsAt, endsAt, isAllDay, location, notes } = operation
        const source = context.events.find((event) => event.id === operation.eventId)
        const timeChanged = source?.startsAt !== startsAt || source?.endsAt !== endsAt || source?.isAllDay !== isAllDay
        await db.scheduleEvent.update({ where: { id_userId: { id: operation.eventId, userId } }, data: {
          title, category, startsAt: new Date(startsAt), endsAt: new Date(endsAt), isAllDay, location, notes,
          subjectId: resolve(operation.subjectId), itemId: resolve(operation.itemId), ...(timeChanged ? { planReason: null } : {}),
        } })
        break
      }
      case 'event.status':
        await db.scheduleEvent.update({ where: { id_userId: { id: operation.eventId, userId } }, data: { status: operation.status } })
        break
      case 'event.delete':
        await db.scheduleEvent.delete({ where: { id_userId: { id: operation.eventId, userId } } })
        break
    }
  }
}
