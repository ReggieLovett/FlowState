'use server'

import { revalidatePath } from 'next/cache'
import { unstable_rethrow } from 'next/navigation'
import { z } from 'zod'
import { createEvent, deleteEvent, updateEvent } from '@/lib/data/schedule'
import { readProgress } from '@/lib/data/progress'
import { CATEGORY_ORDER } from '@/lib/categories'
import { diffRewards, type RewardDiff } from '@/lib/gamification'
import { POLICIES } from '@/lib/rate-limit'
import { limitUser } from '@/lib/rate-limit-user'
import type { RateLimited } from '@/lib/rate-limit-shared'
import type { Category } from '@prisma/client'
import { dateInputSchema, formId, idSchema, timeInputSchema } from '@/lib/validation/fields'

/**
 * Server Actions for schedule events.
 *
 * None of these takes a `userId`. The data layer derives it from the session, so
 * a crafted form post cannot address another user's rows. Ownership is enforced
 * again in the database by the compound `id_userId` selector.
 */

export interface ActionState {
  error?: string
  ok?: boolean
  /** Set when the request was refused for volume; forms count down from it. */
  rateLimit?: RateLimited
}

// Typed as the Prisma enum, so a parsed value flows into EventInput without a cast.
const categoryEnum = z.enum(CATEGORY_ORDER as [Category, ...Category[]])

const eventSchema = z
  .object({
    title: z.string().trim().min(1, 'Give the event a title.').max(200),
    category: categoryEnum,
    // Empty string is the "No subject" option in the picker.
    subjectId: z.union([z.literal(''), idSchema]).optional(),
    // Checked for shape, not just presence. `combine()` below builds a Date
    // from these strings, and anything malformed used to become Invalid Date and
    // surface as a 500 from Prisma rather than as a message on the form.
    date: dateInputSchema,
    // All-day events post no times, because the inputs are disabled.
    startTime: z.union([z.literal(''), timeInputSchema]).optional(),
    endTime: z.union([z.literal(''), timeInputSchema]).optional(),
    location: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(2000).optional(),
    isAllDay: z.boolean().optional(),
  })
  .refine((v) => v.isAllDay || (v.startTime && v.endTime), {
    message: 'Pick a start and an end time.',
    path: ['startTime'],
  })
  .refine((v) => v.isAllDay || (v.endTime ?? '') > (v.startTime ?? ''), {
    message: 'End time must be after the start time.',
    path: ['endTime'],
  })

/** Combines the date and time inputs into a Date in the server's timezone. */
function combine(date: string, time: string): Date {
  return new Date(`${date}T${time}:00`)
}

function parseForm(formData: FormData) {
  return eventSchema.safeParse({
    title: formData.get('title'),
    category: formData.get('category'),
    subjectId: formData.get('subjectId') ?? undefined,
    date: formData.get('date'),
    // Disabled inputs are not submitted, so an all-day event arrives with no
    // times at all: null, which `.optional()` does not accept. Mapped to
    // undefined here. The old `z.string().min(1)` rejected that null, so an
    // all-day event (the way deadlines are entered) could not be saved.
    startTime: formData.get('startTime') ?? undefined,
    endTime: formData.get('endTime') ?? undefined,
    location: formData.get('location') ?? undefined,
    notes: formData.get('notes') ?? undefined,
    isAllDay: formData.get('isAllDay') === 'on',
  })
}

export async function createEventAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const limited = await limitUser(POLICIES.write)
  if (limited) return limited

  const parsed = parseForm(formData)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  }

  const v = parsed.data

  try {
    await createEvent({
      title: v.title,
      category: v.category,
      subjectId: v.subjectId ? v.subjectId : null,
      startsAt: combine(v.date, v.isAllDay ? '00:00' : v.startTime!),
      endsAt: combine(v.date, v.isAllDay ? '23:59' : v.endTime!),
      isAllDay: v.isAllDay ?? false,
      location: v.location || null,
      notes: v.notes || null,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Subject not found') {
      return { error: 'That subject is no longer available.' }
    }
    throw error
  }

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/schedule')
  return { ok: true }
}

export async function updateEventAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = formId(formData.get('id'))
  if (!id) return { error: 'Missing event.' }

  const limited = await limitUser(POLICIES.write)
  if (limited) return limited

  const parsed = parseForm(formData)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  }

  const v = parsed.data

  try {
    await updateEvent(id, {
      title: v.title,
      category: v.category,
      subjectId: v.subjectId ? v.subjectId : null,
      startsAt: combine(v.date, v.isAllDay ? '00:00' : v.startTime!),
      endsAt: combine(v.date, v.isAllDay ? '23:59' : v.endTime!),
      isAllDay: v.isAllDay ?? false,
      location: v.location || null,
      notes: v.notes || null,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Subject not found') {
      return { error: 'That subject is no longer available.' }
    }
    unstable_rethrow(error)
    // A row belonging to someone else matches nothing and Prisma throws.
    return { error: 'Could not update that event.' }
  }

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/schedule')
  return { ok: true }
}

export async function deleteEventAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = formId(formData.get('id'))
  if (!id) return { error: 'Missing event.' }

  const limited = await limitUser(POLICIES.write)
  if (limited) return limited

  await deleteEvent(id)

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/schedule')
  return { ok: true }
}

const statusSchema = z.enum(['SCHEDULED', 'COMPLETED', 'CANCELLED'])

export async function setEventStatusAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = formId(formData.get('id'))
  const parsed = statusSchema.safeParse(formData.get('status'))
  if (!id || !parsed.success) return { error: 'Could not update that event.' }

  const limited = await limitUser(POLICIES.write)
  if (limited) return limited

  try {
    await updateEvent(id, { status: parsed.data })
  } catch (error) {
    // Someone else's id matches nothing and Prisma throws. That used to escape
    // as an unhandled 500; it is the same answer as a deleted event.
    unstable_rethrow(error)
    return { error: 'That event is no longer available.' }
  }

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/schedule')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Completion with rewards
// ---------------------------------------------------------------------------

export interface CompleteState {
  error?: string
  /** Changes on every successful submit, so the client can tell runs apart. */
  nonce?: number
  status?: 'SCHEDULED' | 'COMPLETED'
  rewards?: RewardDiff
  /** The block has not started yet, so its XP is pending. */
  pending?: boolean
  rateLimit?: RateLimited
}

/**
 * Ticks or un-ticks an event and reports what that did to XP.
 *
 * The reward is a before/after diff of the derived progress rather than a
 * formula applied to this one block, because a single tick can also complete a
 * day, extend a streak past a bonus, or unlock an avatar. Two reads, one write.
 */
export async function toggleCompleteAction(
  _previous: CompleteState,
  formData: FormData,
): Promise<CompleteState> {
  const id = formId(formData.get('id'))
  const parsed = z.enum(['SCHEDULED', 'COMPLETED']).safeParse(formData.get('status'))
  if (!id || !parsed.success) return { error: 'Could not update that event.' }

  // Before the two progress reads, which are what make this action expensive.
  const limited = await limitUser(POLICIES.complete)
  if (limited) return limited

  const before = await readProgress()

  let startsAt: Date
  try {
    const updated = await updateEvent(id, { status: parsed.data })
    startsAt = updated.startsAt
  } catch (error) {
    // A signed-out session redirects by throwing; that must not become an error message.
    unstable_rethrow(error)
    return { error: 'Could not update that event.' }
  }

  const after = await readProgress()

  revalidatePath('/dashboard', 'layout')
  return {
    nonce: Date.now(),
    status: parsed.data,
    rewards: diffRewards(before, after),
    pending: parsed.data === 'COMPLETED' && startsAt > new Date(),
  }
}

// ---------------------------------------------------------------------------
// Drag to reschedule
// ---------------------------------------------------------------------------

const moveSchema = z
  .object({
    id: idSchema,
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
  })
  .refine((v) => v.startsAt < v.endsAt, { message: 'End must be after start.' })
  .refine(
    (v) => new Date(v.endsAt).getTime() - new Date(v.startsAt).getTime() <= 24 * 60 * 60 * 1000,
    { message: 'A block cannot run longer than a day.' },
  )

/**
 * Moves or resizes an event from the calendar grid.
 *
 * Takes instants computed in the browser, which is the timezone the user was
 * looking at when they dropped the block. Only the two times are writable
 * here; everything else goes through the edit dialog and its validation.
 */
export async function moveEventAction(input: {
  id: string
  startsAt: string
  endsAt: string
}): Promise<ActionState> {
  const parsed = moveSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid time.' }

  const limited = await limitUser(POLICIES.move)
  if (limited) return limited

  try {
    await updateEvent(parsed.data.id, {
      startsAt: new Date(parsed.data.startsAt),
      endsAt: new Date(parsed.data.endsAt),
    })
  } catch (error) {
    unstable_rethrow(error)
    return { error: 'Could not move that event.' }
  }

  revalidatePath('/dashboard', 'layout')
  return { ok: true }
}
