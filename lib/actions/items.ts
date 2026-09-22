'use server'

import { revalidatePath } from 'next/cache'
import { unstable_rethrow } from 'next/navigation'
import { z } from 'zod'
import { createItem, deleteItem, updateItem } from '@/lib/data/items'
import type { ActionState } from '@/lib/actions/schedule'
import { POLICIES } from '@/lib/rate-limit'
import { limitUser } from '@/lib/rate-limit-user'
import { formId, idSchema } from '@/lib/validation/fields'

/**
 * Server Actions for subject items.
 *
 * None takes a user id. The data layer resolves the owner from the session, and
 * the (subjectId, userId) relation makes the database reject an item filed
 * under someone else's subject, so a crafted form post has nothing to aim at.
 */

const ITEM_TYPES = ['TASK', 'ASSIGNMENT', 'PROJECT', 'EXAM'] as const

const itemSchema = z.object({
  subjectId: idSchema,
  title: z.string().trim().min(1, 'Give it a title.').max(200),
  type: z.enum(ITEM_TYPES),
  // Date-only, stored at UTC midnight like Subject.examDate.
  dueDate: z
    .string()
    .trim()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Pick a valid date.')
    .optional(),
  // Hours as typed, blank for "suggest one". Quarter-hour precision is plenty.
  estimateHours: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || (Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 200), {
      message: 'Effort must be between a few minutes and 200 hours.',
    }),
  priority: z.coerce.number().int().min(1).max(3).default(2),
  notes: z.string().trim().max(2000).optional(),
})

function parse(formData: FormData) {
  return itemSchema.safeParse({
    subjectId: formData.get('subjectId'),
    title: formData.get('title'),
    type: formData.get('type'),
    dueDate: formData.get('dueDate') ?? undefined,
    estimateHours: formData.get('estimateHours') ?? undefined,
    priority: formData.get('priority') ?? undefined,
    notes: formData.get('notes') ?? undefined,
  })
}

function toInput(v: z.infer<typeof itemSchema>) {
  return {
    subjectId: v.subjectId,
    title: v.title,
    type: v.type,
    dueDate: v.dueDate ? new Date(`${v.dueDate}T00:00:00.000Z`) : null,
    estimatedMinutes: v.estimateHours
      ? Math.max(15, Math.round((Number(v.estimateHours) * 60) / 15) * 15)
      : null,
    priority: v.priority,
    notes: v.notes || null,
  }
}

function refresh() {
  // Items show on the subjects page, feed the planner on the schedule page and
  // label blocks everywhere, so the whole dashboard segment is stale.
  revalidatePath('/dashboard', 'layout')
}

export async function createItemAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const limited = await limitUser(POLICIES.write)
  if (limited) return limited

  const parsed = parse(formData)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form.' }

  try {
    await createItem(toInput(parsed.data))
  } catch (error) {
    unstable_rethrow(error)
    return { error: 'That subject is no longer available.' }
  }

  refresh()
  return { ok: true }
}

export async function updateItemAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = formId(formData.get('id'))
  if (!id) return { error: 'Missing item.' }

  const limited = await limitUser(POLICIES.write)
  if (limited) return limited

  const parsed = parse(formData)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form.' }

  try {
    await updateItem(id, toInput(parsed.data))
  } catch (error) {
    unstable_rethrow(error)
    return { error: 'Could not update that item.' }
  }

  refresh()
  return { ok: true }
}

export async function setItemStatusAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = formId(formData.get('id'))
  const status = formData.get('status')
  if (!id || (status !== 'TODO' && status !== 'DONE')) return { error: 'Could not update that item.' }

  const limited = await limitUser(POLICIES.write)
  if (limited) return limited

  try {
    await updateItem(id, { status })
  } catch (error) {
    unstable_rethrow(error)
    // Someone else's id, or already deleted.
    return { error: 'That item is no longer available.' }
  }

  refresh()
  return { ok: true }
}

export async function deleteItemAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = formId(formData.get('id'))
  if (!id) return { error: 'Missing item.' }

  const limited = await limitUser(POLICIES.write)
  if (limited) return limited

  await deleteItem(id)
  refresh()
  return { ok: true }
}
