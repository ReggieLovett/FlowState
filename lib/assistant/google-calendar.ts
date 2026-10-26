import 'server-only'

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { isTimeZone, wallTimeToInstant } from '@/lib/zoned-time'

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly'
const READ_SCOPES = new Set([
  CALENDAR_SCOPE,
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar',
])
const MAX_PAGES = 4
const PAGE_SIZE = 250
const MAX_EVENTS = MAX_PAGES * PAGE_SIZE
const FETCH_TIMEOUT_MS = 6_000

export interface GoogleCalendarEvent {
  id: string
  title: string
  startsAt: string
  endsAt: string
}

export interface GoogleCalendarRead {
  connected: boolean
  events: GoogleCalendarEvent[]
  /** Any warning means the read is incomplete: callers must refuse mutations. */
  warning?: string
}

/** Safe, actionable text only. Raw provider responses and tokens never escape. */
export class GoogleCalendarError extends Error {
  constructor(message: string, readonly incomplete = false) {
    super(message)
    this.name = 'GoogleCalendarError'
  }
}

const accountSelect = {
  id: true,
  userId: true,
  access_token: true,
  refresh_token: true,
  expires_at: true,
  scope: true,
} as const

type CalendarAccount = {
  id: string
  userId: string
  access_token: string | null
  refresh_token: string | null
  expires_at: number | null
  scope: string | null
}

function configured(): boolean {
  return Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET)
}

function hasCalendarScope(scope: string | null): boolean {
  return Boolean(scope?.split(/\s+/).some((value) => READ_SCOPES.has(value)))
}

/** A token-free DTO for the server-rendered Settings page. */
export async function googleCalendarStatus(userId: string) {
  const accounts = await prisma.account.findMany({
    where: { userId, provider: 'google' },
    select: { scope: true, refresh_token: true, access_token: true, expires_at: true },
    orderBy: { id: 'asc' },
    take: 2,
  })
  const account = accounts[0]
  return {
    configured: configured(),
    connected: Boolean(account),
    needsReconnect: Boolean(account && (
      accounts.length > 1 || !hasCalendarScope(account.scope) || !account.refresh_token || !account.access_token
    )),
    multipleAccounts: accounts.length > 1,
  }
}

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive().max(31_536_000),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
})

async function accessToken(account: CalendarAccount, forceRefresh = false): Promise<string> {
  if (!forceRefresh && account.access_token && account.expires_at && account.expires_at > Date.now() / 1000 + 60) {
    return account.access_token
  }
  if (!account.refresh_token || !configured()) {
    throw new GoogleCalendarError('Reconnect Google Calendar in Settings to refresh calendar access.')
  }

  let response: Response
  try {
    response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.AUTH_GOOGLE_ID!,
        client_secret: process.env.AUTH_GOOGLE_SECRET!,
        grant_type: 'refresh_token',
        refresh_token: account.refresh_token,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch {
    throw new GoogleCalendarError('Google Calendar could not be reached. Try again before changing your timeline.')
  }
  if (!response.ok) {
    throw new GoogleCalendarError('Google Calendar access has expired. Reconnect it in Settings before changing your timeline.')
  }
  const parsed = tokenSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw new GoogleCalendarError('Google Calendar returned an invalid token. Reconnect it in Settings.')
  const token = parsed.data
  if (token.scope && !hasCalendarScope(token.scope)) {
    throw new GoogleCalendarError('Allow read-only event access when reconnecting Google Calendar in Settings.')
  }

  // A concurrent OAuth reconnect must win over a refresh started earlier.
  const updated = await prisma.account.updateMany({
    where: { id: account.id, userId: account.userId, provider: 'google', access_token: account.access_token },
    data: {
      access_token: token.access_token,
      expires_at: Math.floor(Date.now() / 1000) + token.expires_in,
      ...(token.refresh_token ? { refresh_token: token.refresh_token } : {}),
      ...(token.scope ? { scope: token.scope } : {}),
      ...(token.token_type ? { token_type: token.token_type } : {}),
    },
  })
  if (!updated.count) {
    const current = await prisma.account.findFirst({
      where: { id: account.id, userId: account.userId, provider: 'google' },
      select: { access_token: true, scope: true },
    })
    if (!current?.access_token || !hasCalendarScope(current.scope)) {
      throw new GoogleCalendarError('Google Calendar changed while it was being checked. Reconnect it in Settings and try again.')
    }
    return current.access_token
  }
  return token.access_token
}

const boundarySchema = z.object({
  date: z.string().optional(),
  dateTime: z.string().optional(),
  timeZone: z.string().optional(),
})
const pageSchema = z.object({
  timeZone: z.string().refine(isTimeZone),
  nextPageToken: z.string().min(1).optional(),
  items: z.array(z.object({
    id: z.string().min(1),
    summary: z.string().optional(),
    status: z.string().optional(),
    transparency: z.string().optional(),
    start: boundarySchema.optional(),
    end: boundarySchema.optional(),
  })).max(PAGE_SIZE).default([]),
})

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function eventInstant(boundary: z.infer<typeof boundarySchema> | undefined, calendarZone: string | undefined): Date {
  if (boundary?.dateTime && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(boundary.dateTime) && validDate(boundary.dateTime.slice(0, 10))) {
    const instant = new Date(boundary.dateTime)
    if (Number.isFinite(instant.getTime())) return instant
  }
  const zone = boundary?.timeZone ?? calendarZone
  if (!zone || !isTimeZone(zone)) {
    throw new GoogleCalendarError('Google Calendar returned an event without a valid timezone. Check the event in Google Calendar and try again.', true)
  }
  if (boundary?.date && validDate(boundary.date)) {
    return wallTimeToInstant(boundary.date, '00:00', zone)
  }
  const local = boundary?.dateTime?.match(/^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(\.\d{1,3})?)?$/)
  if (local && validDate(local[1])) {
    const instant = wallTimeToInstant(local[1], `${local[2]}:${local[3]}`, zone)
    return new Date(instant.getTime() + Number(local[4] ?? 0) * 1000 + Number(local[5] ?? 0) * 1000)
  }
  throw new GoogleCalendarError('Google Calendar returned an event that could not be fully checked. Review its dates and try again.', true)
}

/**
 * Read the authenticated owner's primary calendar, expanding recurrences.
 * All-day end dates are exclusive and converted in the calendar's IANA zone.
 * This function never creates or changes Google Calendar events.
 */
export async function readGoogleCalendar(userId: string, start: Date, end: Date): Promise<GoogleCalendarRead> {
  if (!userId || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end.getTime() - start.getTime() > 31 * 86_400_000) {
    throw new GoogleCalendarError('Choose a valid calendar window of up to 31 days.')
  }
  const accounts = await prisma.account.findMany({
    where: { userId, provider: 'google' },
    select: accountSelect,
    orderBy: { id: 'asc' },
    take: 2,
  })
  const account = accounts[0]
  if (!account) return { connected: false, events: [] }
  if (accounts.length > 1) {
    return { connected: true, events: [], warning: 'Multiple Google accounts are linked. Ask your administrator to keep one calendar connection before changing your timeline.' }
  }

  try {
    if (!hasCalendarScope(account.scope)) {
      throw new GoogleCalendarError('Reconnect Google Calendar in Settings and allow read-only event access.')
    }
    let token = await accessToken(account)
    const events: GoogleCalendarEvent[] = []
    const eventIds = new Set<string>()
    const pageTokens = new Set<string>()
    let pageToken: string | undefined
    let refreshedAfterUnauthorized = false

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events')
      url.search = new URLSearchParams({
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        singleEvents: 'true',
        showDeleted: 'false',
        orderBy: 'startTime',
        maxResults: String(PAGE_SIZE),
        fields: 'timeZone,nextPageToken,items(id,summary,status,transparency,start,end)',
        ...(pageToken ? { pageToken } : {}),
      }).toString()
      const request = () => fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      let response = await request()
      if (response.status === 401 && !refreshedAfterUnauthorized) {
        refreshedAfterUnauthorized = true
        token = await accessToken(account, true)
        response = await request()
      }
      if (!response.ok) {
        throw new GoogleCalendarError(response.status === 401 || response.status === 403
          ? 'Reconnect Google Calendar in Settings and allow read-only event access. Check that the Google Calendar API is enabled.'
          : 'Google Calendar is temporarily unavailable. Try again before changing your timeline.')
      }
      const parsed = pageSchema.safeParse(await response.json().catch(() => null))
      if (!parsed.success) throw new GoogleCalendarError('Google Calendar returned an incomplete response. Try again before changing your timeline.', true)
      const result = parsed.data
      for (const event of result.items) {
        if (event.status === 'cancelled' || event.transparency === 'transparent') continue
        const eventStart = eventInstant(event.start, result.timeZone)
        const eventEnd = eventInstant(event.end, result.timeZone)
        if (eventEnd <= eventStart) throw new GoogleCalendarError('Google Calendar returned an invalid event duration. Review the event and try again.', true)
        if (eventStart >= end || eventEnd <= start || eventIds.has(event.id)) continue
        eventIds.add(event.id)
        events.push({
          id: event.id,
          title: event.summary?.trim().slice(0, 200) || 'Google Calendar event',
          startsAt: eventStart.toISOString(),
          endsAt: eventEnd.toISOString(),
        })
      }
      if (!result.nextPageToken) return { connected: true, events }
      if (pageTokens.has(result.nextPageToken)) {
        throw new GoogleCalendarError('Google Calendar pagination could not be completed. Try again before changing your timeline.', true)
      }
      if (page === MAX_PAGES - 1 || events.length >= MAX_EVENTS) {
        throw new GoogleCalendarError('This calendar window contains too many events to check completely. Adjust these blocks manually or try again later.', true)
      }
      pageTokens.add(result.nextPageToken)
      pageToken = result.nextPageToken
    }
    throw new GoogleCalendarError('Google Calendar could not be checked completely. Try again before changing your timeline.', true)
  } catch (error) {
    // Incomplete or malformed data is a hard failure. Never return a prefix of
    // the calendar as though it represented the user's whole availability.
    if (error instanceof GoogleCalendarError && error.incomplete) throw error
    return {
      connected: true,
      events: [],
      warning: error instanceof GoogleCalendarError
        ? error.message
        : 'Google Calendar could not be fully checked. Try again before changing your timeline.',
    }
  }
}
