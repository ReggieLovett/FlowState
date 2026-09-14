import type { Progress } from '@/lib/gamification'
import { formatMinutes } from '@/lib/format'
import { PixelGlyph } from '@/components/rewards/Pixel'

/**
 * The four headline numbers from the original dashboard spec: streak,
 * completion, study time and XP.
 */
export function StatTiles({ progress }: { progress: Progress }) {
  const { streak, completion, studyMinutes, level, totalXP } = progress
  const rate = completion.rate === null ? null : Math.round(completion.rate * 100)
  const delta = studyMinutes.thisWeek - studyMinutes.lastWeek

  return (
    <div className="row g-3 mb-4">
      <div className="col-6 col-xl-3">
        <div className="card stat-tile h-100">
          <div className="card-body">
            <div className="stat-label">
              <PixelGlyph glyph="flame" size={16} />
              Current streak
            </div>
            <div className="stat-value">
              {streak.current} <span className="stat-unit">{streak.current === 1 ? 'day' : 'days'}</span>
            </div>
            <div className="stat-sub">
              {streak.current > 0 && !streak.activeToday
                ? 'Finish a block today to keep it'
                : `Longest ${streak.longest} ${streak.longest === 1 ? 'day' : 'days'}`}
            </div>
          </div>
        </div>
      </div>

      <div className="col-6 col-xl-3">
        <div className="card stat-tile h-100">
          <div className="card-body">
            <div className="stat-label">
              <PixelGlyph glyph="apple" size={16} />
              Completed this week
            </div>
            <div className="stat-value">{rate === null ? '–' : `${rate}%`}</div>
            <div className="stat-sub">
              {completion.due === 0
                ? 'Nothing due yet this week'
                : `${completion.done} of ${completion.due} due ${completion.due === 1 ? 'event' : 'events'}`}
            </div>
            <div
              className="stat-meter mt-2"
              role="progressbar"
              aria-label="Completion rate this week"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={rate ?? 0}
            >
              <span style={{ width: `${rate ?? 0}%` }} />
            </div>
          </div>
        </div>
      </div>

      <div className="col-6 col-xl-3">
        <div className="card stat-tile h-100">
          <div className="card-body">
            <div className="stat-label">
              <PixelGlyph glyph="book" size={16} />
              Study time this week
            </div>
            <div className="stat-value">{formatMinutes(studyMinutes.thisWeek)}</div>
            <div className="stat-sub">
              {delta === 0 ? (
                'Same as last week'
              ) : (
                <span className={delta > 0 ? 'text-success' : 'text-secondary'}>
                  <i className={`bi ${delta > 0 ? 'bi-arrow-up-short' : 'bi-arrow-down-short'}`} aria-hidden="true" />
                  {formatMinutes(Math.abs(delta))} {delta > 0 ? 'more' : 'less'} than last week
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="col-6 col-xl-3">
        <div className="card stat-tile h-100">
          <div className="card-body">
            <div className="stat-label">
              <PixelGlyph glyph="gem" size={16} />
              Total XP
            </div>
            <div className="stat-value">{totalXP.toLocaleString('en-GB')}</div>
            <div className="stat-sub">
              Level {level.level} · {level.xpToNextLevel.toLocaleString('en-GB')} to next
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
