import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { seedDefaultSubjects } from '@/lib/data/seed-templates'

/**
 * Credentials sign-up.
 *
 * OAuth sign-ups are created by the Prisma adapter, so their starter templates
 * are seeded from the `createUser` event in auth.ts. Credentials sign-ups do not
 * pass through the adapter, so they are created and seeded here instead. Both
 * paths end with a populated dashboard, which is requirement 4.
 *
 * The two writes share a transaction: an account must never exist without its
 * templates, and a failed seed must not leave a half-built user behind.
 */

export const runtime = 'nodejs'

const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().toLowerCase(),
  // Length is the property that actually matters. Composition rules push people
  // toward predictable substitutions, so a floor of 12 is used instead.
  password: z.string().min(12).max(200),
})

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 })
  }

  const parsed = registerSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: z.treeifyError(parsed.error) },
      { status: 400 },
    )
  }

  const { name, email, password } = parsed.data
  const passwordHash = await bcrypt.hash(password, 12)

  try {
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { name, email, passwordHash },
        select: { id: true, email: true, name: true },
      })

      await seedDefaultSubjects(tx, created.id)

      return created
    })

    return NextResponse.json({ user }, { status: 201 })
  } catch (error) {
    // P2002 is the unique violation on User.email. Answering "created" for an
    // address that already exists would be a lie the client acts on, so this
    // returns 409. That does disclose that the address is registered, which is
    // the accepted trade-off for a usable sign-up form; the sign-in endpoint is
    // where enumeration is actually prevented (see the dummy-hash comparison in
    // auth.ts).
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return NextResponse.json(
        { error: 'An account with that email already exists.' },
        { status: 409 },
      )
    }
    throw error
  }
}
