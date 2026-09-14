'use server'

import { revalidatePath } from 'next/cache'
import { unstable_rethrow } from 'next/navigation'
import { z } from 'zod'
import {
  deleteGeneratedInRange,
  replaceGeneratedEvents,
} from '@/lib/data/schedule'
import type { Category } from '@prisma/client'
import { CATEGORY_META } from '@/lib/categories'

/**
 * Server Actions for the smart scheduling engine.
 *
 * The browser runs the pure planner and posts the resulting blocks; these
 * actions validate them and write them. Nothing here trusts the payload beyond
 * its shape: the user is resolved from the session inside the data layer, and
 * the subject ids are re-checked against that user before a row is created.
 *
 * The planner is deliberately not re-run on the server. Doing so would mean the
 * user confirming one plan and receiving another, because the plan depends on
 * the clock and on preferences that only exist in the dialog.
 */

const CATEGORIES = Object.keys(CATEGORY_META) as [Category, ...Category[]]

const blockSchema = z.object({
  subjectId: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  category: z.enum(CATEGORIES),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
})

const confirmSchema = z
  .object({
    // Four weeks of 15-minute blocks on a long day is well past 400, the old cap.
    blocks: z.array(blockSchema).min(1, 'Nothing to schedule.').max(2000, 'That plan is too large. Shorten the range.'),
    replace: z.boolean().default(false),
    rangeStart: z.iso.datetime(),
    rangeEnd: z.iso.datetime(),
  })
  .refine((value) => value.rangeStart < value.rangeEnd, {
    message: 'The date range is back to front.',
  })

export interface ConfirmState {
  error?: string
  ok?: boolean
  created?: number
  removed?: number
}

export async function confirmScheduleAction(
  _previous: ConfirmState,
  formData: FormData,
): Promise<ConfirmState> {
  const raw = formData.get('payload')
  if (typeof raw !== 'string') return { error: 'Missing schedule data.' }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { error: 'Invalid schedule data.' }
  }

  const validated = confirmSchema.safeParse(parsed)
  if (!validated.success) {
    return { error: validated.error.issues[0]?.message ?? 'Check the schedule.' }
  }

  const { blocks, replace, rangeStart, rangeEnd } = validated.data

  // Every block must sit inside the range the user was shown, otherwise a
  // "replace this range" run could delete blocks it never previewed.
  const from = new Date(rangeStart)
  const to = new Date(rangeEnd)
  const outside = blocks.some((block) => {
    const starts = new Date(block.startsAt)
    const ends = new Date(block.endsAt)
    return ends <= starts || starts < from || ends > to
  })
  if (outside) return { error: 'The plan does not match the range you selected.' }

  try {
    const { created, removed } = await replaceGeneratedEvents(
      blocks.map((block) => ({
        subjectId: block.subjectId,
        title: block.title,
        category: block.category,
        startsAt: new Date(block.startsAt),
        endsAt: new Date(block.endsAt),
      })),
      replace ? { replaceFrom: from, replaceTo: to } : {},
    )

    revalidatePath('/dashboard')
    revalidatePath('/dashboard/schedule')
    return { ok: true, created, removed }
  } catch (error) {
    unstable_rethrow(error)
    // Only an ownership miss means a subject went away. Anything else, such as
    // a dropped database connection, used to show the same message and sent
    // people looking for a deleted subject that was never the problem.
    if (error instanceof Error && error.message === 'Subject not found') {
      return { error: 'Some subjects are no longer available. Reload and try again.' }
    }
    return { error: 'The plan could not be saved. Try again in a moment.' }
  }
}

const clearSchema = z
  .object({
    rangeStart: z.iso.datetime(),
    rangeEnd: z.iso.datetime(),
  })
  .refine((value) => value.rangeStart < value.rangeEnd, {
    message: 'The date range is back to front.',
  })

/** Removes every generated block in a window and leaves hand-made events alone. */
export async function clearGeneratedAction(
  _previous: ConfirmState,
  formData: FormData,
): Promise<ConfirmState> {
  const validated = clearSchema.safeParse({
    rangeStart: formData.get('rangeStart'),
    rangeEnd: formData.get('rangeEnd'),
  })
  if (!validated.success) return { error: 'Invalid date range.' }

  const removed = await deleteGeneratedInRange(
    new Date(validated.data.rangeStart),
    new Date(validated.data.rangeEnd),
  )

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/schedule')
  return { ok: true, created: 0, removed }
}
