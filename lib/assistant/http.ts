import 'server-only'

import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import type { RateLimitPolicy } from '@/lib/rate-limit'
import { AssistantError } from './errors'

export const assistantPromptPolicy = {
  name: 'assistant-prompt', limit: 8, windowMs: 10 * 60_000, noun: 'assistant requests',
} satisfies RateLimitPolicy

export const assistantDecisionPolicy = {
  name: 'assistant-decision', limit: 30, windowMs: 60_000, noun: 'assistant decisions',
} satisfies RateLimitPolicy

export const promptSchema = z.strictObject({
  prompt: z.string().trim().min(1).max(2000),
  timeZone: z.string().min(1).max(100).refine((value) => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true } catch { return false }
  }, 'Use a valid IANA time zone.'),
})

export const decisionSchema = z.strictObject({ action: z.enum(['confirm', 'cancel']) })

/** Bound streamed input too; Content-Length alone is optional and untrusted. */
export async function readAssistantJson(request: Request): Promise<unknown> {
  const MAX_BYTES = 8192
  if (Number(request.headers.get('content-length')) > MAX_BYTES) throw new AssistantError('Request body is too large.', 413)
  const reader = request.body?.getReader()
  if (!reader) throw new AssistantError('Body must be JSON.')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BYTES) {
        await reader.cancel()
        throw new AssistantError('Request body is too large.', 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new AssistantError('Body must be JSON.')
  }
}

export function assistantErrorResponse(error: unknown) {
  if (error instanceof AssistantError) {
    return NextResponse.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } })
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2021' || error.code === 'P2022')) {
    return NextResponse.json({ error: 'Assistant storage is not ready. Apply the pending database migration.' }, { status: 503 })
  }
  // Do not log prompts, OAuth tokens, upstream responses or database values.
  console.error('[assistant] request failed', { kind: error instanceof Error ? error.name : 'unknown' })
  return NextResponse.json({ error: 'The assistant is temporarily unavailable. Please try again.' }, { status: 503 })
}
