import assert from 'node:assert/strict'
import { after, beforeEach, test, type TestContext } from 'node:test'
import type { AssistantProposal as StoredProposal } from '@prisma/client'
import { askAssistant, decideProposal } from './service'
import { AssistantError } from './errors'
import { type AssistantOperation } from './operations'

type Row = Record<string, unknown> & { id: string; userId: string; updatedAt: Date }
type Query = { where?: Record<string, unknown>; select?: Record<string, boolean>; take?: number; data?: Record<string, unknown> }
const owner = 'owner-a'
const at = (hours: number) => new Date(Date.now() + hours * 3_600_000)
let subjects: Row[] = []
let items: Row[] = []
let events: Row[] = []
let proposal: StoredProposal | null = null
let writes: string[] = []
let locks: string[] = []
let commits = 0
let rollbacks = 0
let serial = 0
let failEventCreate = false
let googleConnected = false
let googleFailure = false
let googleItems: unknown[] = []
let googleReads = 0
let beforeSubjectLock: (() => void) | null = null

function matches(row: Record<string, unknown>, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return (value as Record<string, unknown>[]).some((clause) => matches(row, clause))
    if (key === 'id_userId') return matches(row, value as Record<string, unknown>)
    if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
      const condition = value as Record<string, unknown>
      if ('in' in condition) return (condition.in as unknown[]).includes(row[key])
      if ('not' in condition) return row[key] !== condition.not
      if ('lt' in condition && !((row[key] as Date) < (condition.lt as Date))) return false
      if ('gt' in condition && !((row[key] as Date) > (condition.gt as Date))) return false
      return true
    }
    return row[key] instanceof Date && value instanceof Date ? row[key].getTime() === value.getTime() : row[key] === value
  })
}
function selected(row: Row, select?: Query['select']) {
  return structuredClone(select ? Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, row[key]])) : row)
}
const findMany = (rows: () => Row[]) => async ({ where, select, take }: Query) => rows().filter((row) => matches(row, where)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, take).map((row) => selected(row, select))
function subject(id = 'class-a', name = 'Calculus', userId = owner): Row {
  return { id, userId, name, category: 'LECTURE', code: null, colorHex: '#4C6EF5', notes: null, difficulty: 5, examDate: null, archivedAt: null, updatedAt: at(-12) }
}
function item(id = 'task-a', subjectId = 'class-a', userId = owner): Row {
  return { id, userId, subjectId, title: `Work ${id}`, type: 'ASSIGNMENT', status: 'TODO', dueDate: null, estimatedMinutes: 60, priority: 2, notes: null, updatedAt: at(-12) }
}
function event(id = 'event-a', hours = 24, itemId: string | null = null, status = 'SCHEDULED'): Row {
  const startsAt = at(hours)
  return { id, userId: owner, subjectId: 'class-a', itemId, title: `Block ${id}`, category: 'LECTURE', startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000), isAllDay: false, location: null, notes: null, status, recurrenceRule: null, generatedAt: null, planReason: 'Original planning reason', updatedAt: at(-12) }
}
const currentProposal = () => { assert.ok(proposal); return proposal }
function update(rows: () => Row[], label: string) {
  return async ({ where, data, select }: Query) => {
    const row = rows().find((entry) => matches(entry, where))
    assert.ok(row, `${label} must include owned existing row`)
    writes.push(label)
    Object.assign(row, data, { updatedAt: new Date() })
    return selected(row, select)
  }
}
const database = {
  account: { findMany: async () => googleConnected ? [{ id: 'account-a', userId: owner, access_token: 'calendar-test-token', refresh_token: 'calendar-test-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, scope: 'https://www.googleapis.com/auth/calendar.events.readonly' }] : [] },
  subject: {
    findMany: findMany(() => subjects),
    create: async ({ data, select }: Query) => { writes.push('subject.create'); const row = { ...subject(`saved-class-${++serial}`, String(data?.name)), ...data }; subjects.push(row); return selected(row, select) },
    update: update(() => subjects, 'subject.update'),
    delete: async ({ where }: Query) => {
      const row = subjects.find((entry) => matches(entry, where)); assert.ok(row); writes.push('subject.delete')
      const childIds = items.filter((entry) => entry.subjectId === row.id).map((entry) => entry.id)
      items = items.filter((entry) => entry.subjectId !== row.id)
      for (const entry of events) { if (entry.subjectId === row.id) entry.subjectId = null; if (childIds.includes(String(entry.itemId))) entry.itemId = null }
      subjects = subjects.filter((entry) => entry.id !== row.id)
      return row
    },
  },
  subjectItem: {
    findMany: findMany(() => items),
    create: async ({ data, select }: Query) => { writes.push('item.create'); const row = { ...item(`saved-item-${++serial}`, String(data?.subjectId)), ...data }; items.push(row); return selected(row, select) },
    update: update(() => items, 'item.update'),
    delete: async ({ where }: Query) => {
      const row = items.find((entry) => matches(entry, where)); assert.ok(row); writes.push('item.delete')
      items = items.filter((entry) => entry.id !== row.id)
      for (const entry of events) if (entry.itemId === row.id) entry.itemId = null
      return row
    },
  },
  scheduleEvent: {
    findMany: findMany(() => events),
    findFirst: async () => null,
    create: async ({ data }: Query) => { writes.push('event.create'); if (failEventCreate) throw new Error('Simulated storage failure'); const row = { ...event(`saved-event-${++serial}`), ...data }; events.push(row); return row },
    update: update(() => events, 'event.update'),
    updateMany: async ({ where, data }: Query) => { const row = events.find((entry) => matches(entry, where)); writes.push('event.move'); if (!row) return { count: 0 }; Object.assign(row, data, { updatedAt: new Date() }); return { count: 1 } },
    delete: async ({ where }: Query) => { const row = events.find((entry) => matches(entry, where)); assert.ok(row); writes.push('event.delete'); events = events.filter((entry) => entry.id !== row.id); return row },
    deleteMany: async ({ where }: Query) => { writes.push('event.deleteMany'); const original = events.length; events = events.filter((entry) => !matches(entry, where)); return { count: original - events.length } },
  },
  assistantProposal: {
    create: async ({ data }: { data: Omit<StoredProposal, 'id' | 'status' | 'appliedAt' | 'createdAt' | 'updatedAt'> }) => {
      proposal = { ...structuredClone(data), id: 'proposal-a', status: 'PENDING', appliedAt: null, createdAt: new Date(), updatedAt: new Date() }
      return { id: proposal.id, expiresAt: proposal.expiresAt }
    },
    findUnique: async ({ where }: { where: { id_userId: { id: string; userId: string } } }) => proposal && matches(proposal, where) ? structuredClone(proposal) : null,
    update: async ({ data }: { data: Partial<StoredProposal> }) => Object.assign(currentProposal(), data),
  },
  $queryRaw: async (query: TemplateStringsArray | { strings: string[]; values: unknown[] }, ...values: unknown[]) => {
    const strings = 'strings' in query ? query.strings : query
    const sql = strings.join('?')
    assert.match(sql, /FOR UPDATE/)
    locks.push(sql)
    if (sql.includes('"AssistantProposal"')) return proposal && values[0] === proposal.id && values[1] === proposal.userId ? [{ id: proposal.id }] : []
    assert.equal('strings' in query ? query.values[0] : values[0], owner)
    if (sql.includes('FROM "Subject"') && beforeSubjectLock) { const callback = beforeSubjectLock; beforeSubjectLock = null; callback() }
    return []
  },
  $transaction: async <T>(callback: (tx: object) => Promise<T>, options: { isolationLevel: string }) => {
    assert.equal(options.isolationLevel, 'Serializable')
    const backup = structuredClone({ subjects, items, events, proposal })
    try { const result = await callback(database); commits++; return result } catch (error) {
      subjects = backup.subjects; items = backup.items; events = backup.events; proposal = backup.proposal; rollbacks++; throw error
    }
  },
}
const globals = globalThis as unknown as { prisma?: unknown }
const originalPrisma = globals.prisma
const originalKey = process.env.GROQ_API_KEY
globals.prisma = database
beforeEach(() => {
  subjects = [subject()]; items = []; events = []; proposal = null; writes = []; locks = []; commits = 0; rollbacks = 0; serial = 0
  failEventCreate = false; googleConnected = false; googleFailure = false; googleItems = []; googleReads = 0; beforeSubjectLock = null
  process.env.GROQ_API_KEY = 'test-only-groq-key'
})
after(() => { globals.prisma = originalPrisma; if (originalKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = originalKey })
function provider(t: TestContext, operations: AssistantOperation[]) {
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    if (String(input).includes('googleapis.com/calendar')) { googleReads++; return googleFailure ? Response.json({}, { status: 503 }) : Response.json({ timeZone: 'Asia/Manila', items: googleItems }) }
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ message: 'Review these changes, then confirm to save.', changes: [], operations }) } }] })
  })
}
const createClass = (): AssistantOperation => ({ kind: 'subject.create', ref: 'new:physics', name: 'Physics', category: 'LECTURE', code: 'PHY101', colorHex: '#4C6EF5', notes: null, difficulty: 6, examDate: null, reason: 'Create the requested class.' })
const createItem = (subjectId = 'new:physics'): AssistantOperation => ({ kind: 'item.create', ref: 'new:homework', subjectId, title: 'Homework 1', type: 'ASSIGNMENT', status: 'TODO', dueDate: null, estimatedMinutes: 90, priority: 3, notes: null, reason: 'Track the requested homework.' })
const createEvent = (subjectId: string | null = 'new:physics', itemId: string | null = 'new:homework', hours = 28): AssistantOperation => {
  const startsAt = at(hours)
  return { kind: 'event.create', subjectId, itemId, title: 'Physics study', category: 'DEEP_WORK_SHIFT', startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(), isAllDay: false, location: null, notes: null, reason: 'Reserve focused study time.' }
}
async function stage() { const response = await askAssistant(owner, 'Create my class and homework.', 'Asia/Manila'); assert.ok(response.proposal); return response.proposal }
const rejects = (status: number, pattern: RegExp) => (error: unknown) => error instanceof AssistantError && error.status === status && pattern.test(error.message)

// PostgreSQL JSONB does not preserve the insertion order of object keys.
function shuffled(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shuffled)
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, shuffled(item)]))
  return value
}

test('class, assignment, and linked event are only staged until one atomic explicit confirmation', async (t) => {
  provider(t, [createClass(), createItem(), createEvent()])
  const staged = await stage()
  assert.equal(staged.operations?.length, 3)
  assert.deepEqual(writes, [])
  assert.equal(subjects.length, 1); assert.equal(items.length, 0); assert.equal(events.length, 0)
  assert.equal((currentProposal().changes as { version: number }).version, 2)
  assert.equal((await decideProposal(owner, staged.id, 'confirm')).status, 'APPLIED')
  assert.deepEqual(writes, ['subject.create', 'item.create', 'event.create'])
  assert.equal(items[0].subjectId, subjects[1].id)
  assert.equal(events[0].subjectId, subjects[1].id)
  assert.equal(events[0].itemId, items[0].id)
  assert.equal(subjects[1].userId, owner)
  assert.ok(!subjects[1].id.startsWith('new:'))
  assert.equal(currentProposal().status, 'APPLIED'); assert.equal(commits, 1)
  assert.equal((await decideProposal(owner, staged.id, 'confirm')).status, 'APPLIED')
  assert.equal(writes.length, 3)
})

test('any failed child write rolls back the class and work item and keeps approval pending', async (t) => {
  provider(t, [createClass(), createItem(), createEvent()]); const staged = await stage(); failEventCreate = true
  await assert.rejects(decideProposal(owner, staged.id, 'confirm'), /Simulated storage failure/)
  assert.equal(subjects.length, 1); assert.equal(items.length, 0); assert.equal(events.length, 0)
  assert.equal(currentProposal().status, 'PENDING'); assert.equal(rollbacks, 1); assert.equal(commits, 0)
})

test('foreign class, work item, and event references cannot stage or mutate another owner', async (t) => {
  subjects.push(subject('foreign-class', 'Foreign', 'other-user')); items.push(item('foreign-task', 'foreign-class', 'other-user'))
  const foreignEvent = event('foreign-event'); foreignEvent.userId = 'other-user'; events.push(foreignEvent)
  for (const operation of [createItem('foreign-class'), { kind: 'item.complete', itemId: 'foreign-task', status: 'DONE', reason: 'Finish it.' }, { kind: 'event.delete', eventId: 'foreign-event', reason: 'Remove it.' }] as AssistantOperation[]) {
    provider(t, [operation]); await assert.rejects(stage(), rejects(422, /unavailable|archived/))
  }
  assert.deepEqual(writes, []); assert.equal(proposal, null)
})

test('duplicate existing and newly appeared class names fail before any domain write', async (t) => {
  const operation = createClass(); provider(t, [operation]); const staged = await stage()
  subjects.push(subject('competing-class', 'Physics'))
  await assert.rejects(decideProposal(owner, staged.id, 'confirm'), rejects(409, /already have a class/))
  assert.deepEqual(writes, [])
  await assert.rejects(stage(), rejects(422, /already have a class/))
})

test('cancel, expiration, and another owner cannot execute staged creations', async (t) => {
  provider(t, [createClass()]); const staged = await stage()
  await assert.rejects(decideProposal('other-user', staged.id, 'confirm'), rejects(404, /not found/))
  currentProposal().expiresAt = at(-1)
  await assert.rejects(decideProposal(owner, staged.id, 'confirm'), rejects(409, /expired/))
  assert.equal((await decideProposal(owner, staged.id, 'cancel')).status, 'CANCELLED')
  assert.equal((await decideProposal(owner, staged.id, 'cancel')).status, 'CANCELLED')
  assert.deepEqual(writes, []); assert.equal(subjects.length, 1)
})

test('JSONB reordered snapshots confirm successfully and metadata edit preserves planning reason', async (t) => {
  const source = event(); events.push(source)
  const operation: AssistantOperation = { kind: 'event.update', eventId: source.id, subjectId: 'class-a', itemId: null, title: 'Renamed lecture', category: 'LECTURE', startsAt: (source.startsAt as Date).toISOString(), endsAt: (source.endsAt as Date).toISOString(), isAllDay: false, location: 'Room 2', notes: null, reason: 'Use the supplied title and room.' }
  provider(t, [operation]); const staged = await stage()
  currentProposal().snapshot = shuffled(currentProposal().snapshot) as StoredProposal['snapshot']
  currentProposal().changes = shuffled(currentProposal().changes) as StoredProposal['changes']
  assert.equal((await decideProposal(owner, staged.id, 'confirm')).status, 'APPLIED')
  assert.equal(events[0].title, 'Renamed lecture'); assert.equal(events[0].planReason, 'Original planning reason')
  assert.match(locks[1], /FROM "Subject"/); assert.match(locks[2], /FROM "ScheduleEvent"/)
})

test('stale source rows and new deletion impacts invalidate confirmation before writes', async (t) => {
  items.push(item()); events.push(event('linked-event', 24, 'task-a'))
  provider(t, [{ kind: 'subject.delete', subjectId: 'class-a', reason: 'Remove the class.' }]); const staged = await stage()
  const details = staged.operations?.[0].details ?? []
  assert.ok(details.some((entry) => entry.label === 'Related work item count' && entry.before === '1'))
  assert.ok(details.some((entry) => entry.label === 'Related calendar event count' && entry.before === '1'))
  // A child inserted before the parent lock is acquired must be discovered by
  // the subsequent impact read. Children after that lock cannot acquire FK locks.
  beforeSubjectLock = () => events.push(event('new-child', 26, 'task-a'))
  await assert.rejects(decideProposal(owner, staged.id, 'confirm'), rejects(409, /changed after this proposal/))
  assert.deepEqual(writes, []); assert.equal(currentProposal().status, 'PENDING')
  assert.match(locks[1], /FROM "Subject"/); assert.match(locks[2], /FROM "SubjectItem"/)
})

test('item deletion removes unfinished blocks and preserves completed detached history', async (t) => {
  items.push(item()); events.push(event('todo-block', 24, 'task-a'), event('done-block', -24, 'task-a', 'COMPLETED'))
  provider(t, [{ kind: 'item.delete', itemId: 'task-a', reason: 'Remove the cancelled assignment.' }]); const staged = await stage()
  const review = staged.operations?.[0].details ?? []
  assert.ok(review.some((entry) => entry.label === 'Unfinished calendar block count' && entry.before === '1'))
  assert.ok(review.some((entry) => entry.label === 'Completed calendar block count' && entry.before === '1'))
  currentProposal().snapshot = shuffled(currentProposal().snapshot) as StoredProposal['snapshot']
  assert.equal((await decideProposal(owner, staged.id, 'confirm')).status, 'APPLIED')
  assert.equal(items.length, 0); assert.equal(events.length, 1); assert.equal(events[0].id, 'done-block'); assert.equal(events[0].itemId, null)
})

test('subject hard delete cascades work and detaches all calendar history', async (t) => {
  items.push(item()); events.push(event('class-block', 24, 'task-a'), event('finished-block', -24, 'task-a', 'COMPLETED'))
  provider(t, [{ kind: 'subject.delete', subjectId: 'class-a', reason: 'Remove this class and its work.' }]); const staged = await stage()
  assert.equal((await decideProposal(owner, staged.id, 'confirm')).status, 'APPLIED')
  assert.equal(subjects.length, 0); assert.equal(items.length, 0); assert.equal(events.length, 2)
  assert.ok(events.every((entry) => entry.subjectId === null && entry.itemId === null))
})

test('fresh local and Google collisions stop event creations at confirmation', async (t) => {
  const operation = createEvent('class-a', null); provider(t, [operation]); const staged = await stage()
  assert.equal(operation.kind, 'event.create')
  if (operation.kind !== 'event.create') throw new Error('fixture')
  const collision = event('new-busy', 28); collision.startsAt = new Date(operation.startsAt); collision.endsAt = new Date(operation.endsAt); events.push(collision)
  await assert.rejects(decideProposal(owner, staged.id, 'confirm'), rejects(409, /overlaps another FlowState/))
  events = []; googleConnected = true; googleItems.push({ id: 'google-busy', summary: 'Busy', start: { dateTime: operation.startsAt }, end: { dateTime: operation.endsAt } })
  await assert.rejects(decideProposal(owner, staged.id, 'confirm'), rejects(409, /overlaps Google/))
  assert.deepEqual(writes, [])
})

test('unavailable Calendar allows metadata creation but refuses new scheduled time', async (t) => {
  googleConnected = true; googleFailure = true
  provider(t, [createClass()]); const staged = await stage(); assert.equal(googleReads, 1)
  assert.equal((await decideProposal(owner, staged.id, 'confirm')).status, 'APPLIED')
  assert.equal(googleReads, 1, 'metadata confirmation must not depend on Calendar availability')
  provider(t, [createEvent('class-a', null)])
  const blocked = await askAssistant(owner, 'Reserve a lecture.', 'Asia/Manila')
  assert.equal(blocked.proposal, undefined); assert.match(blocked.message, /Google|Calendar/)
  assert.deepEqual(writes, ['subject.create'])
})

test('moving a task between classes checks linked blocks outside the planning window', async (t) => {
  subjects.push(subject('class-b', 'Biology')); items.push(item()); events.push(event('historic-block', -60, 'task-a', 'COMPLETED'))
  provider(t, [{ kind: 'item.update', itemId: 'task-a', subjectId: 'class-b', title: 'Updated work', type: 'ASSIGNMENT', status: 'TODO', dueDate: null, estimatedMinutes: 60, priority: 2, notes: null, reason: 'Move to Biology.' }])
  await assert.rejects(stage(), rejects(422, /calendar blocks cannot change classes/))
  assert.deepEqual(writes, [])
})

test('editable class fields, archive/restore, work progress, and event lifecycle persist reviewed values', async (t) => {
  items.push(item()); events.push(event())
  const apply = async (operation: AssistantOperation) => {
    provider(t, [operation]); const staged = await stage()
    assert.equal((await decideProposal(owner, staged.id, 'confirm')).status, 'APPLIED')
  }
  const due = at(120).toISOString().slice(0, 10)
  await apply({ kind: 'subject.update', subjectId: 'class-a', name: 'Advanced Calculus', category: 'SEMINAR', code: 'MATH201', colorHex: '#ABCDEF', notes: 'Bring a calculator.', difficulty: 8, examDate: due, reason: 'Use the corrected class details.' })
  assert.equal(subjects[0].name, 'Advanced Calculus'); assert.equal(subjects[0].difficulty, 8)
  assert.equal((subjects[0].examDate as Date).toISOString(), `${due}T00:00:00.000Z`)
  await apply({ kind: 'subject.archive', subjectId: 'class-a', archived: true, reason: 'Archive until next term.' })
  assert.ok(subjects[0].archivedAt instanceof Date)
  await apply({ kind: 'subject.archive', subjectId: 'class-a', archived: false, reason: 'Restore the active class.' })
  assert.equal(subjects[0].archivedAt, null)
  await apply({ kind: 'item.update', itemId: 'task-a', subjectId: 'class-a', title: 'Integration project', type: 'PROJECT', status: 'TODO', dueDate: due, estimatedMinutes: 180, priority: 3, notes: 'Group submission.', reason: 'Record the updated project requirements.' })
  assert.equal(items[0].title, 'Integration project'); assert.equal(items[0].estimatedMinutes, 180)
  assert.equal((items[0].dueDate as Date).toISOString(), `${due}T00:00:00.000Z`)
  await apply({ kind: 'item.complete', itemId: 'task-a', status: 'DONE', reason: 'Mark submitted work complete.' })
  assert.equal(items[0].status, 'DONE')
  const startsAt = at(30); const endsAt = new Date(startsAt.getTime() + 5_400_000)
  await apply({ kind: 'event.update', eventId: 'event-a', subjectId: 'class-a', itemId: null, title: 'Longer study session', category: 'DEEP_WORK_SHIFT', startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), isAllDay: false, location: 'Library', notes: 'Integration practice.', reason: 'Use the requested study time and duration.' })
  assert.equal((events[0].startsAt as Date).toISOString(), startsAt.toISOString()); assert.equal(events[0].planReason, null)
  await apply({ kind: 'event.status', eventId: 'event-a', status: 'CANCELLED', reason: 'Cancel this study block.' })
  assert.equal(events[0].status, 'CANCELLED')
  await apply({ kind: 'event.status', eventId: 'event-a', status: 'SCHEDULED', reason: 'Restore this study block.' })
  assert.equal(events[0].status, 'SCHEDULED')
  await apply({ kind: 'event.status', eventId: 'event-a', status: 'COMPLETED', reason: 'Record the completed study block.' })
  assert.equal(events[0].status, 'COMPLETED')
  await apply({ kind: 'event.delete', eventId: 'event-a', reason: 'Remove this duplicate history entry.' })
  assert.equal(events.length, 0)
})

test('editing a reviewed source invalidates a metadata proposal even while Calendar is unavailable', async (t) => {
  items.push(item()); googleConnected = true; googleFailure = true
  provider(t, [{ kind: 'item.complete', itemId: 'task-a', status: 'DONE', reason: 'Complete the submitted assignment.' }])
  const staged = await stage()
  items[0].notes = 'Changed in another tab'; items[0].updatedAt = new Date()
  await assert.rejects(decideProposal(owner, staged.id, 'confirm'), rejects(409, /changed after this proposal/))
  assert.deepEqual(writes, []); assert.equal(items[0].status, 'TODO'); assert.equal(currentProposal().status, 'PENDING')
})

test('an all-day proposal keeps the saved Manila timezone throughout staging and confirmation', async (t) => {
  const day = at(48).toISOString().slice(0, 10)
  const startsAt = new Date(`${day}T00:00:00+08:00`)
  const operation: AssistantOperation = {
    kind: 'event.create', subjectId: 'class-a', itemId: null, title: 'Class field trip', category: 'OTHER',
    startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 86_400_000).toISOString(), isAllDay: true,
    location: null, notes: null, reason: 'Reserve the requested whole local day.',
  }
  provider(t, [operation]); const staged = await stage()
  assert.equal(currentProposal().timeZone, 'Asia/Manila')
  assert.equal((await decideProposal(owner, staged.id, 'confirm')).status, 'APPLIED')
  assert.equal(events[0].isAllDay, true)
  assert.equal((events[0].startsAt as Date).toISOString(), startsAt.toISOString())
})
