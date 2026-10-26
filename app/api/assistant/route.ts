import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth-guard'
import { rejectCrossOrigin, rejectNonJson } from '@/lib/http/request-guards'
import { consumeForUser } from '@/lib/rate-limit-user'
import { rateLimitHeaders, tooManyRequests } from '@/lib/rate-limit'
import { assistantErrorResponse, assistantPromptPolicy, promptSchema, readAssistantJson } from '@/lib/assistant/http'
import { AssistantError } from '@/lib/assistant/errors'
import { askAssistant } from '@/lib/assistant/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 90

export async function POST(request: Request) {
  const crossOrigin = rejectCrossOrigin(request)
  if (crossOrigin) return crossOrigin
  const notJson = rejectNonJson(request)
  if (notJson) return notJson

  try {
    const userId = await getUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const limit = await consumeForUser(assistantPromptPolicy, userId)
    if (!limit.ok) return tooManyRequests(assistantPromptPolicy, limit)
    const parsed = promptSchema.safeParse(await readAssistantJson(request))
    if (!parsed.success) throw new AssistantError('Provide a prompt of 1–2000 characters, a valid time zone, and at most six recent messages (4000 characters total).')

    const result = await askAssistant(userId, parsed.data.prompt, parsed.data.timeZone, parsed.data.history)
    return NextResponse.json(result, { headers: { ...rateLimitHeaders(limit), 'Cache-Control': 'no-store' } })
  } catch (error) {
    return assistantErrorResponse(error)
  }
}
