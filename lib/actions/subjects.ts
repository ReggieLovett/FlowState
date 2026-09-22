'use server'

import { revalidatePath } from 'next/cache'
import { unstable_rethrow } from 'next/navigation'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import {
  createSubject,
  deleteSubject,
  restoreDefaultSubjects,
  setSubjectArchived,
  updateSubject,
} from '@/lib/data/subjects'
import { CATEGORY_ORDER } from '@/lib/categories'
import type { ActionState } from '@/lib/actions/schedule'
import { POLICIES } from '@/lib/rate-limit'
import { limitUser } from '@/lib/rate-limit-user'
import type { Category } from '@prisma/client'
import { dateInputSchema, formId } from '@/lib/validation/fields'

/**
 * Server Actions for subjects.
 *
 * Seeded starter templates go through exactly these functions: nothing branches
 * on whether a row came from the sign-up seed, which is what gives the user full
 * CRUD over their pre-made templates.
 */

const subjectSchema = z.object({
  name: z.string().trim().min(1, 'Give the subject a name.').max(120),
  category: z.enum(CATEGORY_ORDER as [Category, ...Category[]]),
  code: z.string().trim().max(40).optional(),
  colorHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Pick a colour.')
    .optional(),
  notes: z.string().trim().max(2000).optional(),
  difficulty: z.coerce.number().int().min(1).max(10).optional(),
  // Was an unchecked string handed to `new Date()`. Garbage became Invalid Date,
  // Prisma threw, and the catch below reported it as a duplicate name.
  examDate: z.union([z.literal(''), dateInputSchema]).optional(),
})

/** Unique violation on (userId, name): the only expected write failure here. */
function isDuplicateName(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

/** Date-only, stored at UTC midnight like SubjectItem.dueDate. */
function toExamDate(value: string | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null
}

function parseForm(formData: FormData) {
  return subjectSchema.safeParse({
    name: formData.get('name'),
    category: formData.get('category'),
    code: formData.get('code') ?? undefined,
    colorHex: formData.get('colorHex') ?? undefined,
    notes: formData.get('notes') ?? undefined,
    difficulty: formData.get('difficulty') ?? undefined,
    examDate: formData.get('examDate') ?? undefined,
  })
}

export async function createSubjectAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const limited = await limitUser(POLICIES.write)
  if (limited) return limited

  const parsed = parseForm(formData)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  }

  try {
    await createSubject({
      name: parsed.data.name,
      category: parsed.data.category,
      code: parsed.data.code || null,
      colorHex: parsed.data.colorHex,
      notes: parsed.data.notes || null,
      difficulty: parsed.data.difficulty,
      examDate: toExamDate(parsed.data.examDate),
    })
  } catch (error) {
    // A bare `catch {}` here used to swallow the redirect thrown when the
    // session has expired, telling a signed-out user their name was taken.
    unstable_rethrow(error)
    // @@unique([userId, name]) is per-user, so a P2002 only ever means the
    // caller already has a subject with this name.
    if (isDuplicateName(error)) return { error: 'You already have a subject with that name.' }
    throw error
  }

  revalidatePath('/dashboard/subjects')
  return { ok: true }
}

export async function updateSubjectAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = formId(formData.get('id'))
  if (!id) return { error: 'Missing subject.' }

  const limited = await limitUser(POLICIES.write)
  if (limited) return limited

  const parsed = parseForm(formData)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  }

  try {
    await updateSubject(id, {
      name: parsed.data.name,
      category: parsed.data.category,
      code: parsed.data.code || null,
      colorHex: parsed.data.colorHex,
      notes: parsed.data.notes || null,
      difficulty: parsed.data.difficulty,
      // Absent leaves the date alone; an emptied field clears it. The old code
      // could never clear a date once set. Keeping "absent" distinct means a
      // form that omits the field cannot wipe it by accident.
      examDate: parsed.data.examDate === undefined ? undefined : toExamDate(parsed.data.examDate),
    })
  } catch (error) {
    unstable_rethrow(error)
    if (isDuplicateName(error)) return { error: 'You already have a subject with that name.' }
    // Someone else's id, or a subject deleted in another tab.
    return { error: 'That subject is no longer available.' }
  }

  revalidatePath('/dashboard/subjects')
  revalidatePath('/dashboard/schedule')
  return { ok: true }
}

export async function deleteSubjectAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = formId(formData.get('id'))
  if (!id) return { error: 'Missing subject.' }

  const limited = await limitUser(POLICIES.write)
  if (limited) return limited

  await deleteSubject(id)

  revalidatePath('/dashboard/subjects')
  revalidatePath('/dashboard/schedule')
  return { ok: true }
}

export async function toggleSubjectArchivedAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = formId(formData.get('id'))
  const archived = formData.get('archived') === 'true'
  if (!id) return { error: 'Missing subject.' }

  const limited = await limitUser(POLICIES.write)
  if (limited) return limited

  try {
    await setSubjectArchived(id, archived)
  } catch (error) {
    unstable_rethrow(error)
    return { error: 'That subject is no longer available.' }
  }

  revalidatePath('/dashboard/subjects')
  return { ok: true }
}

export async function restoreDefaultsAction(): Promise<ActionState> {
  const limited = await limitUser(POLICIES.write)
  if (limited) return limited

  await restoreDefaultSubjects()
  revalidatePath('/dashboard/subjects')
  return { ok: true }
}
