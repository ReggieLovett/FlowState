import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth-guard'
import { rejectCrossOrigin } from '@/lib/http/request-guards'
import { prisma } from '@/lib/prisma'
import { POLICIES, rateLimitHeaders, tooManyRequests } from '@/lib/rate-limit'
import { consumeForUser } from '@/lib/rate-limit-user'
import { idSchema } from '@/lib/validation/fields'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * DELETE /api/subjects/:id
 *
 * Removes a subject owned by the current user. Events linked to the subject
 * are preserved (their subjectId is set to NULL by the schema's onDelete rule).
 *
 * Ownership is enforced through `userId` in the delete's own WHERE clause, so
 * there is no separate check to race. A 404 is returned whether the row belongs
 * to another user or does not exist, so the response never leaks information.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // A DELETE carries no body, so there is no content type to insist on; the
  // Origin check is what stops a forged cross-site request.
  const crossOrigin = rejectCrossOrigin(request)
  if (crossOrigin) return crossOrigin

  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const limit = await consumeForUser(POLICIES.write, userId)
  if (!limit.ok) return tooManyRequests(POLICIES.write, limit)

  // Same answer as a miss, so a malformed id is indistinguishable from someone
  // else's.
  const parsedId = idSchema.safeParse((await params).id)
  if (!parsedId.success) {
    return NextResponse.json({ error: 'Subject not found' }, { status: 404 })
  }

  const { count } = await prisma.subject.deleteMany({
    where: { id: parsedId.data, userId },
  })

  if (count === 0) {
    return NextResponse.json({ error: 'Subject not found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true }, { headers: rateLimitHeaders(limit) })
}
