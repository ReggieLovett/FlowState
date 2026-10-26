import { z } from 'zod'

export const MAX_MOVES = 12
export const MAX_LOCAL_EVENTS = 200
export const MAX_ITEMS = 60
export const WINDOW_DAYS = 14
export const PROPOSAL_LIFETIME_MS = 10 * 60_000

const instant = z.iso.datetime({ offset: true })
const eventId = z.string().min(1).max(191)

export const eventSnapshotSchema = z.strictObject({
  id: eventId,
  title: z.string(),
  startsAt: instant,
  endsAt: instant,
  updatedAt: instant,
  status: z.enum(['SCHEDULED', 'COMPLETED', 'CANCELLED']),
  isAllDay: z.boolean(),
  recurrenceRule: z.string().nullable(),
})

export type EventSnapshot = z.infer<typeof eventSnapshotSchema>

export interface BusyInterval {
  id: string
  title: string
  startsAt: string
  endsAt: string
}

export interface PlanningWindow {
  start: Date
  end: Date
}

export class PlanValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlanValidationError'
  }
}

