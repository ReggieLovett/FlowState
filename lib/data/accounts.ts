import 'server-only'

import bcrypt from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * Account creation for the credentials flow.
 *
 * OAuth sign-ups are created by the Prisma adapter. Credentials sign-ups are
 * created here, with no starter data so every new account begins empty.
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
    const user = await prisma.user.create({
      data: { name: input.name, email, passwordHash },
      select: { id: true, email: true, name: true },
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
