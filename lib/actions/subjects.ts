'use server'

import { revalidatePath } from 'next/cache'
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
import type { Category } from '@prisma/client'

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
})

function parseForm(formData: FormData) {
  return subjectSchema.safeParse({
    name: formData.get('name'),
    category: formData.get('category'),
    code: formData.get('code') ?? undefined,
    colorHex: formData.get('colorHex') ?? undefined,
    notes: formData.get('notes') ?? undefined,
  })
}

export async function createSubjectAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
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
    })
  } catch {
    // @@unique([userId, name]) is per-user, so this only ever means the caller
    // already has a subject with this name.
    return { error: 'You already have a subject with that name.' }
  }

  revalidatePath('/dashboard/subjects')
  return { ok: true }
}

export async function updateSubjectAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing subject.' }

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
    })
  } catch {
    return { error: 'Could not save that subject. The name may already be taken.' }
  }

  revalidatePath('/dashboard/subjects')
  revalidatePath('/dashboard/schedule')
  return { ok: true }
}

export async function deleteSubjectAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  if (id) await deleteSubject(id)

  revalidatePath('/dashboard/subjects')
  revalidatePath('/dashboard/schedule')
}

export async function toggleSubjectArchivedAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const archived = formData.get('archived') === 'true'
  if (id) await setSubjectArchived(id, archived)

  revalidatePath('/dashboard/subjects')
}

export async function restoreDefaultsAction(): Promise<void> {
  await restoreDefaultSubjects()
  revalidatePath('/dashboard/subjects')
}
