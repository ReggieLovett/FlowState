import Link from 'next/link'
import type { Look, Progress } from '@/lib/gamification'
import { PixelAvatar, PixelGlyph, PixelScene } from './Pixel'
import { XpBar } from './XpBar'

/**
 * The Stardew-style hero: the equipped season as a landscape, the avatar
 * standing on it, and a dialogue-box panel with level and XP.
 *
 * Text sits on the solid panel rather than on the art, so contrast does not
 * depend on which season is equipped.
 */
export function PlayerCard({
  name,
  look,
  progress,
  showLink = true,
}: {
  name: string | null
  look: Look
  progress: Progress
  showLink?: boolean
}) {
  const { level, streak, totalXP } = progress

  return (
    <section className="pixel-hero mb-4" data-season={look.season.id} aria-label="Your level and XP">
      <PixelScene season={look.season.id} />

      <div className="pixel-hero-body">
        <div className="pixel-hero-avatar">
          <PixelAvatar id={look.avatar.id} size="100%" label={`${look.avatar.name} avatar`} />
        </div>

        <div className="pixel-panel flex-grow-1 min-width-0">
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
            <div className="d-flex align-items-baseline gap-2 min-width-0">
              <span className="font-pixel pixel-level">LV {level.level}</span>
              <span className="fw-semibold text-truncate">
                {name ? `${name} the ${look.avatar.name}` : look.avatar.name}
              </span>
            </div>
            <div className="d-flex align-items-center gap-3 small">
              <span className="d-inline-flex align-items-center gap-1" title="Current streak">
                <PixelGlyph glyph="flame" size={16} />
                <span>
                  {streak.current} {streak.current === 1 ? 'day' : 'days'}
                </span>
              </span>
              <span className="d-inline-flex align-items-center gap-1" title="Total XP">
                <PixelGlyph glyph="gem" size={16} />
                <span>{totalXP.toLocaleString('en-GB')} XP</span>
              </span>
            </div>
          </div>

          <XpBar level={level} />

          <div className="d-flex flex-wrap justify-content-between gap-2 mt-2 pixel-panel-meta">
            <span>
              {level.xpToNextLevel.toLocaleString('en-GB')} XP to level {level.level + 1}
            </span>
            {showLink && (
              <Link href="/dashboard/rewards" className="pixel-link">
                Rewards
                <i className="bi bi-chevron-right ms-1" aria-hidden="true" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
