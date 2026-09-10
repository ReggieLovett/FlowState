import 'server-only'

import bcrypt from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { seedDefaultSubjects } from '@/lib/data/seed-templates'

/**
 * Account creation for the credentials flow.
 *
 * OAuth sign-ups are created by the Prisma adapter, so their starter templates
 * are seeded from the `createUser` event in auth.ts. Credentials sign-ups do not
 * pass through the adapter, so they are created and seeded here. Both paths end
 * with a populated dashboard.
 *
 * The two writes share a transaction: an account must never exist without its
 * templates, and a failed seed must not leave a half-built user behind.
 *
 * Shared by the Server Action and by POST /api/register so there is one
 * implementation of the rules.
 */
export async function createAccount(input: {
  name: string
  email: string
  password: string
}): Promise<
  { ok: true; user: { id: string; email: string; name: string | null } } | { ok: false; error: string }
> {
  const email = input.email.toLowerCase()
  const passwordHash = await bcrypt.hash(input.password, 12)

  try {
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { name: input.name, email, passwordHash },
        select: { id: true, email: true, name: true },
      })

      await seedDefaultSubjects(tx, created.id)

      return created
    })

    return { ok: true, user }
  } catch (error) {
    // P2002 is the unique violation on User.email.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, error: 'An account with that email already exists.' }
    }
    throw error
  }
}
