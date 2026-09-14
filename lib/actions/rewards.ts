'use server'

import { revalidatePath } from 'next/cache'
import { readProgress, saveLookChoice } from '@/lib/data/progress'
import { AVATARS, SEASONS, isAvatarId, isSeasonId } from '@/lib/gamification'

/**
 * Equip an avatar or a season.
 *
 * Plain form actions, so the rewards page works without JavaScript. The unlock
 * is checked against freshly computed XP rather than anything the form sent.
 */

export async function chooseAvatarAction(formData: FormData): Promise<void> {
  const id = formData.get('avatar')
  if (!isAvatarId(id)) return

  const { totalXP } = await readProgress()
  if (totalXP < AVATARS.find((a) => a.id === id)!.xp) return

  await saveLookChoice({ avatar: id })
  revalidatePath('/dashboard', 'layout')
}

export async function chooseSeasonAction(formData: FormData): Promise<void> {
  const id = formData.get('season')
  if (!isSeasonId(id)) return

  const { totalXP } = await readProgress()
  if (totalXP < SEASONS.find((s) => s.id === id)!.xp) return

  await saveLookChoice({ season: id })
  revalidatePath('/dashboard', 'layout')
}
