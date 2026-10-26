import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth-guard'
import { rejectCrossOrigin, rejectNonJson } from '@/lib/http/request-guards'
import { consumeForUser } from '@/lib/rate-limit-user'
import { rateLimitHeaders, tooManyRequests } from '@/lib/rate-limit'
import { assistantDecisionPolicy, assistantErrorResponse, decisionSchema, readAssistantJson } from '@/lib/assistant/http'
import { AssistantError } from '@/lib/assistant/errors'
import { decideProposal } from '@/lib/assistant/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 90

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const crossOrigin = rejectCrossOrigin(request)
  if (crossOrigin) return crossOrigin
  const notJson = rejectNonJson(request)
  if (notJson) return notJson

  try {
    const userId = await getUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const limit = await consumeForUser(assistantDecisionPolicy, userId)
    if (!limit.ok) return tooManyRequests(assistantDecisionPolicy, limit)
    const { id } = await params
    if (!/^[a-zA-Z0-9_-]{1,191}$/.test(id)) throw new AssistantError('Proposal not found.', 404)
    const parsed = decisionSchema.safeParse(await readAssistantJson(request))
    if (!parsed.success) throw new AssistantError('Choose confirm or cancel. Proposal contents cannot be edited.')

    const result = await decideProposal(userId, id, parsed.data.action)
    return NextResponse.json(result, { headers: { ...rateLimitHeaders(limit), 'Cache-Control': 'no-store' } })
  } catch (error) {
    return assistantErrorResponse(error)
  }
}
