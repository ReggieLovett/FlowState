import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  modelPlanSchema,
  resolvedDecision,
  validateMoves,
  validateSnapshots,
  type EventSnapshot,
} from './validation'

const window = { start: new Date('2026-10-26T00:00:00Z'), end: new Date('2026-11-09T00:00:00Z') }
const now = window.start
const event = (id: string, hour: number, patch: Partial<EventSnapshot> = {}): EventSnapshot => ({
  id,
  title: `Block ${id}`,
  startsAt: `2026-10-27T${String(hour).padStart(2, '0')}:00:00.000Z`,
  endsAt: `2026-10-27T${String(hour + 1).padStart(2, '0')}:00:00.000Z`,
  updatedAt: '2026-10-25T00:00:00.000Z',
  status: 'SCHEDULED',
  isAllDay: false,
  recurrenceRule: null,
  ...patch,
})
const move = (eventId: string, hour: number) => ({
  eventId,
  toStart: `2026-10-27T${String(hour).padStart(2, '0')}:00:00.000Z`,
  toEnd: `2026-10-27T${String(hour + 1).padStart(2, '0')}:00:00.000Z`,
  reason: 'Protect a focus block.',
})

test('allows swapping two occupied slots by checking final positions', () => {
  const changes = validateMoves([move('a', 11), move('b', 9)], [event('a', 9), event('b', 11)], [], window, now)
  assert.equal(changes.length, 2)
  assert.equal(changes[0].fromStart, event('a', 9).startsAt)
})

test('rejects unknown owner ids, repeated ids and immovable event types', () => {
  assert.throws(() => validateMoves([move('stranger', 12)], [event('a', 9)], [], window, now), /unavailable/)
  assert.throws(() => validateMoves([move('a', 12), move('a', 14)], [event('a', 9)], [], window, now), /repeated/)
  for (const patch of [{ isAllDay: true }, { recurrenceRule: 'FREQ=DAILY' }, { status: 'COMPLETED' as const }]) {
    assert.throws(() => validateMoves([move('a', 12)], [event('a', 9, patch)], [], window, now), /Only scheduled/)
  }
})

test('blocks collisions with local, moved, all-day and Google events', () => {
  assert.throws(() => validateMoves([move('a', 11)], [event('a', 9), event('b', 11)], [], window, now), /FlowState/)
  assert.throws(() => validateMoves([move('a', 11), move('b', 11)], [event('a', 9), event('b', 13)], [], window, now), /FlowState/)
  const allDay = event('deadline', 0, { isAllDay: true, endsAt: '2026-10-28T00:00:00.000Z' })
  assert.throws(() => validateMoves([move('a', 11)], [event('a', 9), allDay], [], window, now), /FlowState/)
  assert.throws(() => validateMoves([move('a', 11)], [event('a', 9)], [event('google', 11)], window, now), /Google/)
})

test('allows touching boundaries and ignores cancelled busy blocks', () => {
  assert.equal(validateMoves([move('a', 10)], [event('a', 8), event('b', 9), event('c', 10, { status: 'CANCELLED' })], [], window, now).length, 1)
})

test('rejects duration changes, no-ops and times outside the fixed future horizon', () => {
  assert.throws(() => validateMoves([{ ...move('a', 12), toEnd: '2026-10-27T14:00:00Z' }], [event('a', 9)], [], window, now), /duration/)
  assert.throws(() => validateMoves([move('a', 9)], [event('a', 9)], [], window, now), /not changed/)
  assert.throws(() => validateMoves([{ ...move('a', 12), toStart: '2026-11-10T12:00:00Z', toEnd: '2026-11-10T13:00:00Z' }], [event('a', 9)], [], window, now), /next 14/)
  assert.throws(() => validateMoves([move('a', 12)], [event('a', 9)], [], window, new Date('2026-10-28T00:00:00Z')), /original event/)
})

test('detects modified, deleted and completed approval snapshots', () => {
  const original = event('a', 9)
  assert.doesNotThrow(() => validateSnapshots([original], [{ ...original }]))
  assert.throws(() => validateSnapshots([original], []), /schedule changed/)
  for (const patch of [{ updatedAt: '2026-10-26T00:00:00.000Z' }, { status: 'COMPLETED' as const }, { title: 'Renamed' }]) {
    assert.throws(() => validateSnapshots([original], [{ ...original, ...patch }]), /schedule changed/)
  }
})

test('model payload validation requires ISO offsets, exact fields and a bounded plan', () => {
  assert.equal(modelPlanSchema.safeParse({ message: 'A plan.', changes: [move('a', 12)] }).success, true)
  assert.equal(modelPlanSchema.safeParse({ message: 'A plan.', changes: [{ ...move('a', 12), toStart: 'tomorrow' }] }).success, false)
  assert.equal(modelPlanSchema.safeParse({ message: 'A plan.', changes: [move('a', 12)], userId: 'other' }).success, false)
  assert.equal(modelPlanSchema.safeParse({ message: 'A plan.', changes: Array.from({ length: 13 }, (_, i) => move(String(i), 12)) }).success, false)
})

test('confirmation expires at its exact deadline, while expired plans can still be cancelled', () => {
  const expiry = new Date('2026-10-26T00:10:00Z')
  assert.equal(resolvedDecision('PENDING', 'confirm', expiry, new Date('2026-10-26T00:09:59Z')), null)
  assert.throws(() => resolvedDecision('PENDING', 'confirm', expiry, expiry), /expired/)
  assert.equal(resolvedDecision('PENDING', 'cancel', expiry, expiry), null)
})

test('repeated decisions are idempotent and cannot reverse an applied or cancelled plan', () => {
  const expired = new Date('2026-10-25T00:00:00Z')
  assert.equal(resolvedDecision('APPLIED', 'confirm', expired, now), 'APPLIED')
  assert.equal(resolvedDecision('CANCELLED', 'cancel', expired, now), 'CANCELLED')
  assert.throws(() => resolvedDecision('APPLIED', 'cancel', expired, now), /already been applied/)
  assert.throws(() => resolvedDecision('CANCELLED', 'confirm', expired, now), /was cancelled/)
})
