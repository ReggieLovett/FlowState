import type { Prisma } from '@prisma/client'
import { CATEGORY_META } from '@/lib/categories'

/**
 * Anything that can write subjects: the PrismaClient singleton or a transaction
 * client. Taking the writer as an argument rather than importing the singleton
 * keeps this module free of `server-only` and of any connection concern, so the
 * seeding rules can be exercised directly by prisma/verify-isolation.ts.
 */
type SubjectWriter = {
  subject: Pick<Prisma.TransactionClient['subject'], 'createMany'>
}

/**
 * Starter templates created with every new account.
 *
 * These are written as ordinary rows owned by the user, not as a separate
 * "template" table joined at read time. That is the whole point of requirement
 * 4: the user can rename, recolour, recategorise or delete any of them from the
 * moment they land on the dashboard, using exactly the same CRUD paths as rows
 * they create themselves. `isSeeded` is set purely so the UI can offer a
 * "restore defaults" action later; nothing in the data layer treats those rows
 * differently.
 *
 * The mix spans both audiences on purpose. A student ignores the client rows and
 * deletes them; a working professional does the same with the lecture rows.
 */
const STARTER_TEMPLATES: Array<{
  /** Stable identity, independent of the name the user may give it. */
  seedKey: string
  name: string
  category: keyof typeof CATEGORY_META
  code?: string
  notes?: string
}> = [
  {
    seedKey: 'core-lecture',
    name: 'Core Module Lecture',
    category: 'LECTURE',
    code: 'CORE-101',
    notes: 'Rename to your module and set the weekly slot.',
  },
  {
    seedKey: 'discussion-seminar',
    name: 'Discussion Seminar',
    category: 'SEMINAR',
    notes: 'Small-group session. Add prep time as a separate deep work shift.',
  },
  {
    seedKey: 'lab-session',
    name: 'Lab Session',
    category: 'LAB_SESSION',
    notes: 'Book equipment time here so it never collides with a lecture.',
  },
  {
    seedKey: 'client-checkin',
    name: 'Client Check-in',
    category: 'CLIENT_MEETING',
    notes: 'Recurring status call. Set the client code so invoices line up.',
  },
  {
    seedKey: 'project-milestone',
    name: 'Project Milestone',
    category: 'PROJECT_DEADLINE',
    notes: 'Use all-day events for hand-offs and submissions.',
  },
  {
    seedKey: 'deep-work',
    name: 'Morning Deep Work',
    category: 'DEEP_WORK_SHIFT',
    notes: 'Protected focus block. Schedule it before anything else claims it.',
  },
]

/**
 * Creates the starter templates for a user.
 *
 * Idempotent, and safe to call as "restore defaults" on an existing account.
 * `skipDuplicates` combined with `@@unique([userId, seedKey])` means a template
 * the user still holds is skipped even if they have renamed it, so restoring
 * fills genuine gaps without ever duplicating a customised row.
 */
export async function seedDefaultSubjects(
  client: SubjectWriter,
  userId: string,
): Promise<number> {
  const result = await client.subject.createMany({
    data: STARTER_TEMPLATES.map((template) => ({
      userId,
      name: template.name,
      category: template.category,
      code: template.code ?? null,
      notes: template.notes ?? null,
      colorHex: CATEGORY_META[template.category].colorHex,
      seedKey: template.seedKey,
    })),
    skipDuplicates: true,
  })

  return result.count
}
