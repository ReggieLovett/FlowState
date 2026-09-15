'use server'

import { revalidatePath } from 'next/cache'
import { readProgress, saveLookChoice } from '@/lib/data/progress'
import { AVATARS, SEASONS, isAvatarId, isSeasonId } from '@/lib/gamification'
import type { ActionState } from '@/lib/actions/schedule'
import { POLICIES } from '@/lib/rate-limit'
import { limitUser } from '@/lib/rate-limit-user'

/**
 * Equip an avatar or a season.
 *
 * Form actions that still work without JavaScript. The unlock is checked
 * against freshly computed XP rather than anything the form sent, which is a
 * full progress read, so both count against the write limit.
 */

export async function chooseAvatarAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = formData.get('avatar')
  if (!isAvatarId(id)) return { error: 'That avatar does not exist.' }

  const limited = await limitUser(POLICIES.write)
  if (limited) return limited

  const { totalXP } = await readProgress()
  if (totalXP < AVATARS.find((a) => a.id === id)!.xp) return { error: 'That avatar is still locked.' }

  await saveLookChoice({ avatar: id })
  revalidatePath('/dashboard', 'layout')
  return { ok: true }
}

export async function chooseSeasonAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = formData.get('season')
  if (!isSeasonId(id)) return { error: 'That season does not exist.' }

  const limited = await limitUser(POLICIES.write)
  if (limited) return limited

  const { totalXP } = await readProgress()
  if (totalXP < SEASONS.find((s) => s.id === id)!.xp) return { error: 'That season is still locked.' }

  await saveLookChoice({ season: id })
  revalidatePath('/dashboard', 'layout')
  return { ok: true }
}
