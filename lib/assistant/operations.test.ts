import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  assistantOperationSchema, validateOperations, validateCombinedTimeline,
  type AssistantOperation, type FullEventSnapshot, type OperationContext, type SubjectSnapshot,
} from './operations'
import { modelPlanSchema, validateMoves } from './validation'
import { operationResponseSchema } from './groq'

const now = new Date('2026-10-26T00:00:00.000Z')
const window = { start: now, end: new Date('2026-11-09T00:00:00.000Z') }
const subject: SubjectSnapshot = {
  id: 'math', name: 'Math', category: 'LECTURE', code: null, colorHex: '#4C6EF5', notes: null,
  difficulty: 5, examDate: null, archivedAt: null, updatedAt: now.toISOString(),
}
const context = (patch: Partial<OperationContext> = {}): OperationContext => ({ subjects: [subject], items: [], events: [], ...patch })
const createSubject = (patch: Partial<Extract<AssistantOperation, { kind: 'subject.create' }>> = {}): Extract<AssistantOperation, { kind: 'subject.create' }> => ({
  kind: 'subject.create', ref: 'new:physics', name: 'Physics', category: 'LECTURE', code: null, colorHex: '#4C6EF5',
  notes: null, difficulty: 5, examDate: null, reason: 'Add the requested class.', ...patch,
})
const createItem = (patch: Partial<Extract<AssistantOperation, { kind: 'item.create' }>> = {}): Extract<AssistantOperation, { kind: 'item.create' }> => ({
  kind: 'item.create', ref: 'new:homework', subjectId: 'math', title: 'Problem set', type: 'ASSIGNMENT', status: 'TODO',
  dueDate: '2026-10-30', estimatedMinutes: 60, priority: 2, notes: null, reason: 'Track the requested assignment.', ...patch,
})
const createEvent = (patch: Partial<Extract<AssistantOperation, { kind: 'event.create' }>> = {}): Extract<AssistantOperation, { kind: 'event.create' }> => ({
  kind: 'event.create', subjectId: 'math', itemId: null, title: 'Math class', category: 'LECTURE',
  startsAt: '2026-10-27T09:00:00.000Z', endsAt: '2026-10-27T10:00:00.000Z', isAllDay: false,
  location: null, notes: null, reason: 'Add the specified lesson.', ...patch,
})
const event = (id = 'lesson', patch: Partial<FullEventSnapshot> = {}): FullEventSnapshot => ({
  id, subjectId: 'math', itemId: null, title: 'Math class', category: 'LECTURE',
  startsAt: '2026-10-27T09:00:00.000Z', endsAt: '2026-10-27T10:00:00.000Z', isAllDay: false,
  location: null, notes: null, status: 'SCHEDULED', recurrenceRule: null, generatedAt: null, planReason: null,
  updatedAt: now.toISOString(), ...patch,
})

test('a class, assignment and linked lesson can be proposed together without writing', () => {
  const operations = [createSubject(), createItem({ subjectId: 'new:physics' }), createEvent({ subjectId: 'new:physics', itemId: 'new:homework' })]
  const original = context()
  const result = validateOperations(operations, original, window, now)
  assert.equal(result.operations.length, 3)
  assert.equal(result.previews[0].title, 'Create class: Physics')
  assert.equal(result.previews[2].details.find((detail) => detail.label === 'Class')?.after, 'Physics')
  assert.equal(result.touchesTimeline, true)
  assert.equal(original.subjects.length, 1)
  assert.equal(original.items.length, 0)
  assert.doesNotThrow(() => validateCombinedTimeline([], operations, [], [], window, now))
})

test('strict whitelist refuses owner ids, recurrence rules, invalid dates and unbounded text', () => {
  for (const invalid of [
    { ...createSubject(), userId: 'stranger' },
    { ...createSubject(), examDate: '2026-02-31' },
    { ...createSubject(), name: 'x'.repeat(121) },
    { ...createEvent(), recurrenceRule: 'FREQ=DAILY' },
    { ...createEvent(), startsAt: 'tomorrow' },
    { ...createItem(), estimatedMinutes: 12_001 },
  ]) assert.equal(assistantOperationSchema.safeParse(invalid).success, false)
  assert.equal(modelPlanSchema.parse({ message: 'Which time should the class start?', changes: [] }).operations.length, 0)
})

test('references must be owned, unique, in creator order and correctly linked', () => {
  assert.throws(() => validateOperations([createItem({ subjectId: 'stranger' })], context(), window, now), /unavailable/)
  assert.throws(() => validateOperations([createItem({ subjectId: 'new:physics' }), createSubject()], context(), window, now), /unavailable/)
  assert.throws(() => validateOperations([createSubject(), createItem({ ref: 'new:physics' })], context(), window, now), /unique/)
  assert.throws(() => validateOperations([createItem(), createEvent({ subjectId: null, itemId: 'new:homework' })], context(), window, now), /same class/)
  assert.throws(() => validateOperations([createSubject({ name: 'MATH' })], context(), window, now), /already have/)
  assert.throws(() => validateOperations([createItem()], context({ subjects: [{ ...subject, archivedAt: now.toISOString() }] }), window, now), /archived/)
})

test('metadata and deletion have no timeline dependency, while exact changed fields are reviewable', () => {
  const update: AssistantOperation = { ...createSubject(), kind: 'subject.update', subjectId: 'math', name: 'Advanced Math', notes: 'Bring a calculator' }
  // Build the strict update without a create-only ref.
  const { ref: _ref, ...fields } = update as typeof update & { ref: string }
  void _ref
  const result = validateOperations([fields], context(), window, now)
  assert.equal(result.touchesTimeline, false)
  assert.deepEqual(result.previews[0].details.find((detail) => detail.label === 'Notes'), { label: 'Notes', before: null, after: 'Bring a calculator' })
  const deletion = validateOperations([{ kind: 'subject.delete', subjectId: 'math', reason: 'Remove this class.' }], context(), window, now)
  assert.equal(deletion.touchesTimeline, false)
  assert.equal(deletion.previews[0].destructive, true)
  assert.match(deletion.previews[0].details[1].after!, /Permanently deleted/)
  assert.equal(validateOperations([createSubject()], context(), window, now).previews[0].details.some((detail) => detail.label === 'Notes'), false)
})

test('new or resized event times must be valid, future and bounded; recurring edits fail closed', () => {
  assert.throws(() => validateOperations([createEvent({ endsAt: '2026-10-27T08:00:00Z' })], context(), window, now), /future/)
  assert.throws(() => validateOperations([createEvent({ startsAt: '2026-10-25T09:00:00Z' })], context(), window, now), /future/)
  assert.throws(() => validateOperations([createEvent({ endsAt: '2026-11-10T09:00:00Z' })], context(), window, now), /14 days/)
  const { kind: _kind, ...data } = createEvent({ title: 'Renamed' })
  void _kind
  assert.throws(() => validateOperations([{ kind: 'event.update', eventId: 'lesson', ...data }], context({ events: [event('lesson', { recurrenceRule: 'FREQ=WEEKLY' })] }), window, now), /Recurring/)
  assert.throws(() => validateOperations([createEvent({ isAllDay: true })], context(), window, now), /midnight/)
})

test('one record cannot be mutated twice, including child changes hidden by a parent deletion', () => {
  assert.throws(() => validateOperations([
    { kind: 'subject.archive', subjectId: 'math', archived: true, reason: 'Hide it.' },
    { kind: 'subject.archive', subjectId: 'math', archived: false, reason: 'Restore it.' },
  ], context(), window, now), /more than once/)
  assert.throws(() => validateOperations([
    { kind: 'subject.delete', subjectId: 'math', reason: 'Delete it.' }, createItem(),
  ], context(), window, now), /unavailable/)
})

test('moves, creates, edits and removals share the final collision check', () => {
  const source = event()
  const move = { eventId: source.id, toStart: '2026-10-27T11:00:00.000Z', toEnd: '2026-10-27T12:00:00.000Z', reason: 'Make room.' }
  const changes = validateMoves([move], [source], [], window, now, false)
  assert.doesNotThrow(() => validateCombinedTimeline(changes, [createEvent()], [source], [], window, now))
  assert.throws(() => validateCombinedTimeline([], [createEvent()], [source], [], window, now), /FlowState/)
  assert.doesNotThrow(() => validateCombinedTimeline([], [{ kind: 'event.delete', eventId: source.id, reason: 'Replace it.' }, createEvent()], [source], [], window, now))
  assert.throws(() => validateCombinedTimeline([], [createEvent()], [], [source], window, now), /Google/)
  assert.throws(() => validateCombinedTimeline(changes, [{ kind: 'event.delete', eventId: source.id, reason: 'Delete it.' }], [source], [], window, now), /both moves/)
})

test('one total bound applies to mixed changes and operation payloads', () => {
  const moves = Array.from({ length: 12 }, (_, index) => ({ eventId: `lesson-${index}`, toStart: '2026-10-27T11:00:00Z', toEnd: '2026-10-27T12:00:00Z', reason: 'Focus.' }))
  assert.equal(modelPlanSchema.safeParse({ message: 'Too many.', changes: moves, operations: [createSubject()] }).success, false)
})

test('all-day boundaries follow Manila local midnight, including an ongoing day', () => {
  const lesson = createEvent({ isAllDay: true, startsAt: '2026-10-27T00:00:00+08:00', endsAt: '2026-10-28T00:00:00+08:00' })
  const review = validateOperations([lesson], context(), window, now, 'Asia/Manila')
  const starts = review.previews[0].details.find((detail) => detail.label === 'Starts')?.after
  assert.match(starts!, /Oct 27, 2026/)
  assert.match(starts!, /12:00 AM/)
  assert.match(starts!, /GMT\+8/)
  const deletion = validateOperations([{ kind: 'event.delete', eventId: 'lesson', reason: 'Remove it.' }], context({ events: [event('lesson', { startsAt: lesson.startsAt, endsAt: lesson.endsAt, isAllDay: true })] }), window, now, 'Asia/Manila')
  assert.equal(deletion.previews[0].details.find((detail) => detail.label === 'Starts')?.before, starts)
  assert.doesNotThrow(() => validateCombinedTimeline([], [lesson], [], [], window, now, 'Asia/Manila'))
  assert.throws(() => validateOperations([{ ...lesson, startsAt: '2026-10-27T00:00:00Z', endsAt: '2026-10-28T00:00:00Z' }], context(), window, now, 'Asia/Manila'), /midnight in your time zone/)
  assert.doesNotThrow(() => validateOperations([{ ...lesson, startsAt: '2026-10-26T00:00:00+08:00', endsAt: '2026-10-27T00:00:00+08:00' }], context(), window, now, 'Asia/Manila'))
})

test('all-day New York DST events allow 23-hour and 25-hour days', () => {
  const fall = createEvent({ isAllDay: true, startsAt: '2026-11-01T00:00:00-04:00', endsAt: '2026-11-02T00:00:00-05:00' })
  assert.doesNotThrow(() => validateOperations([fall], context(), window, now, 'America/New_York'))
  const springNow = new Date('2026-03-01T00:00:00Z')
  const springWindow = { start: springNow, end: new Date('2026-03-15T00:00:00Z') }
  const spring = createEvent({ isAllDay: true, startsAt: '2026-03-08T00:00:00-05:00', endsAt: '2026-03-09T00:00:00-04:00' })
  assert.doesNotThrow(() => validateOperations([spring], context(), springWindow, springNow, 'America/New_York'))
})

test('Groq nested union schema closes every object and requires all declared properties', () => {
  function walk(value: unknown) {
    if (Array.isArray(value)) { value.forEach(walk); return }
    if (!value || typeof value !== 'object') return
    const schema = value as Record<string, unknown>
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false)
      assert.deepEqual(new Set(schema.required as string[]), new Set(Object.keys(schema.properties as object)))
    }
    assert.equal('oneOf' in schema, false)
    Object.values(schema).forEach(walk)
  }
  walk(operationResponseSchema)
})
