import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { POLICIES, consume, ipFromHeaders, rateLimitHeaders, tooManyRequests } from '@/lib/rate-limit'

/**
 * Credentials sign-up.
 *
 * OAuth and credentials sign-ups create only the account. Subjects are created
 * by the user after sign-in.
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
  // Before parsing: a malformed body still costs a request, so a client cannot
  // probe the endpoint for free by sending junk.
  const limit = await consume(POLICIES.register, ipFromHeaders(request.headers))
  if (!limit.ok) return tooManyRequests(POLICIES.register, limit)

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
    const user = await prisma.user.create({
      data: { name, email, passwordHash },
      select: { id: true, email: true, name: true },
    })

    return NextResponse.json({ user }, { status: 201, headers: rateLimitHeaders(limit) })
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
