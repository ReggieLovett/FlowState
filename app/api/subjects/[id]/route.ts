import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth-guard'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * DELETE /api/subjects/:id
 *
 * Removes a subject owned by the current user. Events linked to the subject
 * are preserved (their subjectId is set to NULL by the schema's onDelete rule).
 *
 * Ownership is enforced through the compound unique [id, userId] — no separate
 * check is needed or possible. A 404 is returned whether the row belongs to
 * another user or does not exist, so the response never leaks information.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const { count } = await prisma.subject.deleteMany({
    where: { id, userId },
  })

  if (count === 0) {
    return NextResponse.json({ error: 'Subject not found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
