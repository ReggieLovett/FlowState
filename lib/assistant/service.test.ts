import assert from 'node:assert/strict'
import { after, beforeEach, test, type TestContext } from 'node:test'
import type { AssistantProposal as StoredProposal } from '@prisma/client'
import { askAssistant, decideProposal } from './service'
import { AssistantError } from './errors'
import type { EventSnapshot, ModelPlan } from './validation'

// Run the real orchestration, provider adapter and calendar adapter against a
// small transactional store. PostgreSQL itself is deliberately not contacted.
const owner = 'owner-a'
type EventRow = Omit<EventSnapshot, 'startsAt' | 'endsAt' | 'updatedAt'> & {
  userId: string; startsAt: Date; endsAt: Date; updatedAt: Date
}
type CreateData = Omit<StoredProposal, 'id' | 'status' | 'appliedAt' | 'createdAt' | 'updatedAt'>
type EventWrite = {
  where: { id: string; userId: string; status: string; isAllDay: boolean; recurrenceRule: null; updatedAt: Date; startsAt: Date; endsAt: Date }
  data: { startsAt: Date; endsAt: Date; planReason: null }
}
let events: EventRow[] = []
let proposal: StoredProposal | null = null
let attempts: EventWrite[] = []
let proposalCreates = 0
let rollbacks = 0
let commits = 0
let hasRecurrence = false
let failWriteId: string | null = null
let accounts: Array<{
  id: string; userId: string; access_token: string; refresh_token: string; expires_at: number; scope: string
}> = []

const at = (hours: number) => new Date(Date.now() + hours * 60 * 60_000)
const freshEvent = (id = 'event-a', hours = 24): EventRow => {
  const startsAt = at(hours)
  return {
    id, userId: owner, title: `Focus ${id}`, startsAt, endsAt: new Date(startsAt.getTime() + 60 * 60_000),
    updatedAt: at(-24), status: 'SCHEDULED', isAllDay: false, recurrenceRule: null,
  }
}
const sourceEvent = () => events[0]
const storedProposal = () => { assert.ok(proposal); return proposal }
const currentMove = (id = 'event-a', hours = 28): ModelPlan['changes'][number] => {
  const start = at(hours)
  return { eventId: id, toStart: start.toISOString(), toEnd: new Date(start.getTime() + 60 * 60_000).toISOString(), reason: 'Protect uninterrupted focus time.' }
}

const database = {
  account: { findMany: async ({ where }: { where: { userId: string } }) => accounts.filter((account) => account.userId === where.userId) },
  subjectItem: { findMany: async ({ where }: { where: { userId: string } }) => { assert.equal(where.userId, owner); return [] } },
  scheduleEvent: {
    findMany: async ({ where, take }: { where: { userId: string; startsAt: { lt: Date }; endsAt: { gt: Date } }; take: number }) => events
      .filter((event) => event.userId === where.userId && event.startsAt < where.startsAt.lt && event.endsAt > where.endsAt.gt && event.status === 'SCHEDULED')
      .slice(0, take)
      .map((event) => ({
        id: event.id, title: event.title, startsAt: event.startsAt, endsAt: event.endsAt,
        updatedAt: event.updatedAt, status: event.status, isAllDay: event.isAllDay, recurrenceRule: event.recurrenceRule,
      })),
    findFirst: async ({ where }: { where: { userId: string } }) => { assert.equal(where.userId, owner); return hasRecurrence ? { id: 'recurring' } : null },
    updateMany: async (write: EventWrite) => {
      attempts.push(structuredClone(write))
      const row = events.find((event) => event.id === write.where.id && event.userId === write.where.userId)
      if (!row || failWriteId === row.id || row.status !== write.where.status || row.isAllDay !== write.where.isAllDay ||
        row.recurrenceRule !== write.where.recurrenceRule || row.updatedAt.getTime() !== write.where.updatedAt.getTime() ||
        row.startsAt.getTime() !== write.where.startsAt.getTime() || row.endsAt.getTime() !== write.where.endsAt.getTime()) return { count: 0 }
      Object.assign(row, write.data, { updatedAt: new Date() })
      return { count: 1 }
    },
  },
  assistantProposal: {
    create: async ({ data }: { data: CreateData }) => {
      proposalCreates += 1
      proposal = { ...structuredClone(data), id: 'proposal-a', status: 'PENDING', appliedAt: null, createdAt: new Date(), updatedAt: new Date() }
      return { id: proposal.id, expiresAt: proposal.expiresAt }
    },
    findUnique: async ({ where }: { where: { id_userId: { id: string; userId: string } } }) =>
      proposal?.id === where.id_userId.id && proposal.userId === where.id_userId.userId ? structuredClone(proposal) : null,
    update: async ({ where, data }: { where: { id_userId: { id: string; userId: string } }; data: { status: StoredProposal['status']; appliedAt?: Date } }) => {
      assert.equal(where.id_userId.userId, owner)
      const current = storedProposal()
      assert.equal(current.id, where.id_userId.id)
      Object.assign(current, data)
      return structuredClone(current)
    },
  },
  $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
    assert.match(sql.join('?'), /FOR UPDATE/)
    assert.deepEqual(values, ['proposal-a', owner])
    return proposal?.id === values[0] && proposal?.userId === values[1] ? [{ id: proposal.id }] : []
  },
  $transaction: async <T>(callback: (tx: object) => Promise<T>, options: { isolationLevel: string }) => {
    assert.equal(options.isolationLevel, 'Serializable')
    const snapshot = structuredClone({ events, proposal })
    try {
      const result = await callback(database)
      commits += 1
      return result
    } catch (error) {
      events = snapshot.events
      proposal = snapshot.proposal
      rollbacks += 1
      throw error
    }
  },
}

const globals = globalThis as unknown as { prisma?: unknown }
const previousPrisma = globals.prisma
const previousKey = process.env.GROQ_API_KEY
globals.prisma = database
process.env.GROQ_API_KEY = 'test-only-private-key'
beforeEach(() => {
  events = [freshEvent()]
  proposal = null
  attempts = []
  proposalCreates = 0
  commits = 0
  rollbacks = 0
  hasRecurrence = false
  failWriteId = null
  accounts = []
  process.env.GROQ_API_KEY = 'test-only-private-key'
})
after(() => {
  globals.prisma = previousPrisma
  if (previousKey === undefined) delete process.env.GROQ_API_KEY
  else process.env.GROQ_API_KEY = previousKey
})

function provider(t: TestContext, changes = [currentMove()], googleItems: unknown[] = []) {
  return t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).includes('googleapis.com/calendar')) {
      return Response.json({ timeZone: 'Asia/Manila', items: googleItems })
    }
    assert.equal(String(input), 'https://api.groq.com/openai/v1/chat/completions')
    const body = JSON.parse(String(init?.body)) as { model: string; response_format: { json_schema: { strict: boolean } }; tools?: unknown }
    assert.equal(body.model, 'openai/gpt-oss-120b')
    assert.equal(body.response_format.json_schema.strict, true)
    assert.equal(body.tools, undefined)
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ message: 'I suggest moving this focus block. Confirm to save it.', changes }) } }] })
  })
}

async function stage() {
  const result = await askAssistant(owner, 'Give me a better focus slot.', 'Asia/Manila')
  assert.ok(result.proposal)
  return result.proposal
}
const rejectsWith = (status: number, pattern: RegExp) => (error: unknown) => error instanceof AssistantError && error.status === status && pattern.test(error.message)

test('a real assistant request stages owned immutable snapshots without writing any schedule event', async (t) => {
  provider(t)
  const original = structuredClone(events)
  const result = await stage()
  assert.equal(proposalCreates, 1)
  assert.equal(attempts.length, 0)
  assert.deepEqual(events, original)
  assert.equal(result.changes[0].fromStart, sourceEvent().startsAt.toISOString())
  assert.equal(result.changes[0].title, sourceEvent().title)
  assert.equal(storedProposal().userId, owner)
  assert.equal(storedProposal().status, 'PENDING')
  assert.equal((storedProposal().snapshot as { events: EventSnapshot[] }).events[0].updatedAt, sourceEvent().updatedAt.toISOString())
})

test('confirm applies the reviewed move atomically and a repeated confirm never writes it twice', async (t) => {
  provider(t)
  const staged = await stage()
  const applied = await decideProposal(owner, staged.id, 'confirm')
  assert.equal(applied.status, 'APPLIED')
  assert.equal(sourceEvent().startsAt.toISOString(), staged.changes[0].toStart)
  assert.equal(storedProposal().status, 'APPLIED')
  assert.ok(storedProposal().appliedAt)
  assert.equal(attempts.length, 1)
  assert.equal(commits, 1)
  assert.equal(attempts[0].where.userId, owner)
  assert.equal(attempts[0].data.planReason, null)
  assert.equal((await decideProposal(owner, staged.id, 'confirm')).status, 'APPLIED')
  assert.equal(attempts.length, 1)
  await assert.rejects(decideProposal(owner, staged.id, 'cancel'), rejectsWith(409, /already been applied/))
})

test('another user cannot read, confirm or cancel the proposal', async (t) => {
  provider(t)
  const staged = await stage()
  await assert.rejects(decideProposal('other-user', staged.id, 'confirm'), rejectsWith(404, /not found/))
  await assert.rejects(decideProposal('other-user', staged.id, 'cancel'), rejectsWith(404, /not found/))
  assert.equal(attempts.length, 0)
  assert.equal(commits, 0)
  assert.equal(storedProposal().status, 'PENDING')
})

test('expired confirmation fails, while cancellation and repeated cancellation leave the schedule untouched', async (t) => {
  provider(t)
  const staged = await stage()
  storedProposal().expiresAt = at(-1)
  const original = structuredClone(events)
  await assert.rejects(decideProposal(owner, staged.id, 'confirm'), rejectsWith(409, /expired/))
  assert.equal((await decideProposal(owner, staged.id, 'cancel')).status, 'CANCELLED')
  assert.equal((await decideProposal(owner, staged.id, 'cancel')).status, 'CANCELLED')
  await assert.rejects(decideProposal(owner, staged.id, 'confirm'), rejectsWith(409, /cancelled/))
  assert.equal(attempts.length, 0)
  assert.deepEqual(events, original)
})

test('a stale source event causes confirmation to roll back without overwriting the new edit', async (t) => {
  provider(t)
  const staged = await stage()
  sourceEvent().title = 'Renamed while awaiting approval'
  sourceEvent().updatedAt = new Date()
  await assert.rejects(decideProposal(owner, staged.id, 'confirm'), rejectsWith(409, /schedule changed/))
  assert.equal(sourceEvent().title, 'Renamed while awaiting approval')
  assert.equal(storedProposal().status, 'PENDING')
  assert.equal(attempts.length, 0)
  assert.equal(rollbacks, 1)
})

test('a newly created local collision is checked again during confirmation', async (t) => {
  provider(t)
  const staged = await stage()
  events.push(freshEvent('new-busy', 28))
  // Use the exact reviewed timestamps to avoid millisecond drift in this fixture.
  events[1].startsAt = new Date(staged.changes[0].toStart)
  events[1].endsAt = new Date(staged.changes[0].toEnd)
  await assert.rejects(decideProposal(owner, staged.id, 'confirm'), rejectsWith(409, /overlaps another FlowState/))
  assert.equal(attempts.length, 0)
  assert.equal(storedProposal().status, 'PENDING')
})

test('fresh Google busy intervals prevent applying a previously local-only plan', async (t) => {
  const googleItems: unknown[] = []
  provider(t, [currentMove()], googleItems)
  const staged = await stage()
  accounts = [{ id: 'google-a', userId: owner, access_token: 'private-calendar-token', refresh_token: 'private-refresh-token', expires_at: Math.floor(Date.now() / 1000) + 3600, scope: 'https://www.googleapis.com/auth/calendar.events.readonly' }]
  googleItems.push({ id: 'new-google-event', summary: 'A new meeting', start: { dateTime: staged.changes[0].toStart }, end: { dateTime: staged.changes[0].toEnd } })
  await assert.rejects(decideProposal(owner, staged.id, 'confirm'), rejectsWith(409, /overlaps Google/))
  assert.equal(attempts.length, 0)
  assert.equal(storedProposal().status, 'PENDING')
})

test('a failing second guarded write rolls back the first move and leaves approval pending', async (t) => {
  const second = freshEvent('event-b', 26)
  // Equal durations exactly, independent of calls to Date.now().
  second.endsAt = new Date(second.startsAt.getTime() + 60 * 60_000)
  events.push(second)
  const moves = [currentMove('event-a', 28), currentMove('event-b', 30)]
  for (const move of moves) move.toEnd = new Date(Date.parse(move.toStart) + 60 * 60_000).toISOString()
  provider(t, moves)
  const staged = await stage()
  const original = structuredClone(events)
  failWriteId = 'event-b'
  await assert.rejects(decideProposal(owner, staged.id, 'confirm'), rejectsWith(409, /schedule changed/))
  assert.equal(attempts.length, 2)
  assert.deepEqual(events, original)
  assert.equal(storedProposal().status, 'PENDING')
  assert.equal(rollbacks, 1)
  assert.equal(commits, 0)
})

test('a model cannot bypass recurrence blockers or propose somebody else’s event id', async (t) => {
  provider(t)
  hasRecurrence = true
  const blocked = await askAssistant(owner, 'Move my block anyway.', 'Asia/Manila')
  assert.equal(blocked.proposal, undefined)
  assert.match(blocked.message, /recurring events/)
  assert.equal(proposalCreates, 0)
  hasRecurrence = false
  provider(t, [currentMove('stranger-event')])
  await assert.rejects(askAssistant(owner, 'Move another event.', 'Asia/Manila'), rejectsWith(422, /unavailable/))
  assert.equal(proposalCreates, 0)
  assert.equal(attempts.length, 0)
})

test('a missing key and provider refusals fail without staging or writing schedule events', async (t) => {
  const mocked = provider(t)
  delete process.env.GROQ_API_KEY
  await assert.rejects(askAssistant(owner, 'Make a plan.', 'Asia/Manila'), rejectsWith(503, /not configured/))
  assert.equal(mocked.mock.callCount(), 0)
  process.env.GROQ_API_KEY = 'test-only-private-key'
  t.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [{ finish_reason: 'stop', message: { refusal: 'no', content: null } }] }))
  await assert.rejects(askAssistant(owner, 'Make a plan.', 'Asia/Manila'), rejectsWith(422, /could not help/))
  assert.equal(proposalCreates, 0)
  assert.equal(attempts.length, 0)
})

