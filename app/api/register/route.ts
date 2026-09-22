import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAccount } from '@/lib/data/accounts'
import { rejectCrossOrigin, rejectNonJson } from '@/lib/http/request-guards'
import { POLICIES, consume, ipFromHeaders, rateLimitHeaders, tooManyRequests } from '@/lib/rate-limit'
import { emailSchema, newPasswordSchema } from '@/lib/validation/fields'

/**
 * Credentials sign-up over JSON.
 *
 * OAuth and credentials sign-ups create only the account. Subjects are created
 * by the user after sign-in.
 *
 * Account creation itself lives in lib/data/accounts.ts, shared with the sign-up
 * form. This route used to hash and insert on its own, which is how the two
 * paths came to disagree about what a valid password is.
 */

export const runtime = 'nodejs'

const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: emailSchema,
  password: newPasswordSchema,
})

export async function POST(request: Request) {
  // Cheapest checks first. Neither touches the database.
  const crossOrigin = rejectCrossOrigin(request)
  if (crossOrigin) return crossOrigin
  const notJson = rejectNonJson(request)
  if (notJson) return notJson

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

  const result = await createAccount(parsed.data)

  // Answering "created" for an address that already exists would be a lie the
  // client acts on, so this returns 409. That does disclose that the address is
  // registered, the accepted trade-off for a usable sign-up form, bounded by the
  // per-IP limit above. The sign-in endpoint is where enumeration is actually
  // prevented (see the dummy-hash comparison in auth.ts).
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 })
  }

  return NextResponse.json({ user: result.user }, { status: 201, headers: rateLimitHeaders(limit) })
}
