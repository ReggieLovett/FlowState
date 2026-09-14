import type { LevelProgress } from '@/lib/gamification'

/** Segmented, like a stamina bar. The fill carries the season accent. */
export function XpBar({ level, size = 'md' }: { level: LevelProgress; size?: 'sm' | 'md' }) {
  const percent = Math.round(level.fraction * 100)
  return (
    <div
      className={`xp-bar xp-bar-${size}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={level.levelSpan}
      aria-valuenow={level.earnedInLevel}
      aria-label={`Level ${level.level}: ${level.earnedInLevel} of ${level.levelSpan} XP`}
    >
      <span className="xp-bar-fill" style={{ width: `${percent}%` }} />
    </div>
  )
}
