'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireUserId } from '@/lib/auth-guard'
import type { Category } from '@prisma/client'

/**
 * Server Action: bulk-create schedule events from the smart scheduling engine.
 *
 * The client runs the pure scheduling functions and sends the resulting blocks.
 * This action validates and writes them, scoped to the authenticated user.
 */

const blockSchema = z.object({
  subjectId: z.string(),
  title: z.string().max(200),
  category: z.string(),
  startsAt: z.string(), // ISO datetime string
  endsAt: z.string(),
  isAllDay: z.literal(false),
})

const confirmSchema = z.object({
  blocks: z.array(blockSchema).min(1, 'Nothing to schedule.').max(200),
})

export interface ConfirmState {
  error?: string
  ok?: boolean
  created?: number
}

export async function confirmScheduleAction(
  _previous: ConfirmState,
  formData: FormData,
): Promise<ConfirmState> {
  const userId = await requireUserId()

  const raw = formData.get('blocks')
  if (typeof raw !== 'string') return { error: 'Missing schedule data.' }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { error: 'Invalid schedule data.' }
  }

  const validated = confirmSchema.safeParse(parsed)
  if (!validated.success) {
    return { error: validated.error.issues[0]?.message ?? 'Check the schedule.' }
  }

  // Verify all subjectIds belong to this user
  const subjectIds = [...new Set(validated.data.blocks.map((b) => b.subjectId))]
  const ownedSubjects = await prisma.subject.findMany({
    where: { userId, id: { in: subjectIds } },
    select: { id: true },
  })
  const ownedIds = new Set(ownedSubjects.map((s) => s.id))
  const unauthorized = subjectIds.filter((id) => !ownedIds.has(id))
  if (unauthorized.length > 0) {
    return { error: 'Some subjects are no longer available.' }
  }

  // Bulk insert
  await prisma.scheduleEvent.createMany({
    data: validated.data.blocks.map((block) => ({
      userId,
      subjectId: block.subjectId,
      title: block.title,
      category: block.category as Category,
      startsAt: new Date(block.startsAt),
      endsAt: new Date(block.endsAt),
      isAllDay: false,
      status: 'SCHEDULED' as const,
    })),
  })

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/schedule')
  return { ok: true, created: validated.data.blocks.length }
}
