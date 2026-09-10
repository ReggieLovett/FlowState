import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getUserId } from '@/lib/auth-guard'
import { createEvent, listEventsInRange } from '@/lib/data/schedule'

/**
 * Example of a secure server-side route.
 *
 * Note what is absent: no `userId` in the query string, no `userId` in the body,
 * no ownership check written by hand. The handler authenticates, then delegates
 * to lib/data/schedule.ts, which derives the user id from the session itself.
 * There is no parameter through which a caller could request another user's
 * events, which is a stronger guarantee than remembering to filter.
 *
 * With the App Router most screens should call the same data functions directly
 * from a Server Component and skip the network hop. This route exists for the
 * cases that genuinely need HTTP: a calendar widget fetching on navigation, a
 * mobile client, a webhook.
 */

export const runtime = 'nodejs'
// The response depends on the session cookie, so it must never be cached.
export const dynamic = 'force-dynamic'

const rangeSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
})

export async function GET(request: Request) {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const parsed = rangeSchema.safeParse({
    from: searchParams.get('from'),
    to: searchParams.get('to'),
  })

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Provide `from` and `to` as ISO dates.' },
      { status: 400 },
    )
  }

  if (parsed.data.to <= parsed.data.from) {
    return NextResponse.json({ error: '`to` must be after `from`.' }, { status: 400 })
  }

  // Bound the window so a single request cannot ask for a decade of rows.
  const MAX_RANGE_DAYS = 366
  const spanDays =
    (parsed.data.to.getTime() - parsed.data.from.getTime()) / (24 * 60 * 60 * 1000)
  if (spanDays > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: `Range cannot exceed ${MAX_RANGE_DAYS} days.` },
      { status: 400 },
    )
  }

  const events = await listEventsInRange(parsed.data.from, parsed.data.to)

  return NextResponse.json({ events })
}

const createSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    category: z.enum([
      'LECTURE',
      'SEMINAR',
      'LAB_SESSION',
      'CLIENT_MEETING',
      'PROJECT_DEADLINE',
      'DEEP_WORK_SHIFT',
      'OTHER',
    ]),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    subjectId: z.string().cuid().nullish(),
    isAllDay: z.boolean().optional(),
    location: z.string().trim().max(200).nullish(),
    notes: z.string().trim().max(2000).nullish(),
    recurrenceRule: z.string().trim().max(500).nullish(),
  })
  // Rejected here rather than by a database constraint so the client gets a
  // field-level message instead of a 500.
  .refine((value) => value.endsAt > value.startsAt, {
    message: 'End time must be after the start time.',
    path: ['endsAt'],
  })

export async function POST(request: Request) {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 })
  }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: z.treeifyError(parsed.error) },
      { status: 400 },
    )
  }

  try {
    // `userId` is never taken from the body; createEvent reads the session.
    const event = await createEvent(parsed.data)
    return NextResponse.json({ event }, { status: 201 })
  } catch (error) {
    // Thrown when subjectId points at a row this user does not own. Reported as
    // 404, not 403: confirming the id exists would leak another user's data.
    if (error instanceof Error && error.message === 'Subject not found') {
      return NextResponse.json({ error: 'Subject not found' }, { status: 404 })
    }
    throw error
  }
}
