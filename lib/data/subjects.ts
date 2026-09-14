import 'server-only'

import type { Category, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUserId } from '@/lib/auth-guard'
import { seedDefaultSubjects } from '@/lib/data/seed-templates'

/**
 * Data access for subjects, the recurring commitments a schedule is built from.
 *
 * Seeded starter templates are ordinary rows in this table. Every function below
 * treats them identically to rows the user created: nothing branches on
 * `seedKey`, so requirement 4's "full CRUD over the pre-made templates" falls
 * out of the design rather than needing special cases.
 */

const subjectSelect = {
  id: true,
  name: true,
  category: true,
  code: true,
  colorHex: true,
  notes: true,
  difficulty: true,
  examDate: true,
  seedKey: true,
  archivedAt: true,
  _count: { select: { events: true, items: true } },
} satisfies Prisma.SubjectSelect

export type SubjectDTO = Prisma.SubjectGetPayload<{ select: typeof subjectSelect }>

export async function listSubjects(
  options: { includeArchived?: boolean } = {},
): Promise<SubjectDTO[]> {
  const userId = await requireUserId()

  return prisma.subject.findMany({
    where: {
      userId,
      ...(options.includeArchived ? {} : { archivedAt: null }),
    },
    select: subjectSelect,
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  })
}

export async function getSubject(subjectId: string): Promise<SubjectDTO | null> {
  const userId = await requireUserId()

  return prisma.subject.findUnique({
    where: { id_userId: { id: subjectId, userId } },
    select: subjectSelect,
  })
}

export interface SubjectInput {
  name: string
  category: Category
  code?: string | null
  colorHex?: string
  notes?: string | null
  difficulty?: number
  examDate?: Date | null
}

export async function createSubject(input: SubjectInput) {
  const userId = await requireUserId()

  return prisma.subject.create({
    data: { ...input, userId },
    select: subjectSelect,
  })
}

/**
 * Edits a subject, seeded or not.
 *
 * `seedKey` is intentionally absent from `SubjectInput`, so an edit can neither
 * set nor clear it. That is what lets a user rename a starter template freely:
 * its identity is preserved, so "restore defaults" will not re-create the
 * original alongside their renamed copy.
 */
export async function updateSubject(subjectId: string, patch: Partial<SubjectInput>) {
  const userId = await requireUserId()

  return prisma.subject.update({
    where: { id_userId: { id: subjectId, userId } },
    data: patch,
    select: subjectSelect,
  })
}

/**
 * Hard delete. Events keep their history via `onDelete: SetNull` on the
 * relation, so removing a client does not erase the meetings already held.
 */
export async function deleteSubject(subjectId: string): Promise<boolean> {
  const userId = await requireUserId()

  const { count } = await prisma.subject.deleteMany({
    where: { id: subjectId, userId },
  })

  return count > 0
}

/** Reversible alternative to deletion: hidden from pickers, history intact. */
export async function setSubjectArchived(subjectId: string, archived: boolean) {
  const userId = await requireUserId()

  return prisma.subject.update({
    where: { id_userId: { id: subjectId, userId } },
    data: { archivedAt: archived ? new Date() : null },
    select: subjectSelect,
  })
}

/**
 * Re-creates any starter template the user has deleted.
 *
 * Deliberately additive. It restores what is missing by name and never touches a
 * template the user has edited, so pressing it cannot undo their customisation.
 */
export async function restoreDefaultSubjects(): Promise<number> {
  const userId = await requireUserId()
  return seedDefaultSubjects(prisma, userId)
}
