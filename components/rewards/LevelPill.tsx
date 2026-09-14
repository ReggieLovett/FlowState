import Link from 'next/link'
import type { Look, Progress } from '@/lib/gamification'
import { PixelAvatar } from './Pixel'
import { XpBar } from './XpBar'

/** Header summary: avatar, level and a thin XP bar, linking to Rewards. */
export function LevelPill({ look, progress }: { look: Look; progress: Progress }) {
  return (
    <Link
      href="/dashboard/rewards"
      className="level-pill text-decoration-none"
      data-season={look.season.id}
      aria-label={`Level ${progress.level.level}, ${progress.totalXP} XP. Open rewards`}
    >
      <PixelAvatar id={look.avatar.id} size={26} />
      <span className="d-flex flex-column gap-1">
        <span className="font-pixel level-pill-label">LV {progress.level.level}</span>
        <span className="d-none d-sm-block" style={{ width: '4.5rem' }}>
          <XpBar level={progress.level} size="sm" />
        </span>
      </span>
    </Link>
  )
}
