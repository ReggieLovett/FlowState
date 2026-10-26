import { z } from 'zod'
import type { AssistantChange } from './contracts'

import { assistantOperationSchema } from './operations'
import { MAX_MOVES, PlanValidationError, eventSnapshotSchema, type EventSnapshot, type BusyInterval, type PlanningWindow } from './primitives'
export * from './primitives'

const instant = z.iso.datetime({ offset: true })
const eventId = z.string().min(1).max(191)

export const modelPlanSchema = z.strictObject({
  message: z.string().trim().min(1).max(1600),
  changes: z.array(z.strictObject({
    eventId,
    toStart: instant,
    toEnd: instant,
    reason: z.string().trim().min(1).max(280),
  })).max(MAX_MOVES),
  // Old pending move-only proposals and provider mocks remain readable.
  operations: z.array(assistantOperationSchema).max(MAX_MOVES).default([]),
}).superRefine((plan, ctx) => {
  if (plan.changes.length + plan.operations.length > MAX_MOVES) ctx.addIssue({ code: 'custom', message: 'A plan supports at most 12 total changes.' })
})

export type ModelPlan = z.infer<typeof modelPlanSchema>

export const storedChangesSchema = z.array(z.strictObject({
  eventId,
  title: z.string(),
  fromStart: instant,
  fromEnd: instant,
  toStart: instant,
  toEnd: instant,
  reason: z.string().trim().min(1).max(280),
})).min(1).max(MAX_MOVES)

export const storedSnapshotSchema = z.strictObject({
  version: z.literal(1),
  calendarConnected: z.boolean(),
  events: z.array(eventSnapshotSchema).min(1).max(MAX_MOVES),
})

/** Derive the original times and title from trusted rows, never model output. */
export function validateMoves(
  candidates: ModelPlan['changes'],
  events: EventSnapshot[],
  googleEvents: BusyInterval[],
  window: PlanningWindow,
  now = new Date(),
  checkTimeline = true,
): AssistantChange[] {
  if (candidates.length > MAX_MOVES) throw new PlanValidationError('This plan moves too many events.')

  const owned = new Map(events.map((event) => [event.id, event]))
  const seen = new Set<string>()
  const changes = candidates.map((candidate): AssistantChange => {
    const source = owned.get(candidate.eventId)
    if (!source || seen.has(candidate.eventId)) {
      throw new PlanValidationError('The plan contains an unavailable or repeated event. Ask for a new plan.')
    }
    seen.add(candidate.eventId)

    const originalStart = Date.parse(source.startsAt)
    const originalEnd = Date.parse(source.endsAt)
    const nextStart = Date.parse(candidate.toStart)
    const nextEnd = Date.parse(candidate.toEnd)
    const lowerBound = Math.max(window.start.getTime(), now.getTime())

    if (source.status !== 'SCHEDULED' || source.isAllDay || source.recurrenceRule !== null) {
      throw new PlanValidationError('Only scheduled, timed, nonrecurring events can be moved.')
    }
    if (![originalStart, originalEnd, nextStart, nextEnd].every(Number.isFinite)) {
      throw new PlanValidationError('The plan contains an invalid date.')
    }
    if (originalStart < window.start.getTime() || originalEnd > window.end.getTime() || originalStart < now.getTime()) {
      throw new PlanValidationError('The original event is outside the available future planning window.')
    }
    if (nextStart < lowerBound || nextEnd > window.end.getTime() || nextEnd <= nextStart) {
      throw new PlanValidationError('Proposed times must stay in the next 14 days and in the future.')
    }
    if (originalEnd <= originalStart || nextEnd - nextStart !== originalEnd - originalStart) {
      throw new PlanValidationError('Moving an event must preserve its duration.')
    }
    if (nextStart === originalStart && nextEnd === originalEnd) {
      throw new PlanValidationError('The plan includes an event whose time has not changed.')
    }

    return {
      eventId: source.id,
      title: source.title,
      fromStart: source.startsAt,
      fromEnd: source.endsAt,
      toStart: new Date(nextStart).toISOString(),
      toEnd: new Date(nextEnd).toISOString(),
      reason: candidate.reason,
    }
  })

  if (checkTimeline) validateFinalTimeline(changes, events, googleEvents)
  return changes
}

/** Half-open intervals permit an event to begin exactly when another ends. */
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return Date.parse(aStart) < Date.parse(bEnd) && Date.parse(aEnd) > Date.parse(bStart)
}

/** Check the entire resulting timeline, so moving two events can safely swap slots. */
export function validateFinalTimeline(
  changes: AssistantChange[],
  events: EventSnapshot[],
  googleEvents: BusyInterval[],
) {
  const moved = new Map(changes.map((change) => [change.eventId, change]))
  const finalEvents = events.filter((event) => event.status === 'SCHEDULED').map((event) => {
    const change = moved.get(event.id)
    return {
      id: event.id,
      startsAt: change?.toStart ?? event.startsAt,
      endsAt: change?.toEnd ?? event.endsAt,
    }
  })

  for (const change of changes) {
    if (finalEvents.some((event) => event.id !== change.eventId && overlaps(change.toStart, change.toEnd, event.startsAt, event.endsAt))) {
      throw new PlanValidationError('The proposed timeline overlaps another FlowState event. Ask for a new plan.')
    }
    if (googleEvents.some((event) => overlaps(change.toStart, change.toEnd, event.startsAt, event.endsAt))) {
      throw new PlanValidationError('The proposed timeline overlaps Google Calendar. Ask for a new plan.')
    }
  }
}

/** A changed, deleted or transferred event invalidates the approval snapshot. */
export function validateSnapshots(before: EventSnapshot[], current: EventSnapshot[]) {
  const currentById = new Map(current.map((event) => [event.id, event]))
  for (const snapshot of before) {
    const event = currentById.get(snapshot.id)
    if (!event || (Object.keys(snapshot) as Array<keyof EventSnapshot>).some((key) => snapshot[key] !== event[key])) {
      throw new PlanValidationError('Your schedule changed after this proposal. Ask for a fresh plan before confirming.')
    }
  }
}

/** Retries are idempotent, but changing an already resolved decision is refused. */
export function resolvedDecision(
  status: 'PENDING' | 'APPLIED' | 'CANCELLED',
  action: 'confirm' | 'cancel',
  expiresAt: Date,
  now = new Date(),
): 'APPLIED' | 'CANCELLED' | null {
  if (status === 'APPLIED') {
    if (action === 'confirm') return 'APPLIED'
    throw new PlanValidationError('This plan has already been applied and cannot be cancelled.')
  }
  if (status === 'CANCELLED') {
    if (action === 'cancel') return 'CANCELLED'
    throw new PlanValidationError('This plan was cancelled. Ask for a new plan.')
  }
  if (action === 'confirm' && expiresAt.getTime() <= now.getTime()) {
    throw new PlanValidationError('This proposal expired. Cancel it and ask for a fresh plan.')
  }
  return null
}
