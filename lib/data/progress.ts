import 'server-only'

import { cache } from 'react'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { requireUserId } from '@/lib/auth-guard'
import { addDays, startOfWeek } from '@/lib/format'
import {
  buildProgress,
  isAvatarId,
  isSeasonId,
  resolveLook,
  type AvatarId,
  type Progress,
  type SeasonId,
} from '@/lib/gamification'

/**
 * Progress, XP and the chosen avatar and season, scoped to the signed-in user.
 *
 * Nothing new is stored for XP: it is recomputed from the user's timed events
 * by the pure rules in lib/gamification.ts. See that file for why.
 */

/**
 * Uncached, because the completion action needs a before and an after inside
 * one request and `cache` would hand it the same snapshot twice.
 *
 * The read stops at the end of this week: nothing later can affect XP, a
 * streak or this week's chart, and it keeps a user with a term of generated
 * blocks from paying for them on every page. Served by the
 * `@@index([userId, startsAt])` on ScheduleEvent.
 */
export async function readProgress(now = new Date()): Promise<Progress> {
  const userId = await requireUserId()

  const events = await prisma.scheduleEvent.findMany({
    where: {
      userId,
      isAllDay: false,
      status: { not: 'CANCELLED' },
      startsAt: { lt: addDays(startOfWeek(now), 7) },
    },
    select: { startsAt: true, endsAt: true, status: true, subjectId: true },
  })

  return buildProgress(events, now)
}

/** One read per request however many components on the page ask. */
export const getProgress = cache(() => readProgress())

// ---------------------------------------------------------------------------
// Avatar and season choice
// ---------------------------------------------------------------------------

const LOOK_COOKIE = 'flowstate-look'

/**
 * The choice lives in a cookie rather than a column, so restoring the feature
 * needed no migration. It is prefixed with the user id: two accounts on one
 * browser do not inherit each other's avatar, and a cookie from a signed-out
 * account is simply ignored. The server re-checks unlocks on every read, so an
 * edited cookie cannot equip anything that has not been earned.
 */
async function readChoice(userId: string): Promise<{ avatar?: AvatarId; season?: SeasonId }> {
  const raw = (await cookies()).get(LOOK_COOKIE)?.value
  if (!raw) return {}
  const [owner, avatar, season] = raw.split('.')
  if (owner !== userId) return {}
  return {
    avatar: isAvatarId(avatar) ? avatar : undefined,
    season: isSeasonId(season) ? season : undefined,
  }
}

export const getLook = cache(async () => {
  const userId = await requireUserId()
  const [progress, choice] = await Promise.all([getProgress(), readChoice(userId)])
  return resolveLook(progress.totalXP, choice)
})

/** Server Actions only: cookies cannot be written once a page starts streaming. */
export async function saveLookChoice(patch: { avatar?: AvatarId; season?: SeasonId }) {
  const userId = await requireUserId()
  const current = await readChoice(userId)
  const next = { ...current, ...patch }

  ;(await cookies()).set(LOOK_COOKIE, [userId, next.avatar ?? '', next.season ?? ''].join('.'), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
}
