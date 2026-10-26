import { z } from 'zod'
import { wallTimeToInstant } from '../zoned-time'
import type { AssistantChange, AssistantOperationPreview } from './contracts'
import {
  eventSnapshotSchema, MAX_MOVES, PlanValidationError,
  type BusyInterval, type EventSnapshot, type PlanningWindow,
} from './primitives'

export const categories = ['LECTURE', 'SEMINAR', 'LAB_SESSION', 'CLIENT_MEETING', 'PROJECT_DEADLINE', 'DEEP_WORK_SHIFT', 'OTHER'] as const
const category = z.enum(categories)
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9_-]+$/)
const ref = z.string().regex(/^new:[a-z][a-z0-9_-]{0,47}$/)
const relationId = z.union([id, ref])
const reason = z.string().trim().min(1).max(280)
const instant = z.iso.datetime({ offset: true })
// Date-only fields must round-trip. JavaScript otherwise accepts February 31.
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, 'Use a real calendar date.')
const nullableNotes = z.string().trim().max(2000).nullable()

const subjectFields = {
  name: z.string().trim().min(1).max(120), category,
  code: z.string().trim().max(40).nullable(),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/), notes: nullableNotes,
  difficulty: z.number().int().min(1).max(10), examDate: dateOnly.nullable(),
}
const itemFields = {
  subjectId: relationId, title: z.string().trim().min(1).max(200),
  type: z.enum(['TASK', 'ASSIGNMENT', 'PROJECT', 'EXAM']),
  status: z.enum(['TODO', 'DONE']), dueDate: dateOnly.nullable(),
  estimatedMinutes: z.number().int().min(15).max(12_000).nullable(),
  priority: z.number().int().min(1).max(3), notes: nullableNotes,
}
const eventFields = {
  subjectId: relationId.nullable(), itemId: relationId.nullable(),
  title: z.string().trim().min(1).max(200), category,
  startsAt: instant, endsAt: instant, isAllDay: z.boolean(),
  location: z.string().trim().max(200).nullable(), notes: nullableNotes,
}

/** A closed operation vocabulary: the model cannot select tables or owner ids. */
export const assistantOperationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('subject.create'), ref, ...subjectFields, reason }),
  z.strictObject({ kind: z.literal('subject.update'), subjectId: id, ...subjectFields, reason }),
  z.strictObject({ kind: z.literal('subject.archive'), subjectId: id, archived: z.boolean(), reason }),
  z.strictObject({ kind: z.literal('subject.delete'), subjectId: id, reason }),
  z.strictObject({ kind: z.literal('item.create'), ref, ...itemFields, reason }),
  z.strictObject({ kind: z.literal('item.update'), itemId: id, ...itemFields, reason }),
  z.strictObject({ kind: z.literal('item.complete'), itemId: id, status: z.enum(['TODO', 'DONE']), reason }),
  z.strictObject({ kind: z.literal('item.delete'), itemId: id, reason }),
  z.strictObject({ kind: z.literal('event.create'), ...eventFields, reason }),
  z.strictObject({ kind: z.literal('event.update'), eventId: id, ...eventFields, reason }),
  z.strictObject({ kind: z.literal('event.status'), eventId: id, status: z.enum(['SCHEDULED', 'COMPLETED', 'CANCELLED']), reason }),
  z.strictObject({ kind: z.literal('event.delete'), eventId: id, reason }),
])
export type AssistantOperation = z.infer<typeof assistantOperationSchema>

export const subjectSnapshotSchema = z.strictObject({
  id, ...subjectFields, archivedAt: instant.nullable(), updatedAt: instant,
})
export const itemSnapshotSchema = z.strictObject({ id, ...itemFields, updatedAt: instant })
export const fullEventSnapshotSchema = eventSnapshotSchema.extend({
  subjectId: id.nullable(), itemId: id.nullable(), category,
  location: z.string().nullable(), notes: z.string().nullable(),
  generatedAt: instant.nullable(), planReason: z.string().nullable(),
})
export type SubjectSnapshot = z.infer<typeof subjectSnapshotSchema>
export type ItemSnapshot = z.infer<typeof itemSnapshotSchema>
export type FullEventSnapshot = z.infer<typeof fullEventSnapshotSchema>
export interface OperationContext {
  subjects: SubjectSnapshot[]
  items: ItemSnapshot[]
  events: FullEventSnapshot[]
}

function fail(message: string): never { throw new PlanValidationError(message) }
const pretty = (value: unknown): string | null => value === null ? null : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value).replaceAll('_', ' ')
const subjectLabels = { name: 'Name', category: 'Category', code: 'Code', colorHex: 'Color', notes: 'Notes', difficulty: 'Difficulty', examDate: 'Exam date' }
const itemLabels = { subjectId: 'Class', title: 'Title', type: 'Type', status: 'Status', dueDate: 'Due date', estimatedMinutes: 'Estimated minutes', priority: 'Priority', notes: 'Notes' }
const eventLabels = { subjectId: 'Class', itemId: 'Work item', title: 'Title', category: 'Category', startsAt: 'Starts', endsAt: 'Ends', isAllDay: 'All day', location: 'Location', notes: 'Notes' }

/** Server-owned context only. One target may be changed once per proposal. */
export function validateOperations(
  candidates: AssistantOperation[], context: OperationContext, window: PlanningWindow, now = new Date(), timeZone = 'UTC',
): { operations: AssistantOperation[]; previews: AssistantOperationPreview[]; touchesTimeline: boolean } {
  if (candidates.length > MAX_MOVES) fail('This plan contains too many changes. Use at most 12 changes at a time.')
  const parsed = z.array(assistantOperationSchema).safeParse(candidates)
  if (!parsed.success) fail('The assistant proposed invalid fields. Ask for a fresh plan.')
  const operations = parsed.data
  const subjects = new Map(context.subjects.map((row) => [row.id, { ...row }]))
  const items = new Map(context.items.map((row) => [row.id, { ...row }]))
  const events = new Map(context.events.map((row) => [row.id, { ...row }]))
  const refs = new Set<string>()
  const targets = new Set<string>()
  const deletedSubjects = new Set(operations.filter((op) => op.kind === 'subject.delete').map((op) => op.subjectId))
  const deletedItems = new Set(operations.filter((op) => op.kind === 'item.delete').map((op) => op.itemId))
  const previews: AssistantOperationPreview[] = []
  let touchesTimeline = false

  // Creators must precede references. This makes the atomic write order explicit.
  const ownedSubject = (subjectId: string, allowArchived = false) => {
    const source = subjects.get(subjectId)
    if (!source || deletedSubjects.has(subjectId) || (!allowArchived && source.archivedAt !== null)) fail('That class is unavailable or archived. Ask for a fresh plan.')
    return source
  }
  const ownedItem = (itemId: string) => {
    const source = items.get(itemId)
    if (!source || deletedItems.has(itemId) || deletedSubjects.has(source.subjectId)) fail('That task or assignment is unavailable. Ask for a fresh plan.')
    return source
  }
  const ownedEvent = (eventId: string) => {
    const source = events.get(eventId) ?? fail('That event is unavailable. Ask for a fresh plan.')
    if (source.itemId && deletedItems.has(source.itemId) && source.status !== 'COMPLETED') fail('Deleting a work item already deletes its unfinished calendar blocks. Remove overlapping event changes.')
    return source
  }
  const claim = (key: string) => {
    if (targets.has(key)) fail('A proposal cannot change the same class, work item, or event more than once.')
    targets.add(key)
  }
  const claimRef = (value: string) => {
    if (refs.has(value) || subjects.has(value) || items.has(value)) fail('New class and task references must be unique.')
    refs.add(value)
  }
  const eventTimeFormat = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  })
  const eventTime = (value: string) => eventTimeFormat.format(new Date(value))
  const details = (labels: Record<string, string>, after: object, before?: object) => Object.entries(labels).flatMap(([key, label]) => {
    const previous = before ? (before as Record<string, unknown>)[key] : null
    const next = (after as Record<string, unknown>)[key]
    if (before ? previous === next : next === null) return []
    const display = (value: unknown) => (key === 'startsAt' || key === 'endsAt') && typeof value === 'string' ? eventTime(value) : key === 'subjectId' && typeof value === 'string' ? subjects.get(value)?.name ?? value : key === 'itemId' && typeof value === 'string' ? items.get(value)?.title ?? value : pretty(value)
    return [{ label, before: display(previous), after: display(next) }]
  })

  for (const operation of operations) {
    let title = ''
    let review: AssistantOperationPreview['details'] = []
    const destructive = operation.kind.endsWith('.delete')
    switch (operation.kind) {
      case 'subject.create': {
        claimRef(operation.ref)
        if ([...subjects.values()].some((row) => row.name.toLocaleLowerCase() === operation.name.toLocaleLowerCase())) fail('You already have a class with that name. Use it or choose a different name.')
        title = `Create class: ${operation.name}`
        review = details(subjectLabels, operation)
        subjects.set(operation.ref, { ...operation, id: operation.ref, archivedAt: null, updatedAt: now.toISOString() })
        break
      }
      case 'subject.update': {
        claim(`subject:${operation.subjectId}`)
        const source = subjects.get(operation.subjectId) ?? fail('That class is unavailable. Ask for a fresh plan.')
        if (deletedSubjects.has(source.id)) fail('A class being deleted cannot also be changed.')
        if ([...subjects.values()].some((row) => row.id !== source.id && row.name.toLocaleLowerCase() === operation.name.toLocaleLowerCase())) fail('You already have a class with that name.')
        title = `Update class: ${source.name}`
        review = details(subjectLabels, operation, source)
        subjects.set(source.id, { ...source, ...operation })
        break
      }
      case 'subject.archive': {
        claim(`subject:${operation.subjectId}`)
        const source = subjects.get(operation.subjectId) ?? fail('That class is unavailable. Ask for a fresh plan.')
        if (deletedSubjects.has(source.id)) fail('A class being deleted cannot also be archived.')
        if ((source.archivedAt !== null) === operation.archived) fail('This class already has the requested archive status.')
        title = `${operation.archived ? 'Archive' : 'Restore'} class: ${source.name}`
        review = [{ label: 'Archived', before: pretty(source.archivedAt !== null), after: pretty(operation.archived) }]
        subjects.set(source.id, { ...source, archivedAt: operation.archived ? now.toISOString() : null })
        break
      }
      case 'subject.delete': {
        claim(`subject:${operation.subjectId}`)
        const source = subjects.get(operation.subjectId) ?? fail('That class is unavailable. Ask for a fresh plan.')
        title = `Delete class: ${source.name}`
        review = [{ label: 'Class', before: source.name, after: null }, { label: 'Related work', before: 'Tasks, assignments, projects and exams in this class', after: 'Permanently deleted; calendar events remain and lose these links' }]
        break
      }
      case 'item.create': {
        claimRef(operation.ref)
        const subject = ownedSubject(operation.subjectId)
        title = `Create ${operation.type.toLowerCase()}: ${operation.title}`
        review = details(itemLabels, operation)
        items.set(operation.ref, { ...operation, id: operation.ref, subjectId: subject.id, updatedAt: now.toISOString() })
        break
      }
      case 'item.update': {
        claim(`item:${operation.itemId}`)
        const source = ownedItem(operation.itemId)
        ownedSubject(operation.subjectId)
        // Moving a linked task would leave its existing event.subjectId stale.
        if (source.subjectId !== operation.subjectId && context.events.some((row) => row.itemId === source.id)) fail('A task with calendar blocks cannot change classes through the assistant. Update its class in FlowState first.')
        title = `Update ${source.type.toLowerCase()}: ${source.title}`
        review = details(itemLabels, operation, source)
        items.set(source.id, { ...source, ...operation })
        break
      }
      case 'item.complete': {
        claim(`item:${operation.itemId}`)
        const source = ownedItem(operation.itemId)
        if (source.status === operation.status) fail('That work item already has the requested status.')
        title = `${operation.status === 'DONE' ? 'Complete' : 'Reopen'} ${source.type.toLowerCase()}: ${source.title}`
        review = [{ label: 'Status', before: source.status, after: operation.status }]
        items.set(source.id, { ...source, status: operation.status })
        break
      }
      case 'item.delete': {
        claim(`item:${operation.itemId}`)
        const source = items.get(operation.itemId) ?? fail('That work item is unavailable. Ask for a fresh plan.')
        if (deletedSubjects.has(source.subjectId)) fail('Deleting a class already deletes its work items. Remove the redundant task deletion.')
        title = `Delete ${source.type.toLowerCase()}: ${source.title}`
        review = [{ label: 'Work item', before: source.title, after: null }, { label: 'Calendar blocks', before: 'Linked unfinished blocks', after: 'Deleted; completed blocks remain without the work item link' }]
        break
      }
      case 'event.create':
      case 'event.update': {
        const source = operation.kind === 'event.update' ? ownedEvent(operation.eventId) : undefined
        if (source) {
          claim(`event:${source.id}`)
          if (source.recurrenceRule !== null) fail('Recurring series cannot be edited by the assistant. Use individually dated events.')
        }
        if (operation.subjectId !== null) ownedSubject(operation.subjectId)
        if (operation.itemId !== null) {
          const item = ownedItem(operation.itemId)
          if (item.subjectId !== operation.subjectId) fail('The calendar event and work item must belong to the same class.')
        }
        const timeChanged = !source || source.startsAt !== operation.startsAt || source.endsAt !== operation.endsAt || source.isAllDay !== operation.isAllDay
        if (timeChanged) {
          validateEventTimes(operation, window, now, timeZone)
          if (source && source.status !== 'SCHEDULED') fail('Only scheduled events can be moved or resized. Change the status first in FlowState.')
          touchesTimeline = true
        }
        title = `${source ? 'Update' : 'Create'} event: ${source?.title ?? operation.title}`
        review = details(eventLabels, operation, source)
        break
      }
      case 'event.status': {
        const source = ownedEvent(operation.eventId)
        claim(`event:${source.id}`)
        if (source.recurrenceRule !== null) fail('Change recurring event status in FlowState directly; individual occurrences are not expanded.')
        if (source.status === operation.status) fail('That event already has the requested status.')
        if (operation.status === 'SCHEDULED') { validateEventTimes(source, window, now, timeZone); touchesTimeline = true }
        title = `Update event status: ${source.title}`
        review = [{ label: 'Status', before: source.status, after: operation.status }]
        break
      }
      case 'event.delete': {
        const source = ownedEvent(operation.eventId)
        claim(`event:${source.id}`)
        if (source.recurrenceRule !== null) fail('Delete recurring series directly in FlowState; individual occurrences are not expanded.')
        title = `Delete event: ${source.title}`
        review = [{ label: 'Event', before: source.title, after: null }, { label: 'Starts', before: eventTime(source.startsAt), after: null }, { label: 'Ends', before: eventTime(source.endsAt), after: null }]
        break
      }
    }
    if (review.length === 0) fail('The proposed update does not change any fields.')
    previews.push({ kind: operation.kind, title, details: review, reason: operation.reason, destructive })
  }
  return { operations, previews, touchesTimeline }
}

function validateEventTimes(event: { startsAt: string; endsAt: string; isAllDay: boolean }, window: PlanningWindow, now: Date, timeZone: string) {
  const start = Date.parse(event.startsAt)
  const end = Date.parse(event.endsAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end > window.end.getTime()) fail('New or changed calendar times must be in the future and inside the next 14 days.')
  let lowerBound = Math.max(now.getTime(), window.start.getTime())
  if (event.isAllDay) {
    const format = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    })
    const localParts = (value: number) => Object.fromEntries(format.formatToParts(new Date(value)).map((part) => [part.type, part.value]))
    const midnight = (value: number) => {
      const parts = localParts(value)
      return parts.hour === '00' && parts.minute === '00' && parts.second === '00' && value % 1000 === 0
    }
    if (!midnight(start) || !midnight(end)) fail('All-day event boundaries must use midnight in your time zone and an exclusive end date.')
    // Today's all-day commitments are valid while still in progress. Day
    // boundaries follow the user's timezone, including 23/25-hour DST days.
    const today = localParts(lowerBound)
    lowerBound = wallTimeToInstant(`${today.year}-${today.month}-${today.day}`, '00:00', timeZone).getTime()
  }
  if (start < lowerBound || end <= now.getTime()) fail('New or changed calendar times must be in the future and inside the next 14 days.')
}

/** Changes and CRUD share one final timeline, allowing removals to free a slot. */
export function validateCombinedTimeline(
  changes: AssistantChange[], operations: AssistantOperation[], events: EventSnapshot[], googleEvents: BusyInterval[], window: PlanningWindow, now = new Date(), timeZone = 'UTC',
) {
  if (changes.length + operations.length > MAX_MOVES) fail('This plan contains too many changes. Use at most 12 changes at a time.')
  const final = new Map(events.map((event) => [event.id, { ...event }]))
  const affected = new Set<string>()
  const operationTargets = new Set<string>()
  for (const operation of operations) {
    if (operation.kind.startsWith('event.') && 'eventId' in operation) operationTargets.add(operation.eventId)
  }
  for (const change of changes) {
    if (operationTargets.has(change.eventId)) fail('An event cannot appear in both moves and other event changes.')
    const source = final.get(change.eventId) ?? fail('The moved event is unavailable.')
    final.set(source.id, { ...source, startsAt: change.toStart, endsAt: change.toEnd })
    affected.add(source.id)
  }
  for (const [index, operation] of operations.entries()) {
    if (operation.kind === 'event.create') {
      const id = `created:${index}`
      validateEventTimes(operation, window, now, timeZone)
      final.set(id, { ...operation, id, status: 'SCHEDULED', recurrenceRule: null, updatedAt: now.toISOString() })
      affected.add(id)
    } else if (operation.kind === 'event.update') {
      const source = final.get(operation.eventId) ?? fail('The edited event is unavailable.')
      final.set(source.id, { ...source, ...operation })
      if (source.startsAt !== operation.startsAt || source.endsAt !== operation.endsAt || source.isAllDay !== operation.isAllDay) affected.add(source.id)
    } else if (operation.kind === 'event.status') {
      const source = final.get(operation.eventId) ?? fail('The edited event is unavailable.')
      final.set(source.id, { ...source, status: operation.status })
      if (operation.status === 'SCHEDULED') affected.add(source.id)
    } else if (operation.kind === 'event.delete') {
      final.delete(operation.eventId)
    } else if (operation.kind === 'item.delete') {
      // Full snapshots include linked rows; legacy move snapshots lack itemId.
      for (const [id, event] of final) {
        if ('itemId' in event && event.itemId === operation.itemId && event.status !== 'COMPLETED') final.delete(id)
      }
    }
  }
  const scheduled = [...final.values()].filter((event) => event.status === 'SCHEDULED')
  const overlaps = (a: { startsAt: string; endsAt: string }, b: { startsAt: string; endsAt: string }) => Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(a.endsAt) > Date.parse(b.startsAt)
  for (const event of scheduled) {
    if (!affected.has(event.id)) continue
    if (scheduled.some((other) => event.id !== other.id && overlaps(event, other))) fail('The proposed timeline overlaps another FlowState event. Ask for a new plan.')
    if (googleEvents.some((other) => overlaps(event, other))) fail('The proposed timeline overlaps Google Calendar. Ask for a new plan.')
  }
}
