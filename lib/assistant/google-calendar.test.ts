import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { GoogleCalendarError, readGoogleCalendar } from './google-calendar'

// Prisma is lazy, so these tests exercise the actual reader with a small
// adapter stub and mocked HTTP. No real database, Google account or secrets.
const scope = 'https://www.googleapis.com/auth/calendar.events.readonly'
const start = new Date('2026-10-26T00:00:00Z')
const end = new Date('2026-11-09T00:00:00Z')
const owner = 'owner-a'
const freshAccount = () => ({
  id: 'account-a',
  userId: owner,
  access_token: 'private-access-token',
  refresh_token: 'private-refresh-token' as string | null,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  scope,
})
let accounts: ReturnType<typeof freshAccount>[] = []
let queries: unknown[] = []
let updates: unknown[] = []
const globals = globalThis as unknown as { prisma?: unknown }
const previousPrisma = globals.prisma
globals.prisma = {
  account: {
    findMany: async (query: unknown) => { queries.push(query); return accounts },
    findFirst: async () => accounts[0],
    updateMany: async (query: unknown) => { updates.push(query); return { count: 1 } },
  },
}
const priorId = process.env.AUTH_GOOGLE_ID
const priorSecret = process.env.AUTH_GOOGLE_SECRET
process.env.AUTH_GOOGLE_ID = 'test-client'
process.env.AUTH_GOOGLE_SECRET = 'test-secret'

beforeEach(() => { accounts = [freshAccount()]; queries = []; updates = [] })
after(() => {
  globals.prisma = previousPrisma
  if (priorId === undefined) delete process.env.AUTH_GOOGLE_ID
  else process.env.AUTH_GOOGLE_ID = priorId
  if (priorSecret === undefined) delete process.env.AUTH_GOOGLE_SECRET
  else process.env.AUTH_GOOGLE_SECRET = priorSecret
})

const busyEvent = (id = 'busy') => ({
  id,
  summary: 'Lecture',
  start: { dateTime: '2026-10-27T09:00:00+08:00' },
  end: { dateTime: '2026-10-27T10:00:00+08:00' },
})

test('disconnected reads stay local and queries always include the owner', async (t) => {
  accounts = []
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected network call') })
  assert.deepEqual(await readGoogleCalendar(owner, start, end), { connected: false, events: [] })
  assert.deepEqual((queries[0] as { where: unknown }).where, { userId: owner, provider: 'google' })
  assert.equal(fetch.mock.callCount(), 0)
})

test('follows pagination, expands recurrences, filters free/cancelled events, and converts all-day boundaries', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(String(input))
    assert.equal(url.searchParams.get('singleEvents'), 'true')
    assert.equal(url.searchParams.get('showDeleted'), 'false')
    assert.equal(url.pathname, '/calendar/v3/calendars/primary/events')
    calls += 1
    return Response.json(calls === 1 ? {
      timeZone: 'Asia/Manila', nextPageToken: 'page-2', items: [
        busyEvent(),
        { ...busyEvent('free'), transparency: 'transparent' },
        { id: 'cancelled', status: 'cancelled' },
      ],
    } : {
      timeZone: 'Asia/Manila', items: [
        { id: 'all-day', start: { date: '2026-10-28' }, end: { date: '2026-10-29' } },
      ],
    })
  })
  const result = await readGoogleCalendar(owner, start, end)
  assert.equal(calls, 2)
  assert.equal(result.events.length, 2)
  assert.deepEqual(result.events[1], {
    id: 'all-day', title: 'Google Calendar event',
    startsAt: '2026-10-27T16:00:00.000Z', endsAt: '2026-10-28T16:00:00.000Z',
  })
})

test('all-day conversion respects a daylight-saving boundary', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    timeZone: 'America/New_York',
    items: [{ id: 'dst-day', start: { date: '2026-11-01' }, end: { date: '2026-11-02' } }],
  }))
  const { events } = await readGoogleCalendar(owner, start, end)
  assert.equal(events[0].startsAt, '2026-11-01T04:00:00.000Z')
  assert.equal(events[0].endsAt, '2026-11-02T05:00:00.000Z')
})

test('refreshes expired tokens and persists them without serializing secrets', async (t) => {
  accounts[0].expires_at = 1
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    calls += 1
    if (String(input).includes('oauth2.googleapis.com')) {
      assert.equal(new URLSearchParams(String(init?.body)).get('refresh_token'), 'private-refresh-token')
      return Response.json({ access_token: 'new-private-token', expires_in: 3600 })
    }
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer new-private-token')
    return Response.json({ timeZone: 'Asia/Manila', items: [busyEvent()] })
  })
  const result = await readGoogleCalendar(owner, start, end)
  assert.equal(calls, 2)
  assert.equal(updates.length, 1)
  assert.equal((updates[0] as { data: { access_token: string } }).data.access_token, 'new-private-token')
  assert.equal(JSON.stringify(result).includes('token'), false)
})

test('a failed later page discards earlier events and returns a blocking warning', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1
    return calls === 1
      ? Response.json({ timeZone: 'Asia/Manila', nextPageToken: 'next', items: [busyEvent()] })
      : Response.json({ error: 'private provider detail' }, { status: 503 })
  })
  const result = await readGoogleCalendar(owner, start, end)
  assert.equal(result.connected, true)
  assert.deepEqual(result.events, [])
  assert.match(result.warning ?? '', /temporarily unavailable/)
  assert.equal(JSON.stringify(result).includes('private provider detail'), false)
})

test('missing refresh authorization returns a blocking reconnect warning', async (t) => {
  accounts[0].expires_at = 1
  accounts[0].refresh_token = null
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected network call') })
  const result = await readGoogleCalendar(owner, start, end)
  assert.deepEqual(result.events, [])
  assert.match(result.warning ?? '', /Reconnect Google Calendar/)
  assert.equal(fetch.mock.callCount(), 0)
})

test('repeated page tokens and the page cap fail closed instead of returning partial availability', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ timeZone: 'Asia/Manila', nextPageToken: 'repeated', items: [busyEvent()] }))
  await assert.rejects(readGoogleCalendar(owner, start, end), (error: unknown) => error instanceof GoogleCalendarError && error.incomplete)
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1
    return Response.json({ timeZone: 'Asia/Manila', nextPageToken: `page-${calls + 1}`, items: [busyEvent(`event-${calls}`)] })
  })
  await assert.rejects(readGoogleCalendar(owner, start, end), /too many events/)
  assert.equal(calls, 4)
})

test('malformed timezone/event responses fail closed', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ items: [busyEvent()] }))
  await assert.rejects(readGoogleCalendar(owner, start, end), /incomplete response/)
  t.mock.method(globalThis, 'fetch', async () => Response.json({ timeZone: 'Asia/Manila', items: [{ id: 'broken' }] }))
  await assert.rejects(readGoogleCalendar(owner, start, end), GoogleCalendarError)
})
